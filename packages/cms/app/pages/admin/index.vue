<script setup lang="ts">
import { ArrowRight, ChartLine, CircleAlert, CircleCheck, HeartPulse, Info, ListTodo, Plus, TriangleAlert } from '@lucide/vue'
import type { AudienceDay } from '../../../shared/analytics'
import { type HealthReport, healthCertainCount } from '../../../shared/health'

/**
 * Accueil du back-office : ce qui attend la personne, les contenus sur lesquels elle travaille, quelques chiffres.
 * Tout ici renvoie à un écran existant. L'audience et la santé du site sont lues après l'affichage : l'une dépend
 * d'un service externe, l'autre relit tous les contenus.
 */
definePageMeta({ layout: 'admin', middleware: 'cms-auth' })

type Task = { key: string; label: string; detail?: string; count?: number; to: string; level: 'todo' | 'warning' | 'info' }
type Entry = { type: string; typeLabel: string; id: string; title: string; status: string; at: string; by: string | null; mine: boolean; to: string }
type Data = {
  tasks: Task[]
  states: { key: string; label: string; value: string; level: 'ok' | 'warning' | 'error'; to: string }[]
  figures: { key: string; label: string; value: string; hint: string; to: string }[]
  waiting: { total: number; items: Entry[] }
  recent: Entry[]
  create: { type: string; label: string; to: string }[]
  audience: boolean
  health: boolean
}

const user = useCmsUser()
const schema = await useCmsSchema()
const data = ref(await cmsApi<Data>('/api/cms/dashboard').catch((e) => { throw createError({ statusCode: e?.statusCode ?? 500, message: cmsErrorMessage(e), fatal: true }) }))

const firstName = computed(() => (user.value?.name ?? '').trim().split(/\s+/)[0] ?? '')
const taskIcon = { todo: ListTodo, warning: TriangleAlert, info: Info }
const taskClass = { todo: 'text-primary', warning: 'text-warning', info: 'text-base-content/50' }
const stateIcon = { ok: CircleCheck, warning: TriangleAlert, error: CircleAlert }
const stateClass = { ok: 'text-success', warning: 'text-warning', error: 'text-error' }
const statusLabel: Record<string, string> = { draft: 'Brouillon', changed: 'Modifications non publiées', published: 'En ligne' }
const statusClass: Record<string, string> = { draft: 'badge-neutral', changed: 'badge-warning', published: 'badge-success' }

// Audience des sept derniers jours : seulement si un module de mesure est actif, et sans bloquer la page.
type Audience = { state: 'ok'; stats: { totals: { visits: number; pageViews: number }; days: AudienceDay[] } } | { state: string; message: string }
const audience = ref<Audience | null>(null)
// Santé du site : nombre de points certains (liens morts connus, images sans texte alternatif).
const health = ref<{ certain: number; toCheck: number; seo: number } | null>(null)
onMounted(() => {
  if (data.value.audience) cmsApi<Audience>('/api/cms/audience', { query: { period: 7 } }).then((r) => { audience.value = r }, () => {})
  if (data.value.health) cmsApi<HealthReport>('/api/cms/health').then((r) => { health.value = { certain: healthCertainCount(r), toCheck: r.links.internal.length + r.links.external.length, seo: r.seo?.improve ?? 0 } }, () => {})
})
const audienceOk = computed(() => (audience.value?.state === 'ok' ? (audience.value as Extract<Audience, { state: 'ok' }>).stats : null))
const tallest = computed(() => Math.max(1, ...(audienceOk.value?.days ?? []).map(d => d.pageViews)))
const dayName = (date: string) => new Date(date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
</script>

<template>
  <section class="max-w-6xl mx-auto space-y-6" data-dashboard>
    <div class="flex flex-wrap items-end gap-3">
      <div class="grow min-w-0">
        <h1 class="text-2xl font-bold">Bonjour{{ firstName ? ` ${firstName}` : '' }}</h1>
        <p class="text-sm text-base-content/60">{{ schema.site.name }} : ce qui vous attend, et où vous en étiez.</p>
      </div>
      <div v-if="data.create.length" class="dropdown dropdown-end">
        <button tabindex="0" class="btn btn-primary btn-sm" data-dashboard-create><Plus :size="16" />Créer</button>
        <ul tabindex="0" class="dropdown-content menu bg-base-100 border border-base-300 rounded-box shadow-lg w-56 mt-1 z-10">
          <li v-for="c in data.create" :key="c.type"><NuxtLink :to="c.to" class="first-letter:uppercase">{{ c.label }}</NuxtLink></li>
        </ul>
      </div>
    </div>

    <div v-if="data.figures.length || data.audience" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-dashboard-figures>
      <NuxtLink v-if="data.audience" to="/admin/audience" class="card bg-base-100 border border-base-300 p-4 hover:border-primary/50 transition-colors" data-dashboard-figure="audience">
        <div class="text-sm text-base-content/60 flex items-center gap-1.5"><ChartLine :size="14" />Pages vues</div>
        <template v-if="audienceOk">
          <div class="text-3xl font-bold mt-1">{{ audienceOk.totals.pageViews.toLocaleString('fr-FR') }}</div>
          <div class="text-xs text-base-content/50">7 derniers jours · {{ audienceOk.totals.visits.toLocaleString('fr-FR') }} visite{{ audienceOk.totals.visits > 1 ? 's' : '' }}</div>
          <div class="flex items-end gap-1 h-8 mt-2" aria-hidden="true">
            <span v-for="d in audienceOk.days" :key="d.date" class="grow rounded-sm bg-primary/60" :style="{ height: `${Math.max(6, Math.round(100 * d.pageViews / tallest))}%` }" :title="`${dayName(d.date)} : ${d.pageViews}`" />
          </div>
        </template>
        <div v-else-if="audience" class="text-sm text-base-content/60 mt-2">{{ (audience as { message?: string }).message }}</div>
        <div v-else class="mt-3"><span class="loading loading-dots loading-sm text-base-content/40" /></div>
      </NuxtLink>
      <NuxtLink v-for="f in data.figures" :key="f.key" :to="f.to" class="card bg-base-100 border border-base-300 p-4 hover:border-primary/50 transition-colors" :data-dashboard-figure="f.key">
        <div class="text-sm text-base-content/60">{{ f.label }}</div>
        <div class="text-3xl font-bold mt-1">{{ f.value }}</div>
        <div class="text-xs text-base-content/50">{{ f.hint }}</div>
      </NuxtLink>
    </div>

    <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] items-start">
      <div class="space-y-6 min-w-0">
        <!-- À faire -->
        <section class="card bg-base-100 border border-base-300" data-dashboard-tasks>
          <h2 class="font-semibold p-4 border-b border-base-300">À faire</h2>
          <ul v-if="data.tasks.length" class="divide-y divide-base-300">
            <li v-for="t in data.tasks" :key="t.key" :data-dashboard-task="t.key">
              <NuxtLink :to="t.to" class="flex items-start gap-3 p-4 hover:bg-base-200/60">
                <component :is="taskIcon[t.level]" :size="18" class="shrink-0 mt-0.5" :class="taskClass[t.level]" />
                <span class="grow min-w-0">
                  <span class="block font-medium">{{ t.label }}</span>
                  <span v-if="t.detail" class="block text-sm text-base-content/60 break-words">{{ t.detail }}</span>
                </span>
                <ArrowRight :size="16" class="shrink-0 mt-1 text-base-content/40" />
              </NuxtLink>
            </li>
          </ul>
          <p v-else class="p-6 text-sm text-base-content/60 flex items-center gap-2" data-dashboard-clear><CircleCheck :size="18" class="text-success shrink-0" />Rien ne vous attend pour l'instant.</p>
        </section>

        <!-- En attente de publication -->
        <section v-if="data.waiting.items.length" class="card bg-base-100 border border-base-300" data-dashboard-waiting>
          <h2 class="font-semibold p-4 border-b border-base-300">
            En attente de publication <span class="badge badge-sm badge-ghost ml-1">{{ data.waiting.total }}</span>
          </h2>
          <ul class="divide-y divide-base-300">
            <li v-for="e in data.waiting.items" :key="e.id">
              <NuxtLink :to="e.to" class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-base-200/60">
                <span class="grow min-w-0"><span class="font-medium break-words">{{ e.title }}</span><span class="text-sm text-base-content/50 ml-2">{{ e.typeLabel }}</span></span>
                <span class="badge badge-sm badge-soft whitespace-nowrap" :class="statusClass[e.status]">{{ statusLabel[e.status] }}</span>
                <span class="text-xs text-base-content/50 whitespace-nowrap">{{ cmsFormatWhen(e.at) }}</span>
              </NuxtLink>
            </li>
          </ul>
          <p v-if="data.waiting.total > data.waiting.items.length" class="px-4 py-2 text-xs text-base-content/50 border-t border-base-300">… et {{ data.waiting.total - data.waiting.items.length }} autres.</p>
        </section>

        <!-- Modifié récemment -->
        <section class="card bg-base-100 border border-base-300" data-dashboard-recent>
          <h2 class="font-semibold p-4 border-b border-base-300">Modifié récemment</h2>
          <ul v-if="data.recent.length" class="divide-y divide-base-300">
            <li v-for="e in data.recent" :key="e.id">
              <NuxtLink :to="e.to" class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-base-200/60">
                <span class="grow min-w-0"><span class="font-medium break-words">{{ e.title }}</span><span class="text-sm text-base-content/50 ml-2">{{ e.typeLabel }}</span></span>
                <span class="text-xs text-base-content/50 whitespace-nowrap">{{ cmsFormatWhen(e.at) }}<template v-if="e.by"> · {{ e.mine ? 'vous' : e.by }}</template></span>
              </NuxtLink>
            </li>
          </ul>
          <p v-else class="p-6 text-sm text-base-content/60">Aucun contenu pour l'instant. Le menu, à gauche, mène à chacun d'eux.</p>
        </section>
      </div>

      <div class="space-y-6 min-w-0">
        <!-- Santé du site -->
        <NuxtLink v-if="data.health" to="/admin/health" class="card bg-base-100 border border-base-300 p-4 flex flex-row items-start gap-3 hover:border-primary/50 transition-colors" data-dashboard-health>
          <HeartPulse :size="18" class="shrink-0 mt-0.5" :class="health?.certain ? 'text-warning' : 'text-base-content/50'" />
          <span class="grow min-w-0">
            <span class="block font-semibold">Santé du site</span>
            <span v-if="!health" class="loading loading-dots loading-sm text-base-content/40" />
            <span v-else class="block text-sm text-base-content/70">
              <template v-if="health.certain">{{ health.certain }} point{{ health.certain > 1 ? 's' : '' }} à corriger (liens, images).</template>
              <template v-else>Rien de certain à corriger.</template>
              <template v-if="health.toCheck"> {{ health.toCheck }} lien{{ health.toCheck > 1 ? 's' : '' }} à vérifier en ouvrant l'écran.</template>
              <template v-if="health.seo"> {{ health.seo }} page{{ health.seo > 1 ? 's' : '' }} à améliorer pour le référencement.</template>
            </span>
          </span>
          <ArrowRight :size="16" class="shrink-0 mt-1 text-base-content/40" />
        </NuxtLink>

        <!-- État du site (administrateur) -->
        <section v-if="data.states.length" class="card bg-base-100 border border-base-300" data-dashboard-states>
          <h2 class="font-semibold p-4 border-b border-base-300">État du site</h2>
          <ul class="divide-y divide-base-300">
            <li v-for="s in data.states" :key="s.key" :data-dashboard-state="s.key" :data-level="s.level">
              <NuxtLink :to="s.to" class="flex items-start gap-3 px-4 py-3 hover:bg-base-200/60">
                <component :is="stateIcon[s.level]" :size="16" class="shrink-0 mt-0.5" :class="stateClass[s.level]" />
                <span class="min-w-0"><span class="block text-sm text-base-content/60">{{ s.label }}</span><span class="block text-sm font-medium break-words">{{ s.value }}</span></span>
              </NuxtLink>
            </li>
          </ul>
        </section>
      </div>
    </div>
  </section>
</template>
