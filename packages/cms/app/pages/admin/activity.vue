<script setup lang="ts">
import { ArrowRight, Download, Search } from '@lucide/vue'
import { ACTIVITY_ACTIONS, ACTIVITY_CATEGORIES, type ActivityCategory } from '../../../shared/activity'

definePageMeta({ layout: 'admin', middleware: ['cms-auth', 'cms-admin'] })

type Line = { id: string; at: string; action: string; category: string; actorName: string | null; actorEmail: string | null; summary: string; ip: string | null; link: string | null }
type Page = { items: Line[]; next: string | null; actors: { email: string; name: string }[] | null; retentionDays: number }

const toast = useCmsToast()
const filters = reactive({ q: '', actor: '', kind: '', from: '', to: '' })

/** Types d'action proposés : une famille entière, ou une action précise (plusieurs codes peuvent porter le même libellé). */
const kinds = (Object.entries(ACTIVITY_CATEGORIES) as [ActivityCategory, string][]).map(([category, label]) => {
  const byLabel = new Map<string, string[]>()
  for (const [code, meta] of Object.entries(ACTIVITY_ACTIONS)) if (meta.category === category) byLabel.set(meta.label, [...(byLabel.get(meta.label) ?? []), code])
  return { category, label, actions: [...byLabel].map(([name, codes]) => ({ label: name, value: `a:${codes.join(',')}` })) }
})

function query(): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  if (filters.q.trim()) out.q = filters.q.trim()
  if (filters.actor) out.actor = filters.actor
  if (filters.kind.startsWith('c:')) out.category = filters.kind.slice(2)
  if (filters.kind.startsWith('a:')) out.action = filters.kind.slice(2)
  // Les jours sont ceux de la personne qui lit (son fuseau horaire), du début du premier à la fin du dernier.
  if (filters.from) out.from = new Date(`${filters.from}T00:00:00`).getTime()
  if (filters.to) out.to = new Date(`${filters.to}T23:59:59.999`).getTime()
  return out
}
const load = (before?: string) => cmsApi<Page>('/api/cms/activity', { query: { ...query(), ...(before ? { before } : {}) } })

const first = await load().catch((e) => { throw createError({ statusCode: e?.statusCode ?? 500, message: cmsErrorMessage(e), fatal: true }) })
const lines = ref(first.items)
const next = ref(first.next)
const actors = ref(first.actors ?? [])
const retentionDays = first.retentionDays
const loading = ref(false)
const filtered = computed(() => Object.values(filters).some(Boolean))

/** Recharge depuis le début avec les filtres ; une réponse arrivée après un filtre plus récent est ignorée. */
let request = 0
async function reload() {
  const mine = ++request
  loading.value = true
  try {
    const page = await load()
    if (mine !== request) return
    lines.value = page.items
    next.value = page.next
    if (page.actors) actors.value = page.actors
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
  if (mine === request) loading.value = false
}
async function more() {
  if (!next.value || loading.value) return
  loading.value = true
  try {
    const page = await load(next.value)
    lines.value = [...lines.value, ...page.items]
    next.value = page.next
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
  loading.value = false
}
let timer: ReturnType<typeof setTimeout> | undefined
watch(() => filters.q, () => { clearTimeout(timer); timer = setTimeout(reload, 300) })
watch(() => [filters.actor, filters.kind, filters.from, filters.to], reload)
const reset = () => Object.assign(filters, { q: '', actor: '', kind: '', from: '', to: '' })

const exportUrl = computed(() => `/api/cms/activity/export?${new URLSearchParams(Object.entries(query()).map(([k, v]) => [k, String(v)]))}`)

// Les lignes sont regroupées par jour : « Aujourd'hui », « Hier », puis la date.
const dayKey = (iso: string) => new Date(iso).toDateString()
function dayLabel(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Aujourd\'hui'
  if (d.toDateString() === yesterday.toDateString()) return 'Hier'
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', ...(d.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }) })
}
const days = computed(() => {
  const out: { key: string; label: string; lines: Line[] }[] = []
  for (const line of lines.value) {
    const key = dayKey(line.at)
    if (out.at(-1)?.key !== key) out.push({ key, label: dayLabel(line.at), lines: [] })
    out.at(-1)!.lines.push(line)
  }
  return out
})
const time = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
/** La phrase commence par le nom de la personne : il est mis en avant, le reste suit. */
const parts = (line: Line) => (line.actorName && line.summary.startsWith(line.actorName)
  ? { who: line.actorName, rest: line.summary.slice(line.actorName.length) }
  : { who: '', rest: line.summary })
</script>

<template>
  <section class="max-w-5xl mx-auto">
    <div class="flex flex-wrap items-end gap-3 mb-6">
      <div class="min-w-0">
        <h1 class="text-2xl font-bold">Activité</h1>
        <p class="text-sm text-base-content/60">Qui a fait quoi dans le back-office, et quand. Le journal garde {{ retentionDays }} jours.</p>
      </div>
      <a class="btn btn-sm ml-auto" :class="{ 'btn-disabled': !lines.length }" :href="exportUrl" download data-activity-export><Download :size="16" />Exporter</a>
    </div>

    <div class="grid grid-cols-2 lg:grid-cols-[1fr_11rem_13rem_auto_auto] gap-2 mb-3 items-end" data-activity-filters>
      <label class="input input-sm w-full col-span-2 lg:col-span-1"><Search :size="16" class="opacity-50" /><input v-model="filters.q" type="search" class="grow" placeholder="Rechercher (titre, nom, e-mail…)" aria-label="Rechercher"></label>
      <select v-model="filters.actor" class="select select-sm w-full" aria-label="Personne">
        <option value="">Tout le monde</option>
        <option v-for="a in actors" :key="a.email" :value="a.email">{{ a.name }}</option>
        <option value="-">Actions automatiques</option>
      </select>
      <select v-model="filters.kind" class="select select-sm w-full" aria-label="Type d'action">
        <option value="">Toutes les actions</option>
        <optgroup v-for="k in kinds" :key="k.category" :label="k.label">
          <option :value="`c:${k.category}`">{{ k.label }} : tout</option>
          <option v-for="a in k.actions" :key="a.value" :value="a.value">{{ a.label }}</option>
        </optgroup>
      </select>
      <label class="input input-sm w-full"><span class="label">Du</span><input v-model="filters.from" type="date" :max="filters.to || undefined" aria-label="À partir du"></label>
      <label class="input input-sm w-full"><span class="label">Au</span><input v-model="filters.to" type="date" :min="filters.from || undefined" aria-label="Jusqu'au"></label>
    </div>

    <div class="card bg-base-100 border border-base-300 overflow-hidden" :class="{ 'opacity-60': loading }">
      <div v-if="!lines.length" class="p-12 text-center text-sm text-base-content/50">
        <template v-if="filtered">Aucune action ne correspond à ces filtres. <button class="link" @click="reset">Tout afficher</button></template>
        <template v-else>Aucune action enregistrée pour l'instant.</template>
      </div>
      <template v-for="day in days" v-else :key="day.key">
        <div class="px-4 py-1.5 bg-base-200 text-xs font-semibold text-base-content/60 first-letter:uppercase">{{ day.label }}</div>
        <ul class="divide-y divide-base-300">
          <li v-for="line in day.lines" :key="line.id" class="px-4 py-2.5 flex items-start gap-3 text-sm" data-activity-line>
            <time class="shrink-0 w-11 tabular-nums text-base-content/50 pt-px" :datetime="line.at" :title="new Date(line.at).toLocaleString('fr-FR')">{{ time(line.at) }}</time>
            <div class="min-w-0 grow break-words">
              <span v-if="parts(line).who" class="font-semibold" :title="line.actorEmail ?? ''">{{ parts(line).who }}</span>{{ parts(line).rest }}
              <span v-if="line.ip" class="text-xs text-base-content/50 whitespace-nowrap"> · adresse IP {{ line.ip }}</span>
            </div>
            <NuxtLink v-if="line.link" :to="line.link" class="btn btn-ghost btn-xs shrink-0" title="Ouvrir l'élément concerné">Voir<ArrowRight :size="14" /></NuxtLink>
          </li>
        </ul>
      </template>
    </div>

    <div v-if="next" class="text-center mt-4">
      <button class="btn btn-sm" :disabled="loading" @click="more">Afficher les actions plus anciennes</button>
    </div>
  </section>
</template>
