<script setup lang="ts">
import { Download, ExternalLink, FileText, Mail, Repeat } from '@lucide/vue'
import { CHANNELS, type Channel, type OriginPeriod, type StoredOrigin, channelOfRow, filterByOrigin } from '../../../shared/attribution'
import { INTERVAL_LABELS, type RecurringInterval, SUBSCRIPTION_STATUS_LABELS, type SubscriptionStatus, dashboardUrl, formatAmount, formatShipping, type PaymentStatus, type ShippingAddress } from '../../../shared/stripe'

definePageMeta({ layout: 'admin', middleware: 'cms-auth' })

type Payment = {
  id: string; sessionId: string; paymentIntent: string | null; collection: string; entryId: string; title: string
  quantity: number; unitAmount: number; amount: number; refundedAmount: number; currency: string
  email: string | null; name: string | null; shipping: ShippingAddress | null; status: PaymentStatus; livemode: boolean
  origin: StoredOrigin | null; conversion?: import('../../../shared/conversions').ConversionState | null; createdAt: string; updatedAt: string
  invoice: string | null; subscription: string | null; discountAmount: number
}
type Subscription = {
  id: string; subscriptionId: string; collection: string; title: string; amount: number; currency: string; interval: RecurringInterval; status: SubscriptionStatus
  email: string | null; name: string | null; livemode: boolean; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; canceledAt: string | null; createdAt: string
}

const schema = await useCmsSchema()
const route = useRoute()
const data = ref(await cmsApi<{ payments: Payment[]; subscriptions: Subscription[] }>('/api/cms/payments').catch((e) => { throw createError({ statusCode: e?.statusCode ?? 500, message: cmsErrorMessage(e), fatal: true }) }))

// Les paiements de test et les vrais ne se mélangent pas : on montre les vrais, sauf s'il n'y a que des essais.
const hasLive = computed(() => data.value.payments.some(p => p.livemode))
const mode = ref<'live' | 'test'>(hasLive.value || !data.value.payments.length ? 'live' : 'test')
const ofMode = computed(() => data.value.payments.filter(p => p.livemode === (mode.value === 'live')))
// Provenance : période et canal choisis dans le tableau « D'où viennent les paiements », appliqués à la liste.
const days = ref<OriginPeriod>(null)
const channel = ref<Channel | null>(null)
const list = computed(() => filterByOrigin(ofMode.value, days.value, channel.value))
/** Le tableau de provenance compte les paiements réussis ; leur total n'est montré que s'ils sont tous dans la même devise. */
const paidRows = computed(() => ofMode.value.filter(p => p.status === 'paid'))
const oneCurrency = computed(() => { const c = new Set(paidRows.value.map(p => p.currency)); return c.size === 1 ? [...c][0]! : null })
const count = (live: boolean) => data.value.payments.filter(p => p.livemode === live).length
const selected = ref<Payment | null>(null)

// ───── Abonnements (collections déclarées `recurring`) ─────
const user = useCmsUser()
const toast = useCmsToast()
const subscriptions = computed(() => (data.value.subscriptions ?? []).filter(s => s.livemode === (mode.value === 'live')))
const SUBSCRIPTION_BADGE: Record<SubscriptionStatus, string> = { active: 'badge-success', trialing: 'badge-success', past_due: 'badge-warning', unpaid: 'badge-error', canceled: 'badge-neutral', incomplete: 'badge-warning', incomplete_expired: 'badge-neutral', paused: 'badge-neutral' }
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '')
const subscriptionUrl = (s: Subscription) => `https://dashboard.stripe.com/${s.livemode ? '' : 'test/'}subscriptions/${s.subscriptionId}`
const focusedSubscription = computed(() => (typeof route.query.subscription === 'string' ? route.query.subscription : null))
const ending = ref<string | null>(null)
async function endSubscription(s: Subscription) {
  if (ending.value || !confirm(`Résilier l'abonnement « ${s.title} » de ${s.email ?? 'cette personne'} ?\n\nIl prendra fin ${s.currentPeriodEnd ? `le ${day(s.currentPeriodEnd)}, ` : ''}à la fin de la période déjà payée. Rien n'est remboursé.`)) return
  ending.value = s.id
  try {
    const saved = await cmsApi<Subscription>(`/api/cms/subscriptions/${s.id}/cancel`, { method: 'POST' })
    data.value.subscriptions = data.value.subscriptions.map(x => (x.id === s.id ? { ...x, ...saved } : x))
    toast.success('Résiliation demandée à Stripe')
  }
  catch (e) {
    toast.error(cmsErrorMessage(e, 'La résiliation n\'a pas pu être demandée.'))
  }
  finally {
    ending.value = null
  }
}

const STATUS: Record<PaymentStatus, { label: string; badge: string }> = {
  paid: { label: 'Payé', badge: 'badge-success' },
  pending: { label: 'En attente', badge: 'badge-warning' },
  failed: { label: 'Échoué', badge: 'badge-error' },
  refunded: { label: 'Remboursé', badge: 'badge-neutral' },
}
// Un acompte de rendez-vous est rangé sous un nom réservé, qui n'est pas une collection.
const collectionLabel = (key: string) => (key === 'appointments' ? 'Rendez-vous' : schema.value.collections?.[key]?.label ?? key)
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
    ['Date', 'Statut', 'Produit', 'Quantité', 'Montant', 'Remboursé', 'Devise', 'E-mail', 'Nom', 'Adresse de livraison', 'Référence Stripe', 'Mode', 'Provenance', 'Campagne', 'Mot-clé', 'Source'],
    ...list.value.map(p => [
      when(p), STATUS[p.status].label, p.title, String(p.quantity), decimals(p, p.amount), decimals(p, p.refundedAmount), p.currency.toUpperCase(),
      p.email ?? '', p.name ?? '', formatShipping(p.shipping).replace(/\n/g, ', '), p.paymentIntent ?? p.sessionId, p.livemode ? 'Production' : 'Test',
      CHANNELS[channelOfRow(p.origin)], p.origin?.campaign ?? '', p.origin?.term ?? '', [p.origin?.source ?? p.origin?.referrer, p.origin?.medium].filter(Boolean).join(' / '),
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
        <p class="text-sm text-base-content/60">Les paiements confirmés par Stripe, et les abonnements en cours. Remboursements et litiges se gèrent dans le tableau de bord Stripe.</p>
      </div>
      <button class="btn btn-sm ml-auto" :disabled="!list.length" @click="exportCsv"><Download :size="16" />Exporter</button>
    </div>

    <div role="tablist" class="tabs tabs-border mb-3">
      <a role="tab" class="tab" :class="{ 'tab-active': mode === 'live' }" @click="mode = 'live'; selected = null; channel = null; days = null">Vrais paiements<span class="badge badge-sm ml-2">{{ count(true) }}</span></a>
      <a role="tab" class="tab" :class="{ 'tab-active': mode === 'test' }" @click="mode = 'test'; selected = null; channel = null; days = null">Essais (mode test)<span class="badge badge-sm ml-2">{{ count(false) }}</span></a>
    </div>
    <div v-if="mode === 'test'" class="alert alert-warning alert-soft text-sm mb-3">Paiements de test : aucun argent n'a circulé.</div>
    <CmsOriginStats
      v-if="paidRows.length" v-model:days="days" v-model:channel="channel" :rows="paidRows" :noun="['paiement réussi', 'paiements réussis']" class="mb-4"
      :amount="oneCurrency ? (p: Payment) => p.amount - p.refundedAmount : undefined" :format-amount="oneCurrency ? (n: number) => formatAmount(n, oneCurrency!) : undefined"
    />
    <div v-if="subscriptions.length" class="card bg-base-100 border border-base-300 overflow-x-auto mb-4" data-subscriptions>
      <h2 class="font-semibold px-4 py-3 border-b border-base-300 flex items-center gap-2"><Repeat :size="16" />Abonnements <span class="badge badge-sm badge-ghost">{{ subscriptions.filter(s => s.status !== 'canceled').length }} en cours</span></h2>
      <table class="table table-sm">
        <thead><tr><th>Abonné</th><th>Offre</th><th>État</th><th class="hidden sm:table-cell">Échéance</th><th><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>
          <tr v-for="s in subscriptions" :key="s.id" :class="{ 'bg-primary/5': focusedSubscription === s.id }" :data-subscription="s.subscriptionId" :data-status="s.status">
            <td class="min-w-0"><div class="font-medium break-all">{{ s.email ?? '—' }}</div><div v-if="s.name" class="text-xs text-base-content/60">{{ s.name }}</div></td>
            <td>{{ s.title }}<div class="text-xs text-base-content/60 whitespace-nowrap">{{ formatAmount(s.amount, s.currency) }} {{ INTERVAL_LABELS[s.interval] }}</div></td>
            <td>
              <span class="badge badge-sm badge-soft whitespace-nowrap" :class="SUBSCRIPTION_BADGE[s.status]">{{ SUBSCRIPTION_STATUS_LABELS[s.status] }}</span>
              <div v-if="s.cancelAtPeriodEnd && s.status !== 'canceled'" class="text-xs text-base-content/60 mt-0.5" data-subscription-ending>Résiliation demandée</div>
            </td>
            <td class="hidden sm:table-cell text-base-content/70 whitespace-nowrap">
              <template v-if="s.status === 'canceled'">Fin le {{ day(s.canceledAt) || '—' }}</template>
              <template v-else-if="s.currentPeriodEnd">{{ s.cancelAtPeriodEnd ? 'Fin' : 'Prochain prélèvement' }} le {{ day(s.currentPeriodEnd) }}</template>
              <template v-else>—</template>
            </td>
            <td class="text-right whitespace-nowrap">
              <button v-if="user?.role === 'admin' && s.status !== 'canceled' && !s.cancelAtPeriodEnd" class="btn btn-ghost btn-xs" :disabled="ending === s.id" data-subscription-cancel @click="endSubscription(s)">Résilier</button>
              <a class="btn btn-ghost btn-xs btn-square" :href="subscriptionUrl(s)" target="_blank" rel="noopener" title="Voir dans Stripe" aria-label="Voir dans Stripe"><ExternalLink :size="14" /></a>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="totals.length" class="text-sm mb-3">Encaissé : <strong>{{ totals.join(' · ') }}</strong> <span class="text-base-content/60">(paiements réussis, remboursements déduits<template v-if="days !== null || channel"> ; seulement la période et le canal choisis ci-dessus, comme l'export</template>)</span></p>

    <div class="grid lg:grid-cols-[1fr_24rem] gap-6 items-start">
      <div class="card bg-base-100 border border-base-300 overflow-hidden">
        <div v-if="!list.length" class="p-10 text-center text-sm text-base-content/50">{{ ofMode.length ? 'Aucun paiement pour cette période ou ce canal.' : 'Aucun paiement pour l\'instant.' }}</div>
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
            <div v-if="selected.discountAmount"><dt class="text-base-content/60">Remise (code promo)</dt><dd data-detail-discount>{{ money(selected, selected.discountAmount) }}</dd></div>
            <div v-if="selected.refundedAmount"><dt class="text-base-content/60">Remboursé</dt><dd>{{ money(selected, selected.refundedAmount) }}</dd></div>
            <div v-if="selected.subscription"><dt class="text-base-content/60">Abonnement</dt><dd class="font-mono text-xs break-all">{{ selected.subscription }}</dd></div>
            <div><dt class="text-base-content/60">Acheteur</dt><dd class="break-words">{{ [selected.name, selected.email].filter(Boolean).join(' · ') || '—' }}</dd></div>
            <div v-if="selected.shipping"><dt class="text-base-content/60">Adresse de livraison</dt><dd class="whitespace-pre-wrap">{{ formatShipping(selected.shipping) }}</dd></div>
            <div><dt class="text-base-content/60">Référence Stripe</dt><dd class="font-mono text-xs break-all">{{ selected.paymentIntent ?? selected.sessionId }}</dd></div>
          </dl>
          <CmsOriginDetail :origin="selected.origin" :conversion="selected.conversion" />
          <div v-if="selected.status === 'pending'" class="alert alert-soft alert-warning text-xs">Paiement différé (virement, prélèvement…) : Stripe préviendra le site quand il aboutira ou échouera.</div>
          <div class="flex flex-wrap gap-2 pt-1">
            <a class="btn btn-sm btn-primary grow" :href="dashboardUrl(selected)" target="_blank" rel="noopener"><ExternalLink :size="16" />Voir dans Stripe</a>
            <a v-if="selected.invoice" class="btn btn-sm" :href="`/api/cms/payments/${selected.id}/invoice`" target="_blank" rel="noopener" data-detail-invoice><FileText :size="16" />Facture PDF</a>
            <a v-if="selected.email" class="btn btn-sm" :href="`mailto:${selected.email}`" title="Écrire à l'acheteur" aria-label="Écrire à l'acheteur"><Mail :size="16" /></a>
          </div>
        </div>
      </aside>
    </div>
  </section>
</template>
