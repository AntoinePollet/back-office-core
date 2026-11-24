<script setup lang="ts">
import { Megaphone, Pause, Pencil, Play, RefreshCw, Settings } from '@lucide/vue'
import { ADS_MONTH_FACTOR, ADS_STATUS_LABELS, GOOGLE_ADS_PERIODS, type AdsAccount, type AdsPeriod, type AdsReport, type AdsReportRow, budgetLock, formatMicros, parseDailyBudget, statusLock } from '../../../shared/google-ads'
import { formatAmount } from '../../../shared/stripe'

// Les dépenses publicitaires sont ouvertes à l'administrateur et à l'éditeur (le serveur le vérifie aussi).
definePageMeta({ layout: 'admin', middleware: ['cms-auth', 'cms-editor'] })

type Answer =
  | { state: 'ok'; account: AdsAccount; from: string; to: string; report: AdsReport; updatedAt: string }
  | { state: 'unconfigured' | 'refused' | 'unavailable'; message: string }

const user = useCmsUser()
const isAdmin = computed(() => user.value?.role === 'admin')
const days = ref<AdsPeriod>(30)
const answer = ref<Answer | null>(null)
const loading = ref(false)
let request = 0

async function load() {
  const mine = ++request
  loading.value = true
  try {
    const result = await cmsApi<Answer>('/api/cms/google-ads', { query: { days: days.value } })
    if (mine === request) answer.value = result
  }
  catch (e) {
    if (mine === request) answer.value = { state: 'unavailable', message: cmsErrorMessage(e, 'Les chiffres de Google Ads n\'ont pas pu être lus.') }
  }
  finally {
    if (mine === request) loading.value = false
  }
}
await load()
watch(days, load)

const ok = computed(() => (answer.value?.state === 'ok' ? answer.value : null))
const report = computed(() => ok.value?.report ?? null)
const currency = computed(() => ok.value?.account.currency ?? 'EUR')
const count = (n: number) => n.toLocaleString('fr-FR')
const money = (micros: number) => formatMicros(micros, currency.value)
const perContact = (micros: number | null) => (micros === null ? '—' : money(micros))
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
const plural = (n: number, one: string, many: string) => `${count(n)} ${n > 1 ? many : one}`
const hasPayments = computed(() => !!report.value && report.value.totals.payments > 0)

// ───── Piloter une campagne (administrateur) : pause, reprise, budget par jour ─────
const toast = useCmsToast()
/** Campagne dont une modification est en cours d'envoi. */
const busy = ref<string | null>(null)

async function setStatus(c: AdsReportRow) {
  const pause = c.status === 'ENABLED'
  const question = pause
    ? `Mettre en pause la campagne « ${c.name} » ?\n\nSes annonces ne seront plus diffusées, jusqu'à ce que vous la relanciez.`
    : `Relancer la campagne « ${c.name} » ?\n\nSes annonces seront de nouveau diffusées, et la dépense reprendra${c.budget ? ` (budget : ${money(c.budget.amountMicros)} par jour)` : ''}.`
  if (busy.value || !confirm(question)) return
  busy.value = c.id
  try {
    await cmsApi(`/api/cms/google-ads/campaigns/${c.id}/status`, { method: 'PUT', body: { status: pause ? 'PAUSED' : 'ENABLED' } })
    toast.success(pause ? 'Campagne mise en pause' : 'Campagne relancée')
    await load()
  }
  catch (e) {
    toast.error(cmsErrorMessage(e, 'La campagne n\'a pas pu être modifiée.'))
  }
  finally {
    busy.value = null
  }
}

/** Fenêtre « Budget par jour » : la campagne concernée, la saisie, et l'erreur à afficher. */
const editing = ref<AdsReportRow | null>(null)
const amount = ref('')
const budgetError = ref<string | null>(null)
const dialog = ref<HTMLDialogElement>()
const parsed = computed(() => parseDailyBudget(amount.value))
const unchanged = computed(() => parsed.value.ok && parsed.value.micros === editing.value?.budget?.amountMicros)
// Une erreur vaut pour le montant qui l'a provoquée : elle s'efface dès que la saisie change.
watch(amount, () => { budgetError.value = null })

async function editBudget(c: AdsReportRow) {
  editing.value = c
  amount.value = ((c.budget?.amountMicros ?? 0) / 1_000_000).toLocaleString('fr-FR', { minimumFractionDigits: 2, useGrouping: false })
  budgetError.value = null
  await nextTick()
  dialog.value?.showModal()
}
async function saveBudget() {
  const c = editing.value
  if (!c?.budget || busy.value) return
  if (!parsed.value.ok) { budgetError.value = parsed.value.error; return }
  busy.value = c.id
  budgetError.value = null
  try {
    await cmsApi(`/api/cms/google-ads/campaigns/${c.id}/budget`, { method: 'PUT', body: { amount: amount.value, expectedMicros: c.budget.amountMicros } })
    dialog.value?.close()
    toast.success('Budget modifié')
    await load()
  }
  catch (e: any) {
    budgetError.value = cmsErrorMessage(e, 'Le budget n\'a pas pu être modifié.')
    // Le budget a changé entre-temps dans Google Ads : la page relit les campagnes, la fenêtre montre le nouveau montant.
    if (e?.statusCode === 409) {
      await load()
      const fresh = report.value?.campaigns.find(x => x.id === c.id)
      if (fresh) editing.value = fresh
    }
  }
  finally {
    busy.value = null
  }
}
</script>

<template>
  <section class="max-w-6xl mx-auto">
    <div class="flex flex-wrap items-end gap-3 mb-6">
      <div class="min-w-0 grow">
        <h1 class="text-2xl font-bold">Annonces Google</h1>
        <p class="text-sm text-base-content/60">
          Ce que coûtent les campagnes Google Ads, et les contacts qu'elles ont amenés sur le site.
          <template v-if="ok">Compte « {{ ok.account.name || '—' }} », du {{ day(ok.from) }} au {{ day(ok.to) }}.</template>
        </p>
      </div>
      <div class="join" role="group" aria-label="Période">
        <button v-for="p in GOOGLE_ADS_PERIODS" :key="p" class="btn btn-sm join-item" :class="days === p ? 'btn-primary' : ''" :aria-pressed="days === p" :data-ads-period="p" @click="days = p">{{ p }} jours</button>
      </div>
    </div>

    <!-- Module pas encore réglé. -->
    <div v-if="answer?.state === 'unconfigured'" class="card bg-base-100 border border-base-300 p-8 text-center items-center gap-3" data-ads-state="unconfigured">
      <Megaphone :size="32" class="text-base-content/30" />
      <p class="font-medium">Google Ads n'est pas encore réglé.</p>
      <template v-if="isAdmin">
        <p class="text-sm text-base-content/60 max-w-md">Il faut saisir une fois le numéro du compte Google Ads et les identifiants d'accès. Les campagnes apparaîtront ensuite ici.</p>
        <NuxtLink to="/admin/modules/google-ads" class="btn btn-primary btn-sm"><Settings :size="16" />Régler Google Ads</NuxtLink>
      </template>
      <p v-else class="text-sm text-base-content/60 max-w-md">Demandez à l'administrateur du site de le régler (écran « Modules »).</p>
    </div>

    <!-- Accès refusé, ou panne. -->
    <div v-else-if="answer && answer.state !== 'ok'" class="alert alert-soft items-start" :class="answer.state === 'refused' ? 'alert-error' : 'alert-warning'" role="alert" :data-ads-state="answer.state">
      <div class="space-y-2">
        <p class="font-medium">{{ answer.state === 'refused' ? 'Google Ads refuse l\'accès aux chiffres.' : 'Les chiffres de Google Ads ne sont pas disponibles pour le moment.' }}</p>
        <p class="text-sm" data-ads-message>{{ answer.message }}</p>
        <p v-if="answer.state === 'refused' && !isAdmin" class="text-sm">Prévenez l'administrateur du site : un réglage est à corriger.</p>
        <div class="flex flex-wrap gap-2">
          <NuxtLink v-if="answer.state === 'refused' && isAdmin" to="/admin/modules/google-ads" class="btn btn-sm"><Settings :size="16" />Vérifier les réglages</NuxtLink>
          <button v-if="answer.state === 'unavailable'" class="btn btn-sm" :disabled="loading" @click="load"><RefreshCw :size="16" />Réessayer</button>
        </div>
      </div>
    </div>

    <template v-else-if="report">
      <div class="transition-opacity" :class="loading ? 'opacity-50' : ''" data-ads-state="ok">
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <div class="card bg-base-100 border border-base-300 p-4 sm:p-5">
            <div class="text-sm text-base-content/60">Dépense</div>
            <div class="text-2xl sm:text-3xl font-bold tabular-nums" data-ads-total="cost">{{ money(report.totals.costMicros) }}</div>
            <div class="text-xs text-base-content/50 mt-1">{{ plural(report.totals.clicks, 'clic', 'clics') }} sur {{ plural(report.totals.impressions, 'affichage', 'affichages') }}</div>
          </div>
          <div class="card bg-base-100 border border-base-300 p-4 sm:p-5">
            <div class="text-sm text-base-content/60">Contacts du site</div>
            <div class="text-2xl sm:text-3xl font-bold tabular-nums" data-ads-total="contacts">{{ count(report.totals.contacts) }}</div>
            <div class="text-xs text-base-content/50 mt-1">
              {{ plural(report.totals.messages, 'message', 'messages') }}<template v-if="hasPayments"> et {{ plural(report.totals.payments, 'paiement', 'paiements') }}</template> venus d'une annonce
            </div>
          </div>
          <div class="card bg-base-100 border border-base-300 p-4 sm:p-5">
            <div class="text-sm text-base-content/60">Coût par contact</div>
            <div class="text-2xl sm:text-3xl font-bold tabular-nums" data-ads-total="costPerContact">{{ perContact(report.totals.costPerContactMicros) }}</div>
            <div class="text-xs text-base-content/50 mt-1">Dépense divisée par les contacts du site</div>
          </div>
          <div class="card bg-base-100 border border-base-300 p-4 sm:p-5">
            <div class="text-sm text-base-content/60">Conversions vues par Google</div>
            <div class="text-2xl sm:text-3xl font-bold tabular-nums" data-ads-total="conversions">{{ report.totals.conversions.toLocaleString('fr-FR', { maximumFractionDigits: 1 }) }}</div>
            <div class="text-xs text-base-content/50 mt-1">Selon les conversions réglées dans Google Ads</div>
          </div>
        </div>

        <div v-if="!report.campaigns.length" class="card bg-base-100 border border-base-300 p-8 text-center items-center gap-2" data-ads-empty>
          <Megaphone :size="32" class="text-base-content/30" />
          <p class="font-medium">Aucune campagne n'a été diffusée sur ces {{ days }} jours.</p>
        </div>
        <div v-else class="card bg-base-100 border border-base-300 overflow-x-auto">
          <table class="table table-sm">
            <thead>
              <tr>
                <th>Campagne</th>
                <th class="text-right hidden md:table-cell">Affichages</th>
                <th class="text-right">Budget par jour</th>
                <th class="text-right">Clics</th>
                <th class="text-right">Dépense</th>
                <th class="text-right hidden md:table-cell" title="Conversions comptées par Google Ads">Conv. Google</th>
                <th class="text-right">Contacts du site</th>
                <th class="text-right">Coût par contact</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in report.campaigns" :key="c.id" :data-ads-campaign="c.id">
                <td class="min-w-40">
                  <div class="font-medium">{{ c.name || `Campagne n° ${c.id}` }}</div>
                  <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    <span :class="c.status === 'ENABLED' ? 'text-success' : 'text-base-content/50'" data-ads-status>{{ ADS_STATUS_LABELS[c.status] ?? c.status }}</span>
                    <button
                      v-if="isAdmin && !statusLock(c)" type="button" class="btn btn-xs btn-ghost" :disabled="!!busy" data-ads-toggle
                      :title="c.status === 'ENABLED' ? 'Arrêter la diffusion des annonces de cette campagne' : 'Reprendre la diffusion des annonces de cette campagne'" @click="setStatus(c)"
                    >
                      <span v-if="busy === c.id" class="loading loading-spinner loading-xs" />
                      <component :is="c.status === 'ENABLED' ? Pause : Play" v-else :size="12" />
                      {{ c.status === 'ENABLED' ? 'Mettre en pause' : 'Relancer' }}
                    </button>
                  </div>
                </td>
                <td class="text-right tabular-nums whitespace-nowrap" data-ads-budget>
                  <template v-if="c.budget && c.budget.period === 'DAILY'">{{ money(c.budget.amountMicros) }}</template>
                  <span v-else class="text-base-content/50">—</span>
                  <button
                    v-if="isAdmin && !budgetLock(c)" type="button" class="btn btn-xs btn-ghost btn-square" :disabled="!!busy" data-ads-budget-edit
                    title="Changer le budget par jour" :aria-label="`Changer le budget par jour de la campagne ${c.name}`" @click="editBudget(c)"
                  ><Pencil :size="12" /></button>
                  <div v-else-if="isAdmin && c.status !== 'REMOVED' && budgetLock(c)" class="text-xs font-normal text-base-content/50 whitespace-normal max-w-40 ml-auto" data-ads-budget-lock>{{ budgetLock(c) }}</div>
                </td>
                <td class="text-right tabular-nums hidden md:table-cell">{{ count(c.impressions) }}</td>
                <td class="text-right tabular-nums">{{ count(c.clicks) }}</td>
                <td class="text-right tabular-nums" data-ads-cost>{{ money(c.costMicros) }}</td>
                <td class="text-right tabular-nums hidden md:table-cell">{{ c.conversions.toLocaleString('fr-FR', { maximumFractionDigits: 1 }) }}</td>
                <td class="text-right tabular-nums" data-ads-contacts>
                  <span class="font-semibold">{{ count(c.contacts) }}</span>
                  <div v-if="c.payments" class="text-xs text-base-content/60">dont {{ plural(c.payments, 'paiement', 'paiements') }}<template v-if="c.revenue"> ({{ formatAmount(c.revenue, currency.toLowerCase()) }})</template></div>
                </td>
                <td class="text-right tabular-nums font-medium" data-ads-cpc>{{ perContact(c.costPerContactMicros) }}</td>
              </tr>
              <tr v-if="report.unassigned.contacts" data-ads-unassigned>
                <td colspan="2" class="hidden md:table-cell text-base-content/70">Venus de Google Ads, campagne non retrouvée</td>
                <td class="md:hidden text-base-content/70">Campagne non retrouvée</td>
                <td /><td /><td /><td class="hidden md:table-cell" />
                <td class="text-right tabular-nums font-semibold">{{ count(report.unassigned.contacts) }}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Budget par jour d'une campagne. -->
      <dialog ref="dialog" class="modal" data-ads-budget-dialog @close="editing = null">
        <form v-if="editing?.budget" class="modal-box space-y-4" novalidate @submit.prevent="saveBudget">
          <h2 class="text-lg font-bold">Budget par jour</h2>
          <p class="text-sm text-base-content/70">Campagne « {{ editing.name }} ». Budget actuel : <strong data-ads-budget-current>{{ money(editing.budget.amountMicros) }}</strong> par jour.</p>
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Nouveau budget par jour ({{ currency }})</legend>
            <input v-model="amount" class="input w-full" :class="{ 'input-error': budgetError }" inputmode="decimal" autocomplete="off" data-ads-budget-input>
            <p v-if="budgetError" class="label text-error whitespace-normal" role="alert" data-ads-budget-error>{{ budgetError }}</p>
            <p v-else-if="parsed.ok && !unchanged" class="label whitespace-normal" data-ads-budget-effect>
              Google pourra dépenser jusqu'à {{ money(parsed.micros * 2) }} certains jours, et {{ money(Math.round(parsed.micros * ADS_MONTH_FACTOR)) }} au plus sur un mois.
            </p>
          </fieldset>
          <p class="text-xs text-base-content/60">Le changement s'applique tout de suite dans Google Ads. Il est inscrit au journal d'activité.</p>
          <div class="modal-action">
            <button type="button" class="btn btn-sm" @click="dialog?.close()">Annuler</button>
            <button class="btn btn-sm btn-primary" :disabled="!!busy || !parsed.ok || unchanged" data-ads-budget-save>
              <span v-if="busy" class="loading loading-spinner loading-xs" />Changer le budget
            </button>
          </div>
        </form>
        <form method="dialog" class="modal-backdrop"><button aria-label="Fermer">Fermer</button></form>
      </dialog>

      <p class="text-xs text-base-content/50 mt-4">
        Dépense, clics et conversions : Google Ads, relus toutes les 5 minutes (dernière lecture {{ cmsFormatWhen(ok!.updatedAt) }}), jours comptés dans le fuseau horaire du compte.
        Contacts du site : messages reçus et paiements réussis dont le visiteur est arrivé par une annonce, comptés par le site lui-même (voir « Messages reçus » et « Paiements »).
        Un visiteur qui clique sur une annonce puis revient un autre jour par un autre chemin n'est pas compté ici.
      </p>
    </template>
  </section>
</template>
