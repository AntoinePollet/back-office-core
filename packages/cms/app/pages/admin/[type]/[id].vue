<script setup lang="ts">
import { ArrowLeft, Eye, EyeOff, Trash2 } from '@lucide/vue'
import { applyDefaults, isEmpty, partition } from '../../../../shared/content'

definePageMeta({ layout: 'admin', middleware: 'cms-auth' })

type LocaleState = { slug: string; status: string | null; values: Record<string, any> }
type Doc = { id: string | null; shared: Record<string, any>; locales: Record<string, LocaleState> }

const route = useRoute()
const toast = useCmsToast()
const type = route.params.type as string
const schema = await useCmsSchema()
const def = (schema.value.collections?.[type] ?? schema.value.singletons?.[type]) as Record<string, any> | undefined
if (!def) throw createError({ statusCode: 404, message: 'Type de contenu inconnu.', fatal: true })

const locales = schema.value.site.locales as readonly string[]
const defaultLocale = schema.value.site.defaultLocale
const multi = locales.length > 1
const isCollection = def.kind === 'collection'
const hasSlug = isCollection && !!def.path?.includes('[slug]')
const hasShared = multi && Object.keys(partition(def.fields).shared).length > 0

const doc = ref<Doc>({ id: null, shared: {}, locales: {} })
const dirty = ref(false)
const saving = ref(false)
const errors = ref<Record<string, Record<string, string>>>({})
const tab = ref<'content' | 'seo'>('content')
const locale = ref(defaultLocale)
const split = ref(false)
const localeB = ref(locales.find(l => l !== defaultLocale) ?? defaultLocale)

/** Met le contenu reçu de l'API dans la forme attendue par le formulaire : toutes les langues présentes. */
function hydrate(data?: any) {
  const next: Doc = {
    id: data?.id ?? null,
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
  nextTick(() => { dirty.value = false })
}

if (route.params.id === 'new') hydrate()
else {
  try {
    hydrate(await cmsApi(`/api/cms/entries/${type}/${route.params.id}`))
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

async function send(extra: { publish?: string[]; unpublish?: string[] }, done: string) {
  saving.value = true
  errors.value = {}
  const body = {
    shared: doc.value.shared,
    locales: Object.fromEntries(locales.map(l => [l, { slug: doc.value.locales[l]!.slug, values: doc.value.locales[l]!.values }])),
    ...extra,
  }
  try {
    const wasNew = !doc.value.id
    const saved = await cmsApi<any>(wasNew ? `/api/cms/entries/${type}` : `/api/cms/entries/${type}/${doc.value.id}`, { method: wasNew ? 'POST' : 'PUT', body })
    hydrate(saved)
    toast.success(done)
    if (wasNew) await navigateTo(`/admin/${type}/${saved.id}`, { replace: true })
  }
  catch (e: any) {
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
  const ready = doc.value.id && !errorCount.value && (!hasSlug || state?.slug)
  if (!ready) { tab?.close(); if (!errorCount.value) toast.error('Rien à prévisualiser dans cette langue : remplissez d\'abord le contenu.'); return }
  const path = (locale.value === defaultLocale ? '' : `/${locale.value}`) + def!.path.replace('[slug]', state!.slug)
  if (tab) tab.location.href = `${path}?preview=1`
}

function unpublish() {
  return send({ unpublish: [...locales] }, 'Contenu retiré du site')
}
async function remove() {
  if (!confirm('Supprimer définitivement ce contenu, dans toutes les langues ?')) return
  try {
    await cmsApi(`/api/cms/entries/${type}/${doc.value.id}`, { method: 'DELETE' })
    dirty.value = false
    toast.success('Contenu supprimé')
    await navigateTo(`/admin/${type}`)
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
}

onBeforeRouteLeave(() => !dirty.value || confirm('Des modifications ne sont pas enregistrées. Quitter quand même ?'))
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
          <button class="btn btn-sm btn-primary" :disabled="saving" @click="publish">Publier</button>
        </template>
        <button v-else class="btn btn-sm btn-primary" :disabled="!dirty || saving" @click="save">Enregistrer</button>
      </div>
    </div>

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
        <div v-if="def.drafts || def.path || (isCollection && doc.id)" class="card bg-base-100 border border-base-300 p-4 text-sm space-y-3">
          <div class="font-semibold">Publication</div>
          <div v-if="def.drafts" class="flex justify-between"><span class="text-base-content/60">Statut</span><span>{{ statusMeta[status]?.label }}</span></div>
          <button v-if="def.path" class="btn btn-sm btn-block" :disabled="saving" @click="preview"><Eye :size="16" />Aperçu du brouillon</button>
          <button v-if="def.drafts && isOnline" class="btn btn-sm btn-block" :disabled="saving" @click="unpublish"><EyeOff :size="16" />Retirer du site</button>
          <button v-if="isCollection && doc.id" class="btn btn-sm btn-ghost btn-block text-error" @click="remove"><Trash2 :size="16" />Supprimer</button>
        </div>
        <div v-if="multi" class="card bg-base-100 border border-base-300 p-4 text-sm space-y-2">
          <div class="font-semibold">Traductions</div>
          <div v-for="l in locales" :key="l" class="flex items-center gap-2">
            <span class="capitalize grow">{{ localeName(l) }}</span>
            <button
              v-if="def.drafts && doc.locales[l]?.status && doc.locales[l]!.status !== 'published'" class="btn btn-xs" :disabled="saving"
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
  </section>
</template>
