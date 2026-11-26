<script setup lang="ts">
import { ExternalLink, RefreshCw, Search, Settings } from '@lucide/vue'
import { SEARCH_CONSOLE_LAG_DAYS, SEARCH_CONSOLE_PERIODS, type ScPeriod, type ScReport, formatCtr, formatPosition } from '../../../shared/search-console'

// Les chiffres de recherche sont ouverts à l'administrateur et à l'éditeur (le serveur le vérifie aussi).
definePageMeta({ layout: 'admin', middleware: ['cms-auth', 'cms-editor'] })

type Answer =
  | { state: 'ok'; property: string; days: ScPeriod; from: string; to: string; report: ScReport; updatedAt: string }
  | { state: 'unconfigured' | 'refused' | 'unavailable'; message: string }

const user = useCmsUser()
const isAdmin = computed(() => user.value?.role === 'admin')
const days = ref<ScPeriod>(28)
const answer = ref<Answer | null>(null)
const loading = ref(false)
let request = 0

async function load() {
  const mine = ++request
  loading.value = true
  try {
    const result = await cmsApi<Answer>('/api/cms/search-console', { query: { days: days.value } })
    if (mine === request) answer.value = result
  }
  catch (e) {
    if (mine === request) answer.value = { state: 'unavailable', message: cmsErrorMessage(e, 'Les chiffres de Search Console n\'ont pas pu être lus.') }
  }
  finally {
    if (mine === request) loading.value = false
  }
}
await load()
watch(days, load)

// Pages du site que la personne peut modifier : une page citée par Google mène à son onglet Référencement.
const seoPages = ref<{ path: string; to: string; name: string }[]>([])
onMounted(() => cmsApi<{ path: string; to: string; name: string }[]>('/api/cms/seo').then((rows) => { seoPages.value = rows }, () => {}))
const known = computed(() => new Map(seoPages.value.map(p => [p.path.length > 1 ? p.path.replace(/\/+$/, '') : p.path, p])))

const ok = computed(() => (answer.value?.state === 'ok' ? answer.value : null))
const report = computed(() => ok.value?.report ?? null)
const count = (n: number) => n.toLocaleString('fr-FR')
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
const tallest = computed(() => Math.max(1, ...(report.value?.days ?? []).map(d => d.clicks)))

/** Les pages sont nombreuses : les premières d'abord, le reste à la demande. */
const PAGE_STEP = 25
const shownPages = ref(PAGE_STEP)
watch(report, () => { shownPages.value = PAGE_STEP })
const pageUrl = (path: string) => {
  const property = ok.value?.property ?? ''
  return property.startsWith('http') ? new URL(path, property).href : `https://${property.replace(/^sc-domain:/, '')}${path}`
}
</script>

<template>
  <section class="max-w-6xl mx-auto" data-sc>
    <div class="flex flex-wrap items-end gap-3 mb-6">
      <div class="min-w-0 grow">
        <h1 class="text-2xl font-bold">Recherche Google</h1>
        <p class="text-sm text-base-content/60">
          Ce que Google montre du site dans ses résultats, d'après Search Console.
          <template v-if="ok">Du {{ day(ok.from) }} au {{ day(ok.to) }} : Google publie ses chiffres avec {{ SEARCH_CONSOLE_LAG_DAYS }} à 3 jours de retard.</template>
        </p>
      </div>
      <div class="join" role="group" aria-label="Période">
        <button v-for="p in SEARCH_CONSOLE_PERIODS" :key="p" class="btn btn-sm join-item" :class="days === p ? 'btn-primary' : ''" :aria-pressed="days === p" :data-sc-period="p" @click="days = p">{{ p }} jours</button>
      </div>
    </div>

    <!-- Module pas encore réglé. -->
    <div v-if="answer?.state === 'unconfigured'" class="card bg-base-100 border border-base-300 p-8 text-center items-center gap-3" data-sc-state="unconfigured">
      <Search :size="32" class="text-base-content/30" />
      <p class="font-medium">Search Console n'est pas encore réglé.</p>
      <template v-if="isAdmin">
        <p class="text-sm text-base-content/60 max-w-md">Il faut saisir une fois le nom de la propriété et les identifiants d'accès. Les recherches apparaîtront ensuite ici.</p>
        <NuxtLink to="/admin/modules/search-console" class="btn btn-primary btn-sm"><Settings :size="16" />Régler Search Console</NuxtLink>
      </template>
      <p v-else class="text-sm text-base-content/60 max-w-md">Demandez à l'administrateur du site de le régler (écran « Modules »).</p>
    </div>

    <!-- Accès refusé, ou panne. -->
    <div v-else-if="answer && answer.state !== 'ok'" class="alert alert-soft items-start" :class="answer.state === 'refused' ? 'alert-error' : 'alert-warning'" role="alert" :data-sc-state="answer.state">
      <div class="space-y-2">
        <p class="font-medium">{{ answer.state === 'refused' ? 'Google refuse l\'accès aux chiffres.' : 'Les chiffres de Search Console ne sont pas disponibles pour le moment.' }}</p>
        <p class="text-sm" data-sc-message>{{ answer.message }}</p>
        <p v-if="answer.state === 'refused' && !isAdmin" class="text-sm">Prévenez l'administrateur du site : un réglage est à corriger.</p>
        <div class="flex flex-wrap gap-2">
          <NuxtLink v-if="answer.state === 'refused' && isAdmin" to="/admin/modules/search-console" class="btn btn-sm"><Settings :size="16" />Vérifier les réglages</NuxtLink>
          <button v-if="answer.state === 'unavailable'" class="btn btn-sm" :disabled="loading" @click="load"><RefreshCw :size="16" />Réessayer</button>
        </div>
      </div>
    </div>

    <template v-else-if="report">
      <div class="transition-opacity" :class="loading ? 'opacity-50' : ''" data-sc-state="ok">
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <div class="card bg-base-100 border border-base-300 p-4 sm:p-5">
            <div class="text-sm text-base-content/60">Clics</div>
            <div class="text-2xl sm:text-3xl font-bold tabular-nums" data-sc-total="clicks">{{ count(report.totals.clicks) }}</div>
            <div class="text-xs text-base-content/50 mt-1">Visites venues d'un résultat de Google</div>
          </div>
          <div class="card bg-base-100 border border-base-300 p-4 sm:p-5">
            <div class="text-sm text-base-content/60">Affichages</div>
            <div class="text-2xl sm:text-3xl font-bold tabular-nums" data-sc-total="impressions">{{ count(report.totals.impressions) }}</div>
            <div class="text-xs text-base-content/50 mt-1">Fois où le site est apparu dans les résultats</div>
          </div>
          <div class="card bg-base-100 border border-base-300 p-4 sm:p-5">
            <div class="text-sm text-base-content/60">Taux de clic</div>
            <div class="text-2xl sm:text-3xl font-bold tabular-nums" data-sc-total="ctr">{{ formatCtr(report.totals.ctr) }}</div>
            <div class="text-xs text-base-content/50 mt-1">Clics divisés par les affichages</div>
          </div>
          <div class="card bg-base-100 border border-base-300 p-4 sm:p-5">
            <div class="text-sm text-base-content/60">Position moyenne</div>
            <div class="text-2xl sm:text-3xl font-bold tabular-nums" data-sc-total="position">{{ formatPosition(report.totals.position) }}</div>
            <div class="text-xs text-base-content/50 mt-1">1 : premier résultat. Plus c'est bas, mieux c'est.</div>
          </div>
        </div>

        <div v-if="!report.totals.impressions" class="card bg-base-100 border border-base-300 p-8 text-center items-center gap-2" data-sc-empty>
          <Search :size="32" class="text-base-content/30" />
          <p class="font-medium">Google n'a montré le site dans aucune recherche sur cette période.</p>
          <p class="text-sm text-base-content/60 max-w-md">C'est normal pour un site récent : il faut quelques jours à quelques semaines avant les premiers affichages. Vérifiez dans Search Console que le plan du site (<code>/sitemap.xml</code>) a bien été envoyé.</p>
        </div>

        <template v-else>
          <div class="card bg-base-100 border border-base-300 p-4 sm:p-5 mb-4">
            <div class="text-sm text-base-content/60 mb-3">Clics par jour</div>
            <div class="flex items-end gap-px sm:gap-0.5 h-24" data-sc-days role="img" :aria-label="`Clics par jour du ${day(ok!.from)} au ${day(ok!.to)}`">
              <span v-for="d in report.days" :key="d.date" class="grow rounded-sm bg-primary/60 hover:bg-primary min-w-px" :style="{ height: `${Math.max(3, Math.round(100 * d.clicks / tallest))}%` }" :title="`${day(d.date)} : ${count(d.clicks)} clic${d.clicks > 1 ? 's' : ''}, ${count(d.impressions)} affichage${d.impressions > 1 ? 's' : ''}`" />
            </div>
          </div>

          <div class="grid gap-4 lg:grid-cols-2 items-start">
            <div class="card bg-base-100 border border-base-300 overflow-x-auto" data-sc-queries>
              <h2 class="font-semibold p-4 border-b border-base-300">Recherches <span class="font-normal text-sm text-base-content/50">ce que les gens ont tapé</span></h2>
              <table class="table table-sm">
                <thead><tr><th>Recherche</th><th class="text-right">Clics</th><th class="text-right hidden sm:table-cell">Affichages</th><th class="text-right">Position</th></tr></thead>
                <tbody>
                  <tr v-for="q in report.queries" :key="q.key" data-sc-query>
                    <td class="max-w-56 break-words">{{ q.key }}</td>
                    <td class="text-right tabular-nums">{{ count(q.clicks) }}</td>
                    <td class="text-right tabular-nums hidden sm:table-cell">{{ count(q.impressions) }}</td>
                    <td class="text-right tabular-nums">{{ formatPosition(q.position) }}</td>
                  </tr>
                </tbody>
              </table>
              <p v-if="!report.queries.length" class="p-6 text-sm text-base-content/60">Google ne détaille aucune recherche sur cette période (il masque les plus rares).</p>
            </div>

            <div class="card bg-base-100 border border-base-300 overflow-x-auto" data-sc-pages>
              <h2 class="font-semibold p-4 border-b border-base-300">Pages <span class="font-normal text-sm text-base-content/50">celles que Google a montrées</span></h2>
              <table class="table table-sm">
                <thead><tr><th>Page</th><th class="text-right">Clics</th><th class="text-right hidden sm:table-cell">Affichages</th><th class="text-right">Position</th></tr></thead>
                <tbody>
                  <tr v-for="p in report.pages.slice(0, shownPages)" :key="p.path" data-sc-page>
                    <td class="max-w-56">
                      <NuxtLink v-if="known.get(p.path)" :to="known.get(p.path)!.to" class="font-medium hover:underline break-words" title="Ouvrir l'onglet Référencement de cette page">{{ known.get(p.path)!.name }}</NuxtLink>
                      <div class="text-xs text-base-content/50 break-all">
                        <a :href="pageUrl(p.path)" target="_blank" rel="noopener" class="hover:underline inline-flex items-center gap-1">{{ p.path }}<ExternalLink :size="11" class="shrink-0" /></a>
                      </div>
                    </td>
                    <td class="text-right tabular-nums">{{ count(p.clicks) }}</td>
                    <td class="text-right tabular-nums hidden sm:table-cell">{{ count(p.impressions) }}</td>
                    <td class="text-right tabular-nums">{{ formatPosition(p.position) }}</td>
                  </tr>
                </tbody>
              </table>
              <div v-if="report.pages.length > shownPages" class="p-3 border-t border-base-300 text-center">
                <button class="btn btn-sm btn-ghost" @click="shownPages += PAGE_STEP">Afficher {{ Math.min(PAGE_STEP, report.pages.length - shownPages) }} pages de plus</button>
              </div>
            </div>
          </div>
        </template>

        <p class="text-xs text-base-content/50 mt-3">
          Propriété « {{ ok!.property }} ». Chiffres relus il y a moins de cinq minutes. Ils figurent aussi, page par page, dans « Pages et titres ».
        </p>
      </div>
    </template>
  </section>
</template>
