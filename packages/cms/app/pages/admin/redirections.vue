<script setup lang="ts">
import { ArrowRight, CornerDownRight, EyeOff, Pencil, Plus, Search, Trash2, TriangleAlert, Upload } from '@lucide/vue'
import type { LinkValue } from '../../../shared/content'
import type { RedirectTarget } from '../../../shared/redirects'

definePageMeta({ layout: 'admin', middleware: ['cms-auth', 'cms-editor'] })

type Item = {
  id: string; kind: 'manual' | 'auto'; source: string; status: number; target: RedirectTarget
  /** Adresse actuelle de la destination ; null si la page visée n'est pas en ligne. */
  to: string | null; title: string | null; issue: string | null; createdAt: string
  auto?: { type: string; locale: string; slug: string }
}
type List = { items: Item[]; locales: string[]; defaultLocale: string }
type Missing = { path: string; hits: number; firstAt: string; lastAt: string; referrer: string | null }
type NotFound = { items: Missing[]; max: number; days: number }
type Saved = { id: string; source: string; to: string; status: number; notes: string[]; purgeFailed: boolean }
type Line = { line: number; source: string; target: string; result: 'created' | 'updated' | 'unchanged' | 'error'; message: string }
type Report = { dryRun: boolean; lines: Line[]; created: number; updated: number; unchanged: number; errors: number; purgeFailed?: boolean }

const toast = useCmsToast()
const fail = (e: any) => { throw createError({ statusCode: e?.statusCode ?? 500, message: cmsErrorMessage(e), fatal: true }) }
const data = ref(await cmsApi<List>('/api/cms/redirects').catch(fail) as List)
const missing = ref(await cmsApi<NotFound>('/api/cms/redirects/not-found').catch(fail) as NotFound)
async function refresh() {
  const [list, notFound] = await Promise.all([cmsApi<List>('/api/cms/redirects'), cmsApi<NotFound>('/api/cms/redirects/not-found')])
  data.value = list
  missing.value = notFound
}

const tab = ref<'list' | 'missing'>('list')
const search = ref('')
const shown = ref(100)
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return q ? data.value.items.filter(i => [i.source, i.to, i.title].some(v => v?.toLowerCase().includes(q))) : data.value.items
})
watch(search, () => { shown.value = 100 })
const statusLabel = (status: number) => (status === 302 ? 'Provisoire' : 'Définitive')

// ───── Ajout et modification ─────
const blank = () => ({ id: '', source: '', link: null as LinkValue | null, locale: data.value.defaultLocale, status: 301 })
const form = reactive(blank())
const editing = ref(false)
const busy = ref(false)
const formError = ref('')
/** Chaîne signalée par le serveur : la personne choisit d'aplatir ou de corriger. */
const chain = ref<{ final: string } | null>(null)

function open(values: Partial<ReturnType<typeof blank>> = {}) {
  Object.assign(form, blank(), values)
  formError.value = ''
  chain.value = null
  editing.value = true
}
function edit(item: Item) {
  const link: LinkValue = item.target.kind === 'page' ? { kind: 'page', type: item.target.type, id: item.target.id } : { kind: 'url', url: item.target.url }
  open({ id: item.id, source: item.source, link, status: item.status, locale: item.target.kind === 'page' ? item.target.locale : data.value.defaultLocale })
}
async function save(flatten = false) {
  if (!form.link) { formError.value = 'Choisissez la destination : une page du site, ou une adresse.'; return }
  busy.value = true
  formError.value = ''
  const target = form.link.kind === 'page' ? { kind: 'page', type: form.link.type, id: form.link.id, locale: form.locale } : { kind: 'url', url: form.link.url }
  let saved: Saved
  try {
    saved = await cmsApi<Saved>(form.id ? `/api/cms/redirects/${form.id}` : '/api/cms/redirects', { method: form.id ? 'PUT' : 'POST', body: { source: form.source, target, status: form.status, flatten } })
  }
  catch (e: any) {
    formError.value = cmsErrorMessage(e)
    const found = e?.data?.data
    chain.value = found?.code === 'chain' ? { final: found.chain.final } : null
    busy.value = false
    return
  }
  busy.value = false
  const live = cmsSiteUpdated(saved)
  toast.success(`« ${saved.source} » mène maintenant à « ${saved.to} »${live ? '' : ' (d\'ici une heure)'}`)
  editing.value = false
  await refresh().catch(() => {})
}
async function remove(item: Item) {
  const text = item.kind === 'auto'
    ? `Supprimer la redirection automatique de « ${item.source} » ? Cette ancienne adresse affichera « page introuvable ».`
    : `Supprimer la redirection de « ${item.source} » ? Cette adresse affichera de nouveau « page introuvable ».`
  if (!confirm(text)) return
  try {
    const url = item.kind === 'auto' ? `/api/cms/redirects/auto?${new URLSearchParams(item.auto!)}` : `/api/cms/redirects/${item.id}`
    cmsSiteUpdated(await cmsApi(url, { method: 'DELETE' }))
    toast.success('Redirection supprimée')
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
  await refresh().catch(() => {})
}

// ───── Pages introuvables ─────
async function ignore(item: Missing) {
  await cmsApi(`/api/cms/redirects/not-found?path=${encodeURIComponent(item.path)}`, { method: 'DELETE' }).catch(e => toast.error(cmsErrorMessage(e)))
  await refresh().catch(() => {})
}

// ───── Import en lot ─────
const importing = ref(false)
const batch = reactive({ text: '', status: 301, replace: false })
const report = ref<Report | null>(null)
function openImport() {
  Object.assign(batch, { text: '', status: 301, replace: false })
  report.value = null
  importing.value = true
}
async function readFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (file.size > 500_000) { toast.error('Fichier trop volumineux : 500 Ko au maximum.'); return }
  batch.text = await file.text()
  report.value = null
}
async function runImport(dryRun: boolean) {
  busy.value = true
  try {
    report.value = await cmsApi<Report>('/api/cms/redirects/import', { method: 'POST', body: { ...batch, dryRun } })
    if (!dryRun) {
      cmsSiteUpdated(report.value)
      const n = report.value.created + report.value.updated
      toast.success(n ? `${n} redirection${n > 1 ? 's enregistrées' : ' enregistrée'}` : 'Aucune redirection enregistrée')
      busy.value = false
      await refresh().catch(() => {})
    }
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
  busy.value = false
}
const resultMeta = {
  created: { label: 'Ajoutée', cls: 'badge-success' },
  updated: { label: 'Modifiée', cls: 'badge-info' },
  unchanged: { label: 'Inchangée', cls: 'badge-ghost' },
  error: { label: 'Refusée', cls: 'badge-error' },
}
const dryLabel = { created: 'À ajouter', updated: 'À modifier', unchanged: 'Inchangée', error: 'Refusée' }
</script>

<template>
  <section class="max-w-5xl mx-auto">
    <CmsSiteDelayNotice />
    <div class="flex flex-wrap items-end gap-3 mb-6">
      <div class="min-w-0 grow basis-72">
        <h1 class="text-2xl font-bold">Redirections</h1>
        <p class="text-sm text-base-content/60">
          Une ancienne adresse du site conduit le visiteur vers la bonne page, au lieu d'afficher « page introuvable ».
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button class="btn btn-sm" @click="openImport"><Upload :size="16" />Importer une liste</button>
        <button class="btn btn-sm btn-primary" @click="open()"><Plus :size="16" />Ajouter</button>
      </div>
    </div>

    <div role="tablist" class="tabs tabs-border tabs-sm mb-3">
      <a role="tab" class="tab" :class="{ 'tab-active': tab === 'list' }" @click="tab = 'list'">Redirections <span class="ml-1.5 opacity-60">{{ data.items.length }}</span></a>
      <a role="tab" class="tab" :class="{ 'tab-active': tab === 'missing' }" @click="tab = 'missing'">Pages introuvables <span class="ml-1.5 opacity-60">{{ missing.items.length }}</span></a>
    </div>

    <!-- Liste des redirections -->
    <template v-if="tab === 'list'">
      <label v-if="data.items.length" class="input input-sm w-full sm:w-80 mb-3">
        <Search :size="14" class="opacity-50" />
        <input v-model="search" type="search" placeholder="Rechercher une adresse ou une page" aria-label="Rechercher">
      </label>
      <div class="card bg-base-100 border border-base-300 overflow-hidden">
        <div v-if="!filtered.length" class="p-12 text-center text-sm text-base-content/50">
          <template v-if="data.items.length">Aucune redirection ne correspond à « {{ search }} ».</template>
          <template v-else>
            Aucune redirection pour l'instant. Quand l'adresse d'une page publiée change, sa redirection se crée toute seule.<br>
            Pour une ancienne adresse d'un précédent site, utilisez « Ajouter » ou « Importer une liste ».
          </template>
        </div>
        <ul v-else class="divide-y divide-base-300">
          <li v-for="item in filtered.slice(0, shown)" :key="item.id" class="px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2" data-redirect>
            <div class="min-w-0 grow basis-64">
              <div class="font-mono text-sm break-all">{{ item.source }}</div>
              <div class="text-sm text-base-content/70 flex items-start gap-1.5 mt-0.5">
                <CornerDownRight :size="14" class="shrink-0 mt-1 opacity-60" />
                <span class="min-w-0 break-all">
                  <template v-if="item.target.kind === 'page'"><span class="font-medium text-base-content">{{ item.title ?? 'Page supprimée' }}</span><span v-if="item.to" class="font-mono text-xs ml-1.5">{{ item.to }}</span></template>
                  <span v-else class="font-mono text-xs">{{ item.to }}</span>
                </span>
              </div>
              <div v-if="item.issue" class="text-xs text-warning-content bg-warning/20 rounded-field px-2 py-1 mt-1.5 flex items-start gap-1.5" data-redirect-issue>
                <TriangleAlert :size="14" class="shrink-0 mt-0.5" /><span>{{ item.issue }}</span>
              </div>
            </div>
            <span v-if="item.kind === 'auto'" class="badge badge-sm badge-soft badge-ghost shrink-0" title="Créée toute seule quand l'adresse de ce contenu a changé">Automatique</span>
            <span v-else class="badge badge-sm badge-soft shrink-0" :class="item.status === 302 ? 'badge-warning' : 'badge-ghost'" :title="item.status === 302 ? 'Redirection provisoire (302)' : 'Redirection définitive (301)'">{{ statusLabel(item.status) }}</span>
            <div class="flex gap-1 shrink-0 ml-auto">
              <button v-if="item.kind === 'manual'" class="btn btn-sm btn-ghost btn-square" title="Modifier" aria-label="Modifier" @click="edit(item)"><Pencil :size="16" /></button>
              <button class="btn btn-sm btn-ghost btn-square text-error" title="Supprimer" aria-label="Supprimer" @click="remove(item)"><Trash2 :size="16" /></button>
            </div>
          </li>
        </ul>
        <div v-if="filtered.length > shown" class="p-3 text-center border-t border-base-300">
          <button class="btn btn-sm" @click="shown += 200">Afficher la suite ({{ filtered.length - shown }})</button>
        </div>
      </div>
      <p class="text-xs text-base-content/50 mt-3">
        Une redirection ne s'applique que si aucune page ne répond à l'ancienne adresse. Les majuscules, la barre finale et les paramètres (« ?… ») ne comptent pas.
      </p>
    </template>

    <!-- Pages introuvables -->
    <template v-else>
      <p class="text-sm text-base-content/60 mb-3">
        Les adresses que des visiteurs ont demandées sans rien trouver, des plus demandées aux moins demandées.
        Aucune information sur les visiteurs n'est gardée. Une adresse qui n'est plus demandée disparaît après {{ missing.days }} jours.
      </p>
      <div class="card bg-base-100 border border-base-300 overflow-hidden">
        <div v-if="!missing.items.length" class="p-12 text-center text-sm text-base-content/50">Aucune page introuvable n'a été demandée.</div>
        <ul v-else class="divide-y divide-base-300">
          <li v-for="item in missing.items" :key="item.path" class="px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2" data-not-found>
            <div class="min-w-0 grow basis-64">
              <div class="font-mono text-sm break-all">{{ item.path }}</div>
              <div class="text-xs text-base-content/60">
                {{ item.hits }} demande{{ item.hits > 1 ? 's' : '' }} · dernière {{ cmsFormatWhen(item.lastAt) }}<template v-if="item.referrer"> · depuis <span class="break-all">{{ item.referrer }}</span></template>
              </div>
            </div>
            <div class="flex gap-1 shrink-0 ml-auto">
              <button class="btn btn-sm" @click="open({ source: item.path })"><ArrowRight :size="16" />Créer une redirection</button>
              <button class="btn btn-sm btn-ghost btn-square" title="Ignorer cette adresse" aria-label="Ignorer cette adresse" @click="ignore(item)"><EyeOff :size="16" /></button>
            </div>
          </li>
        </ul>
      </div>
      <p class="text-xs text-base-content/50 mt-3">Les demandes des robots à la recherche de failles ne sont pas comptées. {{ missing.max }} adresses au plus sont conservées.</p>
    </template>

    <!-- Ajout / modification -->
    <div v-if="editing" class="modal modal-open">
      <form class="modal-box space-y-3" data-redirect-form @submit.prevent="save()">
        <h3 class="font-bold text-lg">{{ form.id ? 'Modifier la redirection' : 'Ajouter une redirection' }}</h3>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Ancienne adresse</legend>
          <input v-model="form.source" class="input w-full font-mono" placeholder="/ancienne-page" required autofocus name="source">
          <p class="label whitespace-normal">La partie de l'adresse qui suit le nom du site. Une adresse exacte : pas de motif avec « * ».</p>
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Destination</legend>
          <CmsLinkField v-model="form.link" target-only />
          <p class="label whitespace-normal">Avec « Page du site », la redirection suit la page si son adresse change un jour.</p>
        </fieldset>
        <fieldset v-if="data.locales.length > 1 && form.link?.kind === 'page'" class="fieldset">
          <legend class="fieldset-legend">Langue de la page</legend>
          <select v-model="form.locale" class="select w-full" name="locale">
            <option v-for="l in data.locales" :key="l" :value="l">{{ l.toUpperCase() }}</option>
          </select>
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Durée</legend>
          <label class="flex items-start gap-2 cursor-pointer text-sm"><input v-model="form.status" type="radio" class="radio radio-sm mt-0.5" :value="301"><span><span class="font-medium">Définitive</span> — le cas habituel : Google remplace l'ancienne adresse par la nouvelle.</span></label>
          <label class="flex items-start gap-2 cursor-pointer text-sm mt-1"><input v-model="form.status" type="radio" class="radio radio-sm mt-0.5" :value="302"><span><span class="font-medium">Provisoire</span> — l'ancienne adresse reviendra (travaux, opération temporaire).</span></label>
        </fieldset>
        <div v-if="formError" role="alert" class="alert alert-soft text-sm items-start" :class="chain ? 'alert-warning' : 'alert-error'" data-redirect-error>
          <TriangleAlert :size="18" class="shrink-0 mt-0.5" />
          <div>
            {{ formError }}
            <div v-if="chain" class="mt-2"><button type="button" class="btn btn-sm" :disabled="busy" @click="save(true)">Rediriger directement vers « {{ chain.final }} »</button></div>
          </div>
        </div>
        <div class="modal-action">
          <button type="button" class="btn" @click="editing = false">Annuler</button>
          <button class="btn btn-primary" :disabled="busy">Enregistrer</button>
        </div>
      </form>
      <div class="modal-backdrop" @click="editing = false" />
    </div>

    <!-- Import en lot -->
    <div v-if="importing" class="modal modal-open">
      <div class="modal-box max-w-3xl space-y-3" data-redirect-import>
        <h3 class="font-bold text-lg">Importer une liste de redirections</h3>
        <p class="text-sm text-base-content/60">
          Une redirection par ligne : <span class="font-mono text-xs">ancienne adresse ; nouvelle adresse</span>. Collez la liste, ou choisissez un fichier CSV (deux colonnes).
        </p>
        <textarea v-model="batch.text" class="textarea w-full font-mono text-xs h-40" placeholder="/ancienne-page ; /nouvelle-page&#10;/blog/mon-article ; /actualites/mon-article&#10;/partenaire ; https://www.exemple.fr" @input="report = null" />
        <div class="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <input type="file" accept=".csv,.txt,text/csv,text/plain" class="file-input file-input-sm w-full sm:w-auto" aria-label="Fichier CSV" @change="readFile">
          <label class="flex items-center gap-2">Durée
            <select v-model="batch.status" class="select select-sm" @change="report = null">
              <option :value="301">Définitive</option>
              <option :value="302">Provisoire</option>
            </select>
          </label>
          <label class="flex items-center gap-2 cursor-pointer"><input v-model="batch.replace" type="checkbox" class="checkbox checkbox-sm" @change="report = null">Remplacer les redirections existantes</label>
        </div>

        <div v-if="report" class="space-y-2" data-import-report>
          <div class="text-sm font-medium">
            <template v-if="report.dryRun">Vérification : </template><template v-else>Import terminé : </template>
            {{ report.created }} {{ report.dryRun ? 'à ajouter' : `ajoutée${report.created > 1 ? 's' : ''}` }}<template v-if="report.updated">, {{ report.updated }} {{ report.dryRun ? 'à modifier' : `modifiée${report.updated > 1 ? 's' : ''}` }}</template><template v-if="report.unchanged">, {{ report.unchanged }} inchangée{{ report.unchanged > 1 ? 's' : '' }}</template>, {{ report.errors }} refusée{{ report.errors > 1 ? 's' : '' }}.
            <span v-if="report.dryRun && report.errors" class="font-normal text-base-content/60">Les lignes refusées ne seront pas importées ; les autres le seront.</span>
          </div>
          <ul class="border border-base-300 rounded-field divide-y divide-base-300 max-h-64 overflow-y-auto text-sm">
            <li v-for="line in report.lines" :key="line.line" class="px-3 py-2 flex flex-wrap items-start gap-x-2 gap-y-1" data-import-line>
              <span class="text-xs text-base-content/50 w-14 shrink-0 pt-0.5">Ligne {{ line.line }}</span>
              <span class="badge badge-sm badge-soft shrink-0" :class="resultMeta[line.result].cls">{{ report.dryRun ? dryLabel[line.result] : resultMeta[line.result].label }}</span>
              <span class="min-w-0 grow basis-60"><span class="font-mono text-xs break-all">{{ line.source }}</span> <span class="text-base-content/70">{{ line.message }}</span></span>
            </li>
          </ul>
        </div>

        <div class="modal-action">
          <button type="button" class="btn" @click="importing = false">{{ report && !report.dryRun ? 'Fermer' : 'Annuler' }}</button>
          <button v-if="!report || !report.dryRun" type="button" class="btn" :class="{ 'btn-primary': !report }" :disabled="busy || !batch.text.trim()" @click="runImport(true)">Vérifier</button>
          <button v-else type="button" class="btn btn-primary" :disabled="busy || !(report.created + report.updated)" @click="runImport(false)">Importer {{ report.created + report.updated }} redirection{{ report.created + report.updated > 1 ? 's' : '' }}</button>
        </div>
      </div>
      <div class="modal-backdrop" @click="importing = false" />
    </div>
  </section>
</template>
