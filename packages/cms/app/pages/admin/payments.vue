<script setup lang="ts">
import { Download, ExternalLink, Mail } from '@lucide/vue'
import { dashboardUrl, formatAmount, formatShipping, type PaymentStatus, type ShippingAddress } from '../../../shared/stripe'

definePageMeta({ layout: 'admin', middleware: 'cms-auth' })

type Payment = {
  id: string; sessionId: string; paymentIntent: string | null; collection: string; entryId: string; title: string
  quantity: number; unitAmount: number; amount: number; refundedAmount: number; currency: string
  email: string | null; name: string | null; shipping: ShippingAddress | null; status: PaymentStatus; livemode: boolean
  createdAt: string; updatedAt: string
}

const schema = await useCmsSchema()
const route = useRoute()
const data = ref(await cmsApi<{ payments: Payment[] }>('/api/cms/payments').catch((e) => { throw createError({ statusCode: e?.statusCode ?? 500, message: cmsErrorMessage(e), fatal: true }) }))

// Les paiements de test et les vrais ne se mélangent pas : on montre les vrais, sauf s'il n'y a que des essais.
const hasLive = computed(() => data.value.payments.some(p => p.livemode))
const mode = ref<'live' | 'test'>(hasLive.value || !data.value.payments.length ? 'live' : 'test')
const list = computed(() => data.value.payments.filter(p => p.livemode === (mode.value === 'live')))
const count = (live: boolean) => data.value.payments.filter(p => p.livemode === live).length
const selected = ref<Payment | null>(null)

const STATUS: Record<PaymentStatus, { label: string; badge: string }> = {
  paid: { label: 'Payé', badge: 'badge-success' },
  pending: { label: 'En attente', badge: 'badge-warning' },
  failed: { label: 'Échoué', badge: 'badge-error' },
  refunded: { label: 'Remboursé', badge: 'badge-neutral' },
}
const collectionLabel = (key: string) => schema.value.collections?.[key]?.label ?? key
const money = (p: Payment, minor = p.amount) => formatAmount(minor, p.currency)
const when = (p: Payment) => new Date(p.createdAt).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })

/** Total encaissé de l'onglet : paiements réussis, moins les remboursements partiels. Par devise. */
const totals = computed(() => {
  const sums = new Map<string, number>()
  for (const p of list.value) if (p.status === 'paid') sums.set(p.currency, (sums.get(p.currency) ?? 0) + p.amount - p.refundedAmount)
  return [...sums].map(([currency, minor]) => formatAmount(minor, currency))
})

/** Fichier lisible par un tableur : une ligne par paiement de l'onglet affiché. */
function exportCsv() {
  // Un texte qui commence par = + - ou @ serait pris pour une formule par le tableur : il est neutralisé par une apostrophe.
  const cell = (text: string) => `"${(/^[=+\-@\t\r]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`
  const decimals = (p: Payment, minor: number) => formatAmount(minor, p.currency).replace(/[^\d,.-]/g, '')
  const rows = [
    ['Date', 'Statut', 'Produit', 'Quantité', 'Montant', 'Remboursé', 'Devise', 'E-mail', 'Nom', 'Adresse de livraison', 'Référence Stripe', 'Mode'],
    ...list.value.map(p => [
      when(p), STATUS[p.status].label, p.title, String(p.quantity), decimals(p, p.amount), decimals(p, p.refundedAmount), p.currency.toUpperCase(),
      p.email ?? '', p.name ?? '', formatShipping(p.shipping).replace(/\n/g, ', '), p.paymentIntent ?? p.sessionId, p.livemode ? 'Production' : 'Test',
    ]),
  ]
  const blob = new Blob(['﻿' + rows.map(r => r.map(cell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `paiements-${mode.value === 'live' ? 'production' : 'test'}.csv`
  link.click()
  URL.revokeObjectURL(link.href)
}

// Lien reçu par e-mail (« voir le paiement ») : ouvre directement le paiement.
onMounted(() => {
  const wanted = data.value.payments.find(p => p.id === route.query.payment)
  if (wanted) { mode.value = wanted.livemode ? 'live' : 'test'; selected.value = wanted }
})
</script>

<template>
  <section class="max-w-6xl mx-auto">
    <div class="flex flex-wrap items-center gap-3 mb-6">
      <div class="min-w-0">
        <h1 class="text-2xl font-bold">Paiements</h1>
        <p class="text-sm text-base-content/60">Les paiements confirmés par Stripe. Remboursements et litiges se gèrent dans le tableau de bord Stripe.</p>
      </div>
      <button class="btn btn-sm ml-auto" :disabled="!list.length" @click="exportCsv"><Download :size="16" />Exporter</button>
    </div>

    <div role="tablist" class="tabs tabs-border mb-3">
      <a role="tab" class="tab" :class="{ 'tab-active': mode === 'live' }" @click="mode = 'live'; selected = null">Vrais paiements<span class="badge badge-sm ml-2">{{ count(true) }}</span></a>
      <a role="tab" class="tab" :class="{ 'tab-active': mode === 'test' }" @click="mode = 'test'; selected = null">Essais (mode test)<span class="badge badge-sm ml-2">{{ count(false) }}</span></a>
    </div>
    <div v-if="mode === 'test'" class="alert alert-warning alert-soft text-sm mb-3">Paiements de test : aucun argent n'a circulé.</div>
    <p v-if="totals.length" class="text-sm mb-3">Encaissé : <strong>{{ totals.join(' · ') }}</strong> <span class="text-base-content/60">(paiements réussis, remboursements déduits)</span></p>

    <div class="grid lg:grid-cols-[1fr_24rem] gap-6 items-start">
      <div class="card bg-base-100 border border-base-300 overflow-hidden">
        <div v-if="!list.length" class="p-10 text-center text-sm text-base-content/50">Aucun paiement pour l'instant.</div>
        <ul v-else class="divide-y divide-base-300">
          <li v-for="p in list" :key="p.id">
            <button type="button" class="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-base-200 cursor-pointer" :class="{ 'bg-base-200': selected?.id === p.id }" :data-payment="p.id" @click="selected = p">
              <span class="min-w-0 grow">
                <span class="block truncate font-medium">{{ p.title }}<span v-if="p.quantity > 1" class="text-base-content/60"> × {{ p.quantity }}</span></span>
                <span class="block truncate text-sm text-base-content/60">{{ p.email ?? '—' }}</span>
              </span>
              <span class="shrink-0 text-right">
                <span class="block font-semibold tabular-nums">{{ money(p) }}</span>
                <span class="badge badge-sm badge-soft" :class="STATUS[p.status].badge">{{ STATUS[p.status].label }}</span>
              </span>
              <span class="shrink-0 text-xs text-base-content/50 hidden sm:block w-20 text-right">{{ cmsFormatWhen(p.createdAt) }}</span>
            </button>
          </li>
        </ul>
      </div>

      <aside class="card bg-base-100 border border-base-300 p-4 text-sm lg:sticky lg:top-20">
        <div v-if="!selected" class="text-base-content/50 py-10 text-center">Sélectionnez un paiement pour le détail.</div>
        <div v-else class="space-y-3" data-detail>
          <div class="flex items-center gap-2">
            <span class="badge badge-soft" :class="STATUS[selected.status].badge">{{ STATUS[selected.status].label }}</span>
            <span v-if="!selected.livemode" class="badge badge-warning badge-outline">Test</span>
            <span class="text-xs text-base-content/50 ml-auto">{{ when(selected) }}</span>
          </div>
          <dl class="space-y-3">
            <div><dt class="text-base-content/60">Produit</dt><dd>{{ selected.title }} <span class="text-base-content/60">({{ collectionLabel(selected.collection) }})</span></dd></div>
            <div><dt class="text-base-content/60">Quantité</dt><dd>{{ selected.quantity }} × {{ money(selected, selected.unitAmount) }}</dd></div>
            <div><dt class="text-base-content/60">Montant payé</dt><dd class="font-semibold">{{ money(selected) }}</dd></div>
            <div v-if="selected.refundedAmount"><dt class="text-base-content/60">Remboursé</dt><dd>{{ money(selected, selected.refundedAmount) }}</dd></div>
            <div><dt class="text-base-content/60">Acheteur</dt><dd class="break-words">{{ [selected.name, selected.email].filter(Boolean).join(' · ') || '—' }}</dd></div>
            <div v-if="selected.shipping"><dt class="text-base-content/60">Adresse de livraison</dt><dd class="whitespace-pre-wrap">{{ formatShipping(selected.shipping) }}</dd></div>
            <div><dt class="text-base-content/60">Référence Stripe</dt><dd class="font-mono text-xs break-all">{{ selected.paymentIntent ?? selected.sessionId }}</dd></div>
          </dl>
          <div v-if="selected.status === 'pending'" class="alert alert-soft alert-warning text-xs">Paiement différé (virement, prélèvement…) : Stripe préviendra le site quand il aboutira ou échouera.</div>
          <div class="flex flex-wrap gap-2 pt-1">
            <a class="btn btn-sm btn-primary grow" :href="dashboardUrl(selected)" target="_blank" rel="noopener"><ExternalLink :size="16" />Voir dans Stripe</a>
            <a v-if="selected.email" class="btn btn-sm" :href="`mailto:${selected.email}`" title="Écrire à l'acheteur" aria-label="Écrire à l'acheteur"><Mail :size="16" /></a>
          </div>
        </div>
      </aside>
    </div>
  </section>
</template>
