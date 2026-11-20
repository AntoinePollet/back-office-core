<script setup lang="ts">
import { ArrowLeft, Copy, Eye, EyeOff, History, Trash2, Send } from '@lucide/vue'
import { applyDefaults, copyValues, isEmpty, partition, pick } from '../../../shared/content'
import { TRASH_DAYS } from '../../../shared/trash'

/**
 * Formulaire d'un contenu : élément de collection (/admin/<type>/<id> ou /new) ou page unique (/admin/<type>).
 * Composant partagé par les deux pages, qui seules déclarent leur mise en page (definePageMeta).
 */

type LocaleState = { slug: string; status: string | null; values: Record<string, any> }
type Doc = { id: string | null; version: number; shared: Record<string, any>; locales: Record<string, LocaleState> }
/** Refus d'enregistrer renvoyé par le serveur : quelqu'un d'autre a modifié le contenu entre-temps. */
type Conflict = { by: string | null; self: boolean; at: string; parts: string[]; retry: () => Promise<void> }

const route = useRoute()
const toast = useCmsToast()
const type = route.params.type as string
const schema = await useCmsSchema()
const def = (schema.value.collections?.[type] ?? schema.value.singletons?.[type]) as Record<string, any> | undefined
if (!def) throw createError({ statusCode: 404, message: 'Type de contenu inconnu.', fatal: true })
// Une page unique s'ouvre à /admin/<type> (cette page y est affichée par [type]/index.vue) : l'ancienne adresse y renvoie.
if (def.kind === 'singleton' && route.params.id) await navigateTo(`/admin/${type}`, { replace: true })
/** Identifiant du contenu : celui de l'adresse, ou celui du type pour une page unique. */
const entryId = (route.params.id as string | undefined) ?? type

const locales = schema.value.site.locales as readonly string[]
const defaultLocale = schema.value.site.defaultLocale
const multi = locales.length > 1
const isCollection = def.kind === 'collection'
const access = useCmsAccess(type)
const hasSlug = isCollection && !!def.path?.includes('[slug]')
const hasShared = multi && Object.keys(partition(def.fields).shared).length > 0

const doc = ref<Doc>({ id: null, version: 0, shared: {}, locales: {} })
const dirty = ref(false)
const saving = ref(false)
const errors = ref<Record<string, Record<string, string>>>({})
const tab = ref<'content' | 'seo'>('content')
const locale = ref(defaultLocale)
const split = ref(false)
const localeB = ref(locales.find(l => l !== defaultLocale) ?? defaultLocale)
const conflict = ref<Conflict | null>(null)
const showHistory = ref(false)
// Sections du formulaire ouvertes ou fermées, partagées par les volets de langue (voir `Fields.vue`).
provide('cms-sections', reactive<Record<string, boolean>>({}))
const duplicating = ref(false)

/**
 * État de chaque partie (champs communs, chaque langue) au dernier chargement. Seules les parties modifiées depuis
 * sont envoyées à l'enregistrement : deux personnes peuvent ainsi travailler sur deux langues sans se gêner.
 */
let baseline: { shared: string; locales: Record<string, string> } = { shared: '', locales: {} }
const localeState = (l: string) => JSON.stringify({ slug: doc.value.locales[l]!.slug, values: doc.value.locales[l]!.values })
const sharedChanged = () => JSON.stringify(doc.value.shared) !== baseline.shared
const localeChanged = (l: string) => localeState(l) !== baseline.locales[l]

/**
 * Met le contenu reçu de l'API dans la forme attendue par le formulaire : toutes les langues présentes.
 * `unsaved` : le contenu affiché n'est pas encore enregistré (copie préparée dans le formulaire).
 */
/** Demande de publication en attente sur ce contenu. Hors de `doc` : ce n'est pas une modification du formulaire. */
const review = ref<{ by: string; byId: string; note: string | null; at: string } | null>(null)

/** Mises en ligne et retraits programmés (composant `CmsSchedule`). */
const schedules = ref<any[]>([])

function hydrate(data?: any, unsaved = false) {
  review.value = data?.review ?? null
  schedules.value = data?.schedules ?? []
  const next: Doc = {
    id: data?.id ?? null,
    version: data?.version ?? 0,
    shared: { ...data?.shared },
    locales: Object.fromEntries(locales.map(l => [l, {
      slug: data?.locales?.[l]?.slug ?? '',
      status: data?.locales?.[l]?.status ?? null,
      values: { ...data?.locales?.[l]?.values },
    }])),
  }
  if (def!.seo) {
    next.shared.seo ??= {}
    for (const l of locales) next.locales[l]!.values.seo ??= {}
  }
  // Interrupteurs jamais touchés : valeur par défaut, pour que les conditions d'affichage se comportent comme sur le serveur.
  applyDefaults(partition(def!.fields).shared, next.shared)
  doc.value = next
  // Après l'affichage : les champs ont alors fini de mettre leurs valeurs en forme.
  nextTick(() => {
    dirty.value = unsaved
    baseline = { shared: JSON.stringify(doc.value.shared), locales: Object.fromEntries(locales.map(l => [l, localeState(l)])) }
  })
}

/** Contenu à copier (collections sans brouillons) : le formulaire s'ouvre prérempli, rien n'est créé avant l'enregistrement. */
const copyOf = entryId === 'new' && isCollection && typeof route.query.copy === 'string' ? route.query.copy : null

if (entryId === 'new') {
  const source = copyOf ? await cmsApi<any>(`/api/cms/entries/${type}/${copyOf}`).catch(() => null) : null
  if (source) {
    const copy = copyValues(def as any, source.shared, Object.fromEntries(Object.entries<any>(source.locales).map(([l, state]) => [l, state.values])))
    hydrate({ shared: copy.shared, locales: Object.fromEntries(Object.entries(copy.locales).map(([l, values]) => [l, { values }])) }, true)
  }
  else hydrate()
}
else {
  try {
    hydrate(await cmsApi(`/api/cms/entries/${type}/${entryId}`))
  }
  catch (e) {
    throw createError({ statusCode: 404, message: cmsErrorMessage(e, 'Contenu introuvable.'), fatal: true })
  }
}

watch(doc, () => { dirty.value = true }, { deep: true })

const title = computed(() => (isCollection
  ? doc.value.locales[defaultLocale]?.values[def.titleField] || (doc.value.id ? 'Sans titre' : 'Nouveau contenu')
  : def.label))
const status = computed(() => doc.value.locales[locale.value]?.status ?? 'draft')
const isOnline = computed(() => Object.values(doc.value.locales).some(l => l.status && l.status !== 'draft'))
const statusMeta: Record<string, { label: string; cls: string }> = {
  published: { label: 'Publié', cls: 'badge-success' },
  changed: { label: 'Modifications en attente', cls: 'badge-warning' },
  draft: { label: 'Brouillon', cls: 'badge-neutral' },
}
const localeName = (l: string) => new Intl.DisplayNames(['fr'], { type: 'language' }).of(l) ?? l
const errorCount = computed(() => Object.values(errors.value).reduce((n, e) => n + Object.keys(e).length, 0))

function pickLocale(l: string) {
  locale.value = l
  if (localeB.value === l) localeB.value = locales.find(x => x !== l) ?? l
}
function toggleSplit() {
  split.value = !split.value
  if (localeB.value === locale.value) localeB.value = locales.find(l => l !== locale.value) ?? locale.value
}

async function send(extra: { publish?: string[]; unpublish?: string[] }, done: string, force = false) {
  saving.value = true
  errors.value = {}
  conflict.value = null
  const wasNew = !doc.value.id
  // Sans brouillons, enregistrer publie le contenu entier : tout est envoyé. Sinon, seulement ce qui a été modifié
  // (et ce qui est publié : une publication met aussi en ligne les champs communs).
  const whole = wasNew || !def!.drafts
  const sent = locales.filter(l => whole || localeChanged(l) || extra.publish?.includes(l))
  // Seuls les champs de la configuration sont envoyés, chacun dans sa partie : le serveur refuse tout le reste.
  // Ce que le contenu porte d'autre (valeurs d'un champ retiré, mises de côté par une migration) reste en base tel quel.
  const parts = partition(def!.fields)
  const system = def!.seo ? ['seo'] : []
  const body = {
    ...(whole || sharedChanged() || extra.publish?.length ? { shared: pick(parts.shared, doc.value.shared, system) } : {}),
    locales: Object.fromEntries(sent.map(l => [l, { slug: doc.value.locales[l]!.slug, values: pick(parts.localized, doc.value.locales[l]!.values, system) }])),
    ...extra,
    ...(wasNew ? (copyOf ? { after: copyOf } : {}) : { baseVersion: doc.value.version, ...(force ? { force: true } : {}) }),
  }
  try {
    const saved = await cmsApi<any>(wasNew ? `/api/cms/entries/${type}` : `/api/cms/entries/${type}/${doc.value.id}`, { method: wasNew ? 'POST' : 'PUT', body })
    hydrate(saved)
    // Si le site n'a pas pu être actualisé, un avertissement s'affiche et le message ne prétend pas le contraire.
    toast.success(cmsSiteUpdated(saved) ? done : done.replace(/\.? Le site est à jour\.$/, ''))
    if (wasNew) await navigateTo(`/admin/${type}/${saved.id}`, { replace: true })
  }
  catch (e: any) {
    const found = e?.data?.data?.conflict
    if (e?.statusCode === 409 && found) {
      conflict.value = { ...found, retry: () => send(extra, done, true) }
      saving.value = false
      return
    }
    errors.value = e?.data?.data?.errors ?? {}
    const first = Object.keys(errors.value)[0]
    if (first && multi && !split.value) pickLocale(first)
    toast.error(cmsErrorMessage(e))
  }
  saving.value = false
}

const filledLocales = () => locales.filter(l => !Object.values(doc.value.locales[l]!.values).every(isEmpty))

function save() {
  return send({}, def!.drafts ? 'Brouillon enregistré' : 'Enregistré. Le site est à jour.')
}
function publish() {
  const filled = filledLocales()
  if (!filled.length) return toast.error('Rien à publier : le formulaire est vide.')
  return send({ publish: filled }, 'Publié. Le site est à jour.')
}
/** Publie une seule langue ; les autres restent dans leur état. */
function publishLocale(l: string) {
  return send({ publish: [l] }, `Version ${localeName(l)} publiée. Le site est à jour.`)
}

/** Ouvre la page du site avec le brouillon en cours, après l'avoir enregistré. */
async function preview() {
  // L'onglet est ouvert tout de suite : après une attente, le navigateur le bloquerait comme une fenêtre intempestive.
  const tab = window.open('', '_blank')
  if (dirty.value || !doc.value.id) await save()
  const state = doc.value.locales[locale.value]
  const ready = doc.value.id && !errorCount.value && !conflict.value && (!hasSlug || state?.slug)
  if (!ready) { tab?.close(); if (!errorCount.value && !conflict.value) toast.error('Rien à prévisualiser dans cette langue : remplissez d\'abord le contenu.'); return }
  const path = (locale.value === defaultLocale ? '' : `/${locale.value}`) + def!.path.replace('[slug]', state!.slug)
  if (tab) tab.location.href = `${path}?preview=1`
}

function unpublish() {
  return send({ unpublish: [...locales] }, 'Contenu retiré du site')
}
async function remove() {
  if (!confirm(`Supprimer ce contenu, dans toutes les langues ? Il ira dans la corbeille, où il reste récupérable ${TRASH_DAYS} jours.`)) return
  try {
    cmsSiteUpdated(await cmsApi(`/api/cms/entries/${type}/${doc.value.id}`, { method: 'DELETE' }))
    dirty.value = false
    toast.success('Contenu mis à la corbeille')
    await navigateTo(`/admin/${type}`)
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
}

// ───── Modification simultanée ─────

const partName = (p: string) => (p === 'shared' ? 'les champs communs à toutes les langues' : `le texte en ${localeName(p)}`)
const conflictWho = computed(() => (conflict.value?.self ? 'Vous avez' : `${conflict.value?.by ?? 'Une autre personne'} a`))

/** Abandonne ses modifications et affiche la version enregistrée par l'autre personne. */
async function reloadLatest() {
  if (!confirm('Recharger la version à jour ? Vos modifications non enregistrées seront perdues.')) return
  try {
    hydrate(await cmsApi(`/api/cms/entries/${type}/${doc.value.id}`))
    conflict.value = null
    errors.value = {}
    toast.success('Version à jour chargée')
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
}

// ───── Demande de publication ─────
const me = useCmsUser()
const asking = ref(false)
const reviewNote = ref('')
async function requestReview() {
  try {
    const res = await cmsApi<{ review: NonNullable<typeof review.value> }>(`/api/cms/entries/${type}/${doc.value.id}/review`, { method: 'POST', body: { note: reviewNote.value } })
    review.value = res.review
    asking.value = false
    reviewNote.value = ''
    toast.success('Demande envoyée. Un éditeur relira et publiera.')
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
}
async function dropReview() {
  try {
    await cmsApi(`/api/cms/entries/${type}/${doc.value.id}/review`, { method: 'DELETE' })
    review.value = null
    toast.success('Demande retirée')
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
}

// ───── Historique et duplication ─────

function onRestored(saved: any) {
  showHistory.value = false
  errors.value = {}
  hydrate(saved)
  toast.success('Version restaurée comme brouillon. Relisez-la, puis publiez.')
}
/** Sans brouillons : la version est reprise dans le formulaire, à enregistrer pour la mettre en ligne. */
function onLoadVersion(snapshot: { shared: Record<string, any>; locales: Record<string, { values: Record<string, any> }> }) {
  showHistory.value = false
  doc.value.shared = { ...snapshot.shared }
  if (def!.seo) doc.value.shared.seo ??= {}
  for (const l of locales) if (snapshot.locales[l]) doc.value.locales[l]!.values = { ...snapshot.locales[l]!.values }
  toast.success('Version reprise dans le formulaire. Vérifiez-la, puis enregistrez.')
}

async function duplicate() {
  duplicating.value = true
  try {
    const to = await cmsDuplicate(type, doc.value.id!, !!def!.drafts)
    if (def!.drafts) toast.success('Copie créée en brouillon')
    await navigateTo(to)
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
  duplicating.value = false
}

const confirmLeave = () => !dirty.value || confirm('Des modifications ne sont pas enregistrées. Quitter quand même ?')
onBeforeRouteLeave(confirmLeave)
// Passer d'un formulaire à un autre (autre contenu, page unique, « Ajouter ») garde le même écran pour le routeur :
// sans ce second garde-fou, les modifications seraient perdues sans question.
onBeforeRouteUpdate(confirmLeave)
function onKey(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (!saving.value) save() }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <section class="mx-auto" :class="split ? '' : 'max-w-6xl'">
    <div class="sticky top-14 z-10 -mx-4 lg:-mx-8 px-4 lg:px-8 py-3 bg-base-200/90 backdrop-blur flex flex-wrap items-center gap-3 mb-4">
      <NuxtLink v-if="isCollection" :to="`/admin/${type}`" class="btn btn-ghost btn-sm btn-square" title="Retour à la liste" aria-label="Retour à la liste"><ArrowLeft :size="18" /></NuxtLink>
      <div class="min-w-0">
        <div v-if="isCollection" class="text-xs text-base-content/50">{{ def.label }}</div>
        <h1 class="text-lg font-bold truncate">{{ title }}</h1>
      </div>
      <span v-if="def.drafts" class="badge badge-sm badge-soft" :class="statusMeta[status]?.cls">{{ statusMeta[status]?.label }}</span>
      <div class="ml-auto flex items-center gap-2">
        <span class="text-xs text-base-content/60 flex items-center gap-1.5">
          <span class="status" :class="dirty ? 'status-warning' : 'status-success'" />
          {{ dirty ? 'Modifications non enregistrées' : 'Enregistré' }}
        </span>
        <template v-if="def.drafts">
          <button class="btn btn-sm" :disabled="!dirty || saving" @click="save">Enregistrer le brouillon</button>
          <CmsSchedule v-model:schedules="schedules" part="button" :type="type" :id="doc.id" :def="def" :locales="locales" :states="doc.locales" :dirty="dirty" @errors="errors = $event" />
          <button v-if="access.publish" class="btn btn-sm btn-primary" :disabled="saving" @click="publish">Publier</button>
        </template>
        <button v-else class="btn btn-sm btn-primary" :disabled="!dirty || saving" @click="save">Enregistrer</button>
      </div>
    </div>

    <CmsSiteDelayNotice />
    <CmsSchedule v-model:schedules="schedules" part="notice" :type="type" :id="doc.id" :def="def" :locales="locales" :states="doc.locales" :dirty="dirty" />
    <div v-if="errorCount" class="alert alert-error alert-soft text-sm mb-4">
      {{ errorCount }} champ{{ errorCount > 1 ? 's' : '' }} à corriger avant de publier
      <template v-if="multi">({{ Object.keys(errors).map(localeName).join(', ') }})</template>.
    </div>

    <div class="grid gap-6 items-start" :class="split ? '' : 'lg:grid-cols-[1fr_18rem]'">
      <div class="card bg-base-100 border border-base-300 min-w-0">
        <div v-if="def.seo || multi" class="flex flex-wrap items-center gap-3 px-5 pt-4">
          <div v-if="def.seo" role="tablist" class="tabs tabs-border">
            <a role="tab" class="tab" :class="{ 'tab-active': tab === 'content' }" @click="tab = 'content'">Contenu</a>
            <a role="tab" class="tab" :class="{ 'tab-active': tab === 'seo' }" @click="tab = 'seo'">Référencement</a>
          </div>
          <div v-if="multi" class="ml-auto flex items-center gap-4">
            <div v-if="!split" role="tablist" class="tabs tabs-box tabs-xs">
              <a v-for="l in locales" :key="l" role="tab" class="tab uppercase" :class="{ 'tab-active': locale === l }" @click="pickLocale(l)">
                {{ l }}<span v-if="errors[l]" class="status status-error ml-1.5" /><span v-else-if="!doc.locales[l]?.status" class="status status-warning ml-1.5" />
              </a>
            </div>
            <label class="flex items-center gap-2 text-xs cursor-pointer" title="Afficher deux langues en même temps">
              <input type="checkbox" class="toggle toggle-xs" :checked="split" @change="toggleSplit">Côte à côte
            </label>
          </div>
        </div>

        <div class="grid" :class="split ? 'lg:grid-cols-2' : ''">
          <CmsLocalePane
            :def="def" :doc="doc" :loc="locale" :other="localeB" :tab="tab" :split="split"
            :locales="locales" :default-locale="defaultLocale" :errors="errors[locale]"
            @loc="locale = $event"
          />
          <CmsLocalePane
            v-if="split" class="border-t lg:border-t-0 lg:border-l border-base-300"
            :def="def" :doc="doc" :loc="localeB" :other="locale" :tab="tab" :split="split"
            :locales="locales" :default-locale="defaultLocale" :errors="errors[localeB]"
            @loc="localeB = $event"
          />
        </div>

        <div v-if="hasShared || (def.seo && multi)" v-show="tab === 'content' ? hasShared : def.seo" class="border-t border-base-300 p-5 space-y-4">
          <div v-if="multi">
            <div class="text-sm font-semibold">Commun à toutes les langues</div>
            <div class="text-xs text-base-content/60">Ces réglages s'appliquent au contenu dans chaque langue.</div>
          </div>
          <CmsFields
            v-show="tab === 'content'" :fields="def.fields" :shared="doc.shared" :values="doc.locales[locale]!.values"
            scope="shared" :errors="errors[locale]" class="max-w-3xl"
          />
          <fieldset v-if="def.seo" v-show="tab === 'seo'" class="fieldset max-w-3xl">
            <legend class="fieldset-legend">Image de partage</legend>
            <CmsMediaField v-model="doc.shared.seo.image" :field="{ type: 'image' }" />
            <p class="label">Affichée quand la page est partagée sur les réseaux sociaux ou par message.</p>
          </fieldset>
          <label v-if="def.seo" v-show="tab === 'seo'" class="flex items-center gap-3 cursor-pointer">
            <input v-model="doc.shared.seo.noindex" type="checkbox" class="toggle toggle-sm">
            <span class="text-sm">Masquer cette page des moteurs de recherche</span>
          </label>
        </div>
        <div v-else-if="def.seo" v-show="tab === 'seo'" class="px-5 pb-5 space-y-4">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Image de partage</legend>
            <CmsMediaField v-model="doc.shared.seo.image" :field="{ type: 'image' }" />
            <p class="label">Affichée quand la page est partagée sur les réseaux sociaux ou par message.</p>
          </fieldset>
          <label class="flex items-center gap-3 cursor-pointer">
            <input v-model="doc.shared.seo.noindex" type="checkbox" class="toggle toggle-sm">
            <span class="text-sm">Masquer cette page des moteurs de recherche</span>
          </label>
        </div>
      </div>

      <aside :class="split ? 'grid sm:grid-cols-2 gap-4' : 'space-y-4 lg:sticky lg:top-32'">
        <div v-if="def.drafts || def.path || doc.id" class="card bg-base-100 border border-base-300 p-4 text-sm space-y-3">
          <div class="font-semibold">Publication</div>
          <div v-if="def.drafts" class="flex justify-between"><span class="text-base-content/60">Statut</span><span>{{ statusMeta[status]?.label }}</span></div>
          <button v-if="def.path" class="btn btn-sm btn-block" :disabled="saving" @click="preview"><Eye :size="16" />Aperçu du brouillon</button>
          <p v-if="def.drafts && !access.publish" class="text-xs text-base-content/60">Vous préparez le brouillon. La mise en ligne est faite par un éditeur.</p>
          <div v-if="review" class="rounded-field bg-info/10 p-3 space-y-2">
            <div class="font-medium">Publication demandée</div>
            <div class="text-xs text-base-content/70">par {{ review.byId === me?.id ? 'vous' : review.by }}, {{ cmsFormatWhen(review.at) }}</div>
            <p v-if="review.note" class="text-sm whitespace-pre-line">« {{ review.note }} »</p>
            <p v-if="access.publish" class="text-xs text-base-content/60">Relisez puis publiez : la demande sera close.</p>
            <button v-if="access.publish || review.byId === me?.id" class="btn btn-xs" @click="dropReview">{{ review.byId === me?.id ? 'Retirer ma demande' : 'Écarter la demande' }}</button>
          </div>
          <button
            v-else-if="def.drafts && doc.id && !access.publish" class="btn btn-sm btn-primary btn-block" :disabled="dirty"
            :title="dirty ? 'Enregistrez d\'abord votre brouillon' : 'Prévenir un éditeur que ce brouillon est prêt'" @click="asking = true"
          >
            <Send :size="16" />Demander la publication
          </button>
          <button v-if="def.drafts && isOnline && access.publish" class="btn btn-sm btn-block" :disabled="saving" @click="unpublish"><EyeOff :size="16" />Retirer du site</button>
          <button v-if="doc.id" class="btn btn-sm btn-ghost btn-block" @click="showHistory = true"><History :size="16" />Historique</button>
          <button
            v-if="isCollection && doc.id" class="btn btn-sm btn-ghost btn-block" :disabled="dirty || duplicating"
            :title="dirty ? 'Enregistrez d\'abord vos modifications' : 'Créer une copie de ce contenu'" @click="duplicate"
          >
            <Copy :size="16" />Dupliquer
          </button>
          <button v-if="isCollection && doc.id && access.delete" class="btn btn-sm btn-ghost btn-block text-error" @click="remove"><Trash2 :size="16" />Supprimer</button>
        </div>
        <div v-if="multi" class="card bg-base-100 border border-base-300 p-4 text-sm space-y-2">
          <div class="font-semibold">Traductions</div>
          <div v-for="l in locales" :key="l" class="flex items-center gap-2">
            <span class="capitalize grow">{{ localeName(l) }}</span>
            <button
              v-if="access.publish && def.drafts && doc.locales[l]?.status && doc.locales[l]!.status !== 'published'" class="btn btn-xs" :disabled="saving"
              :title="`Publier seulement la version ${localeName(l)}`" @click="publishLocale(l)"
            >
              Publier
            </button>
            <span class="badge badge-xs badge-soft" :class="doc.locales[l]?.status ? statusMeta[doc.locales[l]!.status!]?.cls : 'badge-warning'">
              {{ doc.locales[l]?.status ? statusMeta[doc.locales[l]!.status!]?.label : 'À traduire' }}
            </span>
          </div>
        </div>
      </aside>
    </div>

    <CmsHistory
      v-if="showHistory && doc.id" :type="type" :id="doc.id" :def="def" :locales="locales" :default-locale="defaultLocale" :dirty="dirty"
      @close="showHistory = false" @restored="onRestored" @load="onLoadVersion"
    />

    <div v-if="conflict" class="modal modal-open" data-cms-conflict>
      <div class="modal-box space-y-4">
        <h3 class="font-bold text-lg">Ce contenu a été modifié entre-temps</h3>
        <p class="text-sm">
          {{ conflictWho }} enregistré des modifications {{ cmsFormatWhen(conflict.at) }}<template v-if="conflict.self"> dans une autre fenêtre</template>,
          après l'ouverture de cette page.
          <template v-if="multi">Elles concernent {{ conflict.parts.map(partName).join(' et ') }}.</template>
          Vos propres modifications ne sont pas encore enregistrées.
        </p>
        <div class="space-y-3">
          <div class="border border-base-300 rounded-box p-3 space-y-2">
            <button type="button" class="btn btn-sm btn-block" @click="reloadLatest">Recharger la version à jour</button>
            <p class="text-xs text-base-content/60">Vous voyez les modifications enregistrées entre-temps. Les vôtres sont abandonnées.</p>
          </div>
          <div class="border border-base-300 rounded-box p-3 space-y-2">
            <button type="button" class="btn btn-sm btn-block btn-primary" :disabled="saving" @click="conflict.retry()">Enregistrer quand même</button>
            <p class="text-xs text-base-content/60">Vos modifications remplacent les autres. La version remplacée reste disponible dans l'historique.</p>
          </div>
        </div>
        <div class="modal-action"><button type="button" class="btn btn-ghost" @click="conflict = null">Annuler</button></div>
      </div>
    </div>
    <div v-if="asking" class="modal modal-open">
      <form class="modal-box space-y-3" @submit.prevent="requestReview">
        <h3 class="font-bold text-lg">Demander la publication</h3>
        <p class="text-sm text-base-content/60">Les personnes qui peuvent publier ce contenu verront votre demande. Vous pouvez continuer à modifier le brouillon en attendant.</p>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Message (facultatif)</legend>
          <textarea v-model="reviewNote" class="textarea w-full" rows="3" maxlength="500" placeholder="Ce qui a changé, ce qu'il faut vérifier…" />
        </fieldset>
        <div class="modal-action">
          <button type="button" class="btn" @click="asking = false">Annuler</button>
          <button class="btn btn-primary">Envoyer la demande</button>
        </div>
      </form>
      <div class="modal-backdrop" @click="asking = false" />
    </div>
  </section>
</template>
