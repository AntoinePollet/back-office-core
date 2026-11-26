<script setup lang="ts">
import { Download, RefreshCw, Search, Trash2, TriangleAlert, UserMinus } from '@lucide/vue'
import { CHANNELS, type StoredOrigin, channelOfRow } from '../../../shared/attribution'
import { NEWSLETTER_STATUS_LABELS, type NewsletterStatus } from '../../../shared/newsletter'

/**
 * Inscrits à la lettre d'information (module `newsletter`) : qui s'est inscrit, quand, et depuis quelle page.
 * Le site recueille les inscriptions ; la lettre elle-même part de Brevo, de Resend ou d'un autre outil.
 */
definePageMeta({ layout: 'admin', middleware: 'cms-auth' })

type Subscriber = {
  id: string; email: string; locale: string; status: NewsletterStatus; source: string | null; origin: StoredOrigin | null
  createdAt: string; confirmedAt: string | null; unsubscribedAt: string | null
  sync: { provider: string; ok: boolean; detail: string; at: number } | null
}
type Data = {
  subscribers: Subscriber[]; counts: Record<NewsletterStatus, number>; max: number; pendingDays: number
  mail: { configured: boolean; module: { id: string; label: string } | null }
  list: { set: boolean; provider: string | null; unsynced: number }
}

const load = () => cmsApi<Data>('/api/cms/newsletter')
const data = ref(await load().catch((e) => { throw createError({ statusCode: e?.statusCode ?? 500, message: cmsErrorMessage(e), fatal: true }) }))
const schema = await useCmsSchema()
const multi = (schema.value.site.locales as readonly string[]).length > 1
const user = useCmsUser()
const toast = useCmsToast()

const status = ref<NewsletterStatus>('confirmed')
const search = ref('')
const tabs = computed(() => (['confirmed', 'pending', 'unsubscribed'] as const).map(id => ({ id, label: { confirmed: 'Inscrits', pending: 'En attente', unsubscribed: 'Désinscrits' }[id], count: data.value.counts[id] })))
const shown = computed(() => {
  const needle = search.value.trim().toLowerCase()
  return data.value.subscribers.filter(s => s.status === status.value && (!needle || s.email.includes(needle)))
})
const when = (s: Subscriber) => cmsFormatWhen(s.status === 'confirmed' ? s.confirmedAt ?? s.createdAt : s.status === 'unsubscribed' ? s.unsubscribedAt ?? s.createdAt : s.createdAt)
const channel = (s: Subscriber) => (s.origin ? CHANNELS[channelOfRow(s.origin)] : '')
const total = computed(() => data.value.counts.confirmed + data.value.counts.pending + data.value.counts.unsubscribed)

async function act(run: () => Promise<unknown>, done: string) {
  try {
    await run()
    data.value = await load()
    toast.success(done)
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
}
function unsubscribe(s: Subscriber) {
  if (!confirm(`Désinscrire ${s.email} ? Cette personne ne recevra plus la lettre.`)) return
  return act(() => cmsApi(`/api/cms/newsletter/${s.id}/unsubscribe`, { method: 'POST' }), 'Personne désinscrite')
}
function erase(s: Subscriber) {
  if (!confirm(`Effacer ${s.email} ? Son adresse et les dates de son inscription disparaissent du back-office.`)) return
  return act(() => cmsApi(`/api/cms/newsletter/${s.id}`, { method: 'DELETE' }), 'Inscrit effacé')
}

// Rattrapage : reporter dans la liste du service d'envoi les inscrits qui n'y sont pas encore, par paquets.
const syncing = ref(false)
async function syncAll() {
  syncing.value = true
  try {
    let moved = 0
    for (let turn = 0; turn < 200; turn++) {
      const result = await cmsApi<{ done: number; failed: number; error: string; remaining: number }>('/api/cms/newsletter/sync', { method: 'POST' })
      moved += result.done
      if (result.failed) { toast.error(`Le report s'est arrêté : ${result.error || 'le service a refusé.'}`); break }
      if (!result.remaining) { toast.success(`${moved} inscrit${moved > 1 ? 's' : ''} reporté${moved > 1 ? 's' : ''} dans la liste`); break }
    }
    data.value = await load()
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
  finally {
    syncing.value = false
  }
}
</script>

<template>
  <section class="max-w-6xl mx-auto" data-newsletter>
    <div class="flex flex-wrap items-center gap-3 mb-6">
      <div class="grow min-w-0">
        <h1 class="text-2xl font-bold">Lettre d'information</h1>
        <p class="text-sm text-base-content/60">
          Les personnes qui ont demandé la lettre depuis le site. Une inscription ne compte qu'une fois confirmée par le lien reçu par e-mail ;
          une demande jamais confirmée est effacée au bout de {{ data.pendingDays }} jours.
        </p>
      </div>
      <a class="btn btn-sm" :class="{ 'btn-disabled': !data.counts.confirmed }" href="/api/cms/newsletter/export" download data-newsletter-export><Download :size="16" />Exporter les inscrits</a>
    </div>

    <div v-if="!data.mail.configured" class="alert alert-warning mb-4" role="alert" data-newsletter-nomail>
      <TriangleAlert :size="18" />
      <span>
        Aucun envoi d'e-mails n'est réglé sur ce site : l'e-mail de confirmation ne peut pas partir, et les inscriptions sont refusées.
        <NuxtLink v-if="user?.role === 'admin'" to="/admin/modules" class="link">Régler Brevo ou Resend</NuxtLink>
      </span>
    </div>

    <div class="stats stats-vertical sm:stats-horizontal bg-base-100 border border-base-300 w-full mb-4">
      <div class="stat">
        <div class="stat-title">Inscrits</div>
        <div class="stat-value text-3xl" data-newsletter-count="confirmed">{{ data.counts.confirmed }}</div>
      </div>
      <div class="stat">
        <div class="stat-title">En attente de confirmation</div>
        <div class="stat-value text-3xl" data-newsletter-count="pending">{{ data.counts.pending }}</div>
      </div>
      <div class="stat">
        <div class="stat-title">Liste d'envoi</div>
        <div class="stat-desc whitespace-normal text-sm mt-1" data-newsletter-list>
          <template v-if="!data.list.set">
            Aucune liste désignée : les inscrits restent ici. <NuxtLink v-if="user?.role === 'admin'" to="/admin/modules/newsletter" class="link">Désigner une liste Brevo ou Resend</NuxtLink>
          </template>
          <template v-else-if="!data.list.provider">La liste est désignée, mais aucun service d'envoi réglé ne sait la tenir.</template>
          <template v-else-if="data.list.unsynced">
            {{ data.list.unsynced }} inscrit{{ data.list.unsynced > 1 ? 's ne sont' : ' n\'est' }} pas encore dans la liste {{ data.list.provider }}.
            <button class="btn btn-xs ml-1" :disabled="syncing" data-newsletter-sync @click="syncAll"><RefreshCw :size="12" :class="{ 'animate-spin': syncing }" />Les y reporter</button>
          </template>
          <template v-else>Tous les inscrits sont dans la liste {{ data.list.provider }}.</template>
        </div>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2 mb-3">
      <div role="tablist" class="tabs tabs-box tabs-sm">
        <a v-for="t in tabs" :key="t.id" role="tab" class="tab gap-1.5" :class="{ 'tab-active': status === t.id }" :data-newsletter-tab="t.id" @click="status = t.id">
          {{ t.label }}<span class="badge badge-xs badge-ghost">{{ t.count }}</span>
        </a>
      </div>
      <label class="input input-sm grow min-w-40 max-w-xs ml-auto"><Search :size="16" class="opacity-50" /><input v-model="search" type="search" class="grow" placeholder="Rechercher une adresse" aria-label="Rechercher une adresse"></label>
    </div>

    <div class="card bg-base-100 border border-base-300 overflow-x-auto">
      <table v-if="shown.length" class="table table-sm">
        <thead>
          <tr>
            <th>Adresse</th>
            <th>{{ status === 'confirmed' ? 'Confirmé' : status === 'pending' ? 'Demandé' : 'Désinscrit' }}</th>
            <th class="hidden md:table-cell">Page d'inscription</th>
            <th class="hidden lg:table-cell">Provenance</th>
            <th v-if="data.list.set && status === 'confirmed'" class="hidden sm:table-cell">Liste d'envoi</th>
            <th><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in shown" :key="s.id" data-newsletter-row :data-status="s.status">
            <td class="break-all">
              {{ s.email }}<span v-if="multi" class="badge badge-xs badge-ghost uppercase ml-1.5">{{ s.locale }}</span>
            </td>
            <td class="whitespace-nowrap text-base-content/70" :title="`${NEWSLETTER_STATUS_LABELS[s.status]} · demande du ${new Date(s.createdAt).toLocaleString('fr-FR')}`">{{ when(s) }}</td>
            <td class="hidden md:table-cell text-base-content/70">{{ s.source ?? '—' }}</td>
            <td class="hidden lg:table-cell text-base-content/70">{{ channel(s) || '—' }}<template v-if="s.origin?.campaign"> · {{ s.origin.campaign }}</template></td>
            <td v-if="data.list.set && status === 'confirmed'" class="hidden sm:table-cell">
              <span v-if="s.sync?.ok" class="badge badge-sm badge-soft badge-success">{{ s.sync.provider }}</span>
              <span v-else-if="s.sync" class="badge badge-sm badge-soft badge-warning" :title="s.sync.detail">Non reporté</span>
              <span v-else class="text-base-content/40">—</span>
            </td>
            <td class="text-right whitespace-nowrap">
              <button v-if="s.status === 'confirmed'" class="btn btn-ghost btn-xs btn-square" title="Désinscrire" aria-label="Désinscrire" @click="unsubscribe(s)"><UserMinus :size="15" /></button>
              <button class="btn btn-ghost btn-xs btn-square text-error" title="Effacer" aria-label="Effacer" @click="erase(s)"><Trash2 :size="15" /></button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="p-10 text-center text-sm text-base-content/50" data-newsletter-empty>
        {{ search ? 'Aucune adresse ne correspond.' : status === 'confirmed' ? 'Aucun inscrit pour l\'instant.' : status === 'pending' ? 'Aucune demande en attente.' : 'Aucune désinscription.' }}
      </p>
    </div>
    <p v-if="total > data.max" class="text-xs text-base-content/50 mt-3">Les {{ data.max }} lignes les plus récentes sont affichées ; l'export les contient toutes.</p>
    <p class="text-xs text-base-content/50 mt-3">
      L'export joint à chaque inscrit son lien de désinscription, à placer dans les lettres envoyées depuis un autre outil. Une désinscription faite
      depuis une lettre envoyée par Brevo ou Resend est tenue par ce service : elle n'apparaît pas ici.
    </p>
  </section>
</template>
