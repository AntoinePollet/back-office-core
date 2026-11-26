<script setup lang="ts">
import { ArrowDown, ArrowUp, Search } from '@lucide/vue'
import { SEO_STATE_LABELS, type SeoState } from '../../../shared/seo'
import { type ScMetrics, type ScReport, formatPosition } from '../../../shared/search-console'

/**
 * Vue d'ensemble du référencement : toutes les pages du site que la personne peut modifier, avec leur titre, leur
 * description, leur état et le nombre de points à voir. Chaque ligne ouvre l'onglet Référencement du contenu.
 * Les conseils sont calculés par le serveur avec la même logique que dans le formulaire (`shared/seo.ts`).
 */
definePageMeta({ layout: 'admin', middleware: 'cms-auth' })

type Row = {
  type: string; id: string; locale: string; typeLabel: string; name: string; path: string; status: string
  title: string; description: string; state: SeoState; points: number
  tips: { id: string; level: string; title: string; advice: string }[]
  to: string
}
type SortKey = 'name' | 'title' | 'description' | 'state' | 'points' | 'clicks' | 'position'

const schema = await useCmsSchema()
const locales = schema.value.site.locales as readonly string[]
const multi = locales.length > 1
const rows = ref(await cmsApi<Row[]>('/api/cms/seo').catch((e) => { throw createError({ statusCode: e?.statusCode ?? 500, message: cmsErrorMessage(e), fatal: true }) }))

// Module Search Console actif : clics et position de chaque page dans Google (28 jours), lus après l'affichage.
const user = useCmsUser()
const hasSearchConsole = computed(() => ['admin', 'editor'].includes(user.value?.role ?? '') && !!schema.value.modules?.some(m => m.id === 'search-console'))
const google = ref<Map<string, ScMetrics> | null>(null)
onMounted(() => {
  if (!hasSearchConsole.value) return
  cmsApi<{ state: string; report?: ScReport }>('/api/cms/search-console', { query: { days: 28 } })
    .then((r) => { if (r.state === 'ok' && r.report) google.value = new Map(r.report.pages.map(p => [p.path, p])) }, () => {})
})
const googleOf = (r: Row) => google.value?.get(r.path.length > 1 ? r.path.replace(/\/+$/, '') : r.path) ?? null

const search = ref('')
const state = ref<'all' | SeoState>('all')
const locale = ref('all')
const sort = ref<{ key: SortKey; dir: 1 | -1 }>({ key: 'points', dir: -1 })

const counts = computed(() => {
  const inLocale = rows.value.filter(r => locale.value === 'all' || r.locale === locale.value)
  const of = (s: SeoState) => inLocale.filter(r => r.state === s).length
  return { all: inLocale.length, improve: of('improve'), complete: of('complete'), hidden: of('hidden') }
})
const filters = computed(() => [
  { id: 'all' as const, label: 'Toutes', count: counts.value.all },
  { id: 'improve' as const, label: SEO_STATE_LABELS.improve, count: counts.value.improve },
  { id: 'complete' as const, label: SEO_STATE_LABELS.complete, count: counts.value.complete },
  { id: 'hidden' as const, label: SEO_STATE_LABELS.hidden, count: counts.value.hidden },
])
const stateClass: Record<SeoState, string> = { complete: 'badge-success', improve: 'badge-warning', hidden: 'badge-neutral' }
// Ordre des états pour le tri : ce qui demande de l'attention d'abord.
const stateRank: Record<SeoState, number> = { improve: 0, hidden: 1, complete: 2 }

const shown = computed(() => {
  const needle = search.value.trim().toLocaleLowerCase('fr')
  const { key, dir } = sort.value
  // Une page que Google n'a pas montrée se range après les autres, quel que soit le sens du tri.
  const value = (r: Row) => (key === 'points' ? r.points : key === 'state' ? stateRank[r.state]
    : key === 'clicks' ? googleOf(r)?.clicks ?? -1
      : key === 'position' ? googleOf(r)?.position || (dir === 1 ? Number.MAX_VALUE : -1)
        : r[key].toLocaleLowerCase('fr'))
  return rows.value
    .filter(r => (state.value === 'all' || r.state === state.value) && (locale.value === 'all' || r.locale === locale.value))
    .filter(r => !needle || [r.name, r.typeLabel, r.path, r.title, r.description].some(t => t.toLocaleLowerCase('fr').includes(needle)))
    .sort((a, b) => {
      const x = value(a), y = value(b)
      const order = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'fr', { numeric: true })
      return dir * order || a.name.localeCompare(b.name, 'fr') || a.locale.localeCompare(b.locale)
    })
})
function sortBy(key: SortKey) {
  // Un second clic inverse l'ordre ; les points se lisent d'abord du plus grand au plus petit.
  sort.value = sort.value.key === key ? { key, dir: sort.value.dir === 1 ? -1 : 1 } : { key, dir: key === 'points' || key === 'clicks' ? -1 : 1 }
}
const columns = computed<{ key: SortKey; label: string; cls?: string; title?: string }[]>(() => [
  { key: 'name', label: 'Page' },
  { key: 'title', label: 'Titre', cls: 'hidden md:table-cell' },
  { key: 'description', label: 'Description', cls: 'hidden lg:table-cell' },
  { key: 'state', label: 'État' },
  { key: 'points', label: 'Points' },
  ...(google.value
    ? [
        { key: 'clicks' as const, label: 'Clics', cls: 'hidden sm:table-cell text-right', title: 'Clics depuis Google sur 28 jours (Search Console)' },
        { key: 'position' as const, label: 'Position', cls: 'hidden sm:table-cell text-right', title: 'Position moyenne dans Google sur 28 jours (Search Console)' },
      ]
    : []),
])
</script>

<template>
  <section class="max-w-7xl mx-auto" data-seo-overview>
    <div class="mb-6">
      <h1 class="text-2xl font-bold">Référencement</h1>
      <p class="text-sm text-base-content/60">
        Les pages du site, telles que Google et les réseaux sociaux les présentent. Cliquez sur une page pour corriger son titre, sa description ou son image de partage.
      </p>
    </div>

    <div v-if="!rows.length" class="card bg-base-100 border border-base-300 p-10 text-center text-base-content/60">
      Aucune page à afficher : aucun des contenus que vous pouvez modifier n'a d'onglet Référencement.
    </div>
    <template v-else>
      <div class="flex flex-wrap items-center gap-2 mb-3" data-seo-filters>
        <div role="tablist" class="tabs tabs-box tabs-sm">
          <a v-for="f in filters" :key="f.id" role="tab" class="tab gap-1.5" :class="{ 'tab-active': state === f.id }" :data-seo-filter="f.id" @click="state = f.id">
            {{ f.label }}<span class="badge badge-xs badge-ghost">{{ f.count }}</span>
          </a>
        </div>
        <select v-if="multi" v-model="locale" class="select select-sm w-auto" aria-label="Langue">
          <option value="all">Toutes les langues</option>
          <option v-for="l in locales" :key="l" :value="l">{{ l.toUpperCase() }}</option>
        </select>
        <label class="input input-sm grow min-w-40 max-w-xs ml-auto"><Search :size="16" class="opacity-50" /><input v-model="search" type="search" class="grow" placeholder="Rechercher une page" aria-label="Rechercher une page"></label>
      </div>

      <div class="card bg-base-100 border border-base-300 overflow-x-auto">
        <table class="table table-sm max-sm:[&_:is(th,td)]:px-2">
          <thead>
            <tr>
              <th v-for="c in columns" :key="c.key" :class="c.cls" :title="c.title" :aria-sort="sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined">
                <button type="button" class="inline-flex items-center gap-1 hover:text-base-content cursor-pointer" :data-seo-sort="c.key" @click="sortBy(c.key)">
                  {{ c.label }}<component :is="sort.dir === 1 ? ArrowUp : ArrowDown" v-if="sort.key === c.key" :size="13" />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in shown" :key="`${r.type}:${r.id}:${r.locale}`" class="hover:bg-base-200/60 cursor-pointer align-top" data-seo-row :data-seo-state="r.state" @click="navigateTo(r.to)">
              <td class="max-w-44 sm:max-w-64">
                <NuxtLink :to="r.to" class="font-medium hover:underline" @click.stop>{{ r.name }}</NuxtLink>
                <span v-if="multi" class="badge badge-xs badge-ghost uppercase ml-1.5">{{ r.locale }}</span>
                <span v-if="r.status === 'draft'" class="badge badge-xs badge-soft badge-neutral ml-1.5">Brouillon</span>
                <div class="text-xs text-base-content/50 truncate">{{ r.path }}</div>
                <!-- Sur un écran étroit, le titre passe sous le nom de la page. -->
                <div class="md:hidden text-xs mt-1" :class="r.title ? 'text-base-content/70' : 'text-base-content/40 italic'">{{ r.title || 'Pas de titre' }}</div>
              </td>
              <td class="hidden md:table-cell max-w-72" data-seo-cell="title">
                <span v-if="r.title">{{ r.title }}</span><span v-else class="text-base-content/40 italic">Pas de titre</span>
              </td>
              <td class="hidden lg:table-cell max-w-96 text-base-content/70" data-seo-cell="description">
                <span v-if="r.description" class="line-clamp-2">{{ r.description }}</span><span v-else class="text-base-content/40 italic">Pas de description</span>
              </td>
              <td><span class="badge badge-sm badge-soft whitespace-nowrap" :class="stateClass[r.state]" data-seo-cell="state">{{ SEO_STATE_LABELS[r.state] }}</span></td>
              <td class="max-w-64" data-seo-cell="points">
                <template v-if="r.points">
                  <span class="font-medium">{{ r.points }}</span>
                  <ul class="hidden sm:block text-xs text-base-content/60 mt-0.5">
                    <li v-for="tip in r.tips.filter(t => t.level !== 'rappel').slice(0, 3)" :key="tip.id" class="truncate" :title="tip.advice">{{ tip.title }}</li>
                    <li v-if="r.points > 3">…</li>
                  </ul>
                </template>
                <span v-else class="text-base-content/40">—</span>
              </td>
              <template v-if="google">
                <td class="hidden sm:table-cell text-right tabular-nums" data-seo-cell="clicks">
                  <span v-if="googleOf(r)" :title="`${googleOf(r)!.impressions.toLocaleString('fr-FR')} affichages dans Google`">{{ googleOf(r)!.clicks.toLocaleString('fr-FR') }}</span><span v-else class="text-base-content/40" title="Google n'a pas montré cette page sur la période">—</span>
                </td>
                <td class="hidden sm:table-cell text-right tabular-nums" data-seo-cell="position">
                  <span v-if="googleOf(r)">{{ formatPosition(googleOf(r)!.position) }}</span><span v-else class="text-base-content/40">—</span>
                </td>
              </template>
            </tr>
          </tbody>
        </table>
        <p v-if="!shown.length" class="p-8 text-center text-sm text-base-content/60">Aucune page ne correspond.</p>
      </div>
      <p class="text-xs text-base-content/50 mt-3">
        La liste examine les brouillons en cours, comme l'onglet Référencement de chaque contenu : une correction apparaît ici dès qu'elle est enregistrée, et sur le site une fois publiée.
        <template v-if="google"> Clics et position : ce que Google a montré de chaque page sur 28 jours (<NuxtLink to="/admin/search-console" class="link">Recherche Google</NuxtLink>).</template>
      </p>
    </template>
  </section>
</template>
