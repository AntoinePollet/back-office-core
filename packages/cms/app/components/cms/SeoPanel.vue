<script setup lang="ts">
import { CircleCheck, Info, Lightbulb, Monitor, Smartphone, TriangleAlert } from '@lucide/vue'
import { slugify } from '../../../shared/content'
import { cmsImageUrl } from '../../../shared/media'
import { SEO_LIMITS, seoOutlineTips, seoPath, seoPoints, seoTips, seoView, textWidth, truncateToChars, truncateToWidth, type SeoOther, type SeoSite } from '../../../shared/seo'

/**
 * Onglet Référencement d'un contenu, pour une langue : champs, aperçus (résultat Google, carte de partage) et conseils.
 * Tout est recalculé pendant la saisie, avec la même logique que le site et que la vue d'ensemble (`shared/seo.ts`).
 * L'image de partage et « masquer des moteurs de recherche », communs aux langues, restent dans le formulaire.
 */
const props = defineProps<{
  def: Record<string, any>
  doc: { id?: string | null; version?: number; shared: Record<string, any>; locales: Record<string, { slug: string; status: string | null; values: Record<string, any> }> }
  loc: string
  defaultLocale: string
  /** L'onglet est affiché : les données des autres pages ne sont chargées qu'à ce moment. */
  active: boolean
}>()

type OtherPage = { type: string; id: string; locale: string; name: string; baseTitle: string; description: string; to: string }

const route = useRoute()
const type = route.params.type as string
// La configuration est déjà chargée par le formulaire : lue sans attente, pour que le volet s'affiche tout de suite.
const site = useState<{ site: SeoSite } | null>('cms-schema').value!.site
const { items: mediaItems, load: loadMedia } = useCmsMedia()
const state = computed(() => props.doc.locales[props.loc]!)
const device = ref<'desktop' | 'mobile'>('desktop')

// Les autres pages du site (pour les doublons) et la médiathèque (tailles et textes alternatifs), à la première ouverture.
const pages = ref<OtherPage[]>([])
let loaded = false
watch(() => props.active, async (active) => {
  if (!active || loaded) return
  loaded = true
  loadMedia().catch(() => {})
  pages.value = await cmsApi<OtherPage[]>('/api/cms/seo').catch(() => [])
}, { immediate: true })

const view = computed(() => seoView(props.def as never, props.doc.shared, state.value.values, site))
const others = computed<SeoOther[]>(() => pages.value
  .filter(p => p.locale === props.loc && !(p.type === type && p.id === (props.doc.id ?? type)))
  .map(p => ({ name: p.name, title: p.baseTitle, description: p.description, to: p.to })))
const media = (id: string) => mediaItems.value?.find(m => m.id === id)
const hasSlug = computed(() => props.def.kind === 'collection' && !!props.def.path?.includes('[slug]'))
const slug = computed(() => state.value.slug || (hasSlug.value ? slugify(String(state.value.values[props.def.slugFrom ?? props.def.titleField] ?? '')) : ''))

const tips = computed(() => seoTips({
  def: props.def as never, site, locale: props.loc, defaultLocale: props.defaultLocale,
  shared: props.doc.shared, values: state.value.values, slug: state.value.slug,
  published: !!state.value.status && state.value.status !== 'draft', media, others: others.value,
}))

// ───── Titres de la page (H1 à H6) ─────
// Lus dans la page elle-même, affichée dans un cadre caché avec la saisie en cours : le titre principal est placé par
// le gabarit du site, et seule la page dit lesquels de ses textes sont des titres, et de quel niveau.
const access = useCmsAccess(type)
const probe = ref<HTMLIFrameElement>()
/** Pas de page à lire : contenu sans adresse, ou droits limités à ses propres contenus (comme l'aperçu en direct). */
const outlineOff = computed(() => (!props.def.path ? 'page' : access.own ? 'own' : null))
const live = useCmsLiveFrame({
  type, doc: () => props.doc, locale: () => props.loc, defaultLocale: () => props.defaultLocale,
  enabled: computed(() => props.active && !outlineOff.value), frame: probe,
})
const { src: probeSrc, frameKey: probeKey, unavailable: outlineUnavailable } = live
const outline = computed(() => {
  const o = live.outline.value
  return o && o.id === props.doc.id && o.locale === props.loc ? o.headings : null
})
const outlineTips = computed(() => (outline.value ? seoOutlineTips(outline.value, { baseTitle: view.value.baseTitle, noindex: view.value.noindex }) : []))
const placeLabels: Record<string, string> = { header: 'en-tête du site', nav: 'menu', footer: 'pied de page', aside: 'encadré' }

const allTips = computed(() => [...tips.value, ...outlineTips.value])
const points = computed(() => seoPoints(allTips.value))
const tipIcon = { important: TriangleAlert, conseil: Lightbulb, rappel: Info }
const tipClass = { important: 'text-warning', conseil: 'text-info', rappel: 'text-base-content/50' }

// ───── Aperçu du résultat Google ─────
const origin = computed(() => (site.url ?? (import.meta.client ? location.origin : '')).replace(/\/$/, ''))
const host = computed(() => origin.value.replace(/^https?:\/\//, ''))
const path = computed(() => seoPath(props.def, props.loc, props.defaultLocale, slug.value) ?? '/')
/** Adresse présentée comme dans les résultats : « site.fr › services › droit-des-affaires ». */
const crumbs = computed(() => [origin.value, ...path.value.split('/').filter(Boolean)].join(' › '))
const titleShown = computed(() => (view.value.pageTitle ? truncateToWidth(view.value.pageTitle) : null))
const descriptionShown = computed(() => (view.value.description
  ? truncateToChars(view.value.description, device.value === 'mobile' ? SEO_LIMITS.descriptionMobileChars : SEO_LIMITS.descriptionMaxChars).text
  : ''))
/** Part de la largeur disponible occupée par le titre, pour la jauge sous le champ. */
const titleFill = computed(() => Math.min(100, Math.round(100 * textWidth(view.value.pageTitle ?? '', SEO_LIMITS.titleFontPx) / SEO_LIMITS.titleMaxPx)))
const titlePlaceholder = computed(() => (view.value.titleFrom === 'content' ? view.value.baseTitle : ''))
const titleHelp = computed(() => {
  if (props.def.kind === 'collection') return `Laissé vide, le titre du contenu est utilisé.${site.titleSuffix ? ` Le site ajoute « — ${site.titleSuffix} » à la fin.` : ''}`
  return site.titleSuffix
    ? `Le site ajoute « — ${site.titleSuffix} » à la fin. Laissé vide, le titre sera seulement « ${site.titleSuffix} ».`
    : 'Le titre affiché dans Google et dans l\'onglet du navigateur.'
})

// ───── Aperçu de la carte de partage ─────
const shareImage = computed(() => {
  const file = view.value.imageId ? media(view.value.imageId) : undefined
  if (file) return cmsImageUrl(file, 640)
  return view.value.imageId ? '' : view.value.fallbackImage ?? ''
})
</script>

<template>
  <div class="@container" data-seo-panel :data-seo-locale="loc">
    <div class="grid gap-6 items-start @2xl:grid-cols-[minmax(0,1fr)_16rem]">
      <div class="space-y-5 min-w-0">
        <!-- Résultat de recherche -->
        <section class="space-y-2">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="text-sm font-semibold grow whitespace-nowrap">Aperçu dans Google</h3>
            <div role="tablist" class="tabs tabs-box tabs-xs flex-nowrap" aria-label="Appareil de l'aperçu">
              <a role="tab" class="tab gap-1" :class="{ 'tab-active': device === 'desktop' }" data-seo-device="desktop" @click="device = 'desktop'"><Monitor :size="13" />Ordinateur</a>
              <a role="tab" class="tab gap-1" :class="{ 'tab-active': device === 'mobile' }" data-seo-device="mobile" @click="device = 'mobile'"><Smartphone :size="13" />Téléphone</a>
            </div>
          </div>
          <div class="cms-serp" :class="`cms-serp-${device}`" data-seo-google :data-device="device">
            <div class="cms-serp-site">
              <span class="cms-serp-icon" aria-hidden="true">{{ site.name.slice(0, 1) }}</span>
              <span class="min-w-0">
                <span class="cms-serp-name">{{ site.name }}</span>
                <span class="cms-serp-url" data-seo-url>{{ crumbs }}</span>
              </span>
            </div>
            <div v-if="titleShown" class="cms-serp-title" data-seo-title>{{ device === 'desktop' ? titleShown.text : view.pageTitle }}</div>
            <div v-else class="cms-serp-title cms-serp-empty" data-seo-title>Pas de titre : le site affichera son titre par défaut</div>
            <div v-if="descriptionShown" class="cms-serp-text" data-seo-description>{{ descriptionShown }}</div>
            <div v-else class="cms-serp-text cms-serp-empty" data-seo-description>Sans description, Google choisit lui-même un extrait de la page.</div>
            <div v-if="view.noindex" class="cms-serp-hidden" data-seo-hidden>Page masquée : elle n'apparaîtra pas dans les résultats.</div>
          </div>
        </section>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Titre pour les moteurs de recherche</legend>
          <input v-model="state.values.seo.title" class="input w-full" :placeholder="titlePlaceholder" data-seo-input="title">
          <progress class="progress h-1 w-full" :class="titleShown?.cut ? 'progress-warning' : 'progress-success'" :value="titleFill" max="100" aria-hidden="true" />
          <p v-if="titleShown?.cut" class="label block whitespace-normal" data-seo-cut>
            Trop long, Google le coupera ici :
            <span class="text-base-content">{{ view.pageTitle!.slice(0, titleShown.kept) }}</span><span class="line-through text-base-content/40" data-seo-cut-rest>{{ view.pageTitle!.slice(titleShown.kept) }}</span>
          </p>
          <p v-else class="label whitespace-normal">{{ titleHelp }}</p>
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Description</legend>
          <textarea v-model="state.values.seo.description" class="textarea w-full" rows="3" data-seo-input="description" />
          <p class="label flex justify-between gap-2 whitespace-normal">
            <span>Une ou deux phrases qui résument la page et donnent envie de cliquer.</span>
            <span class="shrink-0" :class="{ 'text-warning': view.description.length > SEO_LIMITS.descriptionMaxChars }">{{ view.description.length }} / {{ SEO_LIMITS.descriptionMaxChars }}</span>
          </p>
        </fieldset>

        <!-- Titres de la page, lus dans la page rendue -->
        <section class="space-y-2 pt-2 border-t border-base-300" data-seo-outline :data-state="outlineOff || (outlineUnavailable ? 'unavailable' : outline ? 'ready' : 'loading')">
          <h3 class="text-sm font-semibold pt-3">Titres de la page</h3>
          <p class="text-xs text-base-content/60">
            Les titres tels que Google les lit sur la page, avec votre saisie. Le titre principal (H1) annonce le sujet de la page ;
            les titres de section (H2) et les sous-titres (H3) la découpent. Dans les textes mis en forme, ce sont les boutons
            « Titre de section » et « Sous-titre ».
          </p>
          <p v-if="outlineOff === 'page'" class="text-sm text-base-content/60">Ce contenu n'a pas de page à lui sur le site.</p>
          <p v-else-if="outlineOff === 'own'" class="text-sm text-base-content/60">Non disponible avec vos droits : la page affiche aussi des contenus d'autres personnes.</p>
          <p v-else-if="outlineUnavailable" class="text-sm text-base-content/60" data-seo-outline-unavailable>Les titres de la page seront lisibles après le premier enregistrement de ce contenu dans cette langue.</p>
          <p v-else-if="!outline" class="text-sm text-base-content/60 flex items-center gap-2"><span class="loading loading-spinner loading-xs" />Lecture de la page…</p>
          <p v-else-if="!outline.length" class="text-sm text-base-content/60" data-seo-outline-empty>Aucun titre sur cette page.</p>
          <ol v-else class="rounded-box border border-base-300 bg-base-100 p-3 space-y-1 text-sm">
            <li
              v-for="(h, i) in outline" :key="i" class="flex items-baseline gap-2 min-w-0" :style="{ paddingLeft: `${Math.min(h.level - 1, 5) * 1.1}rem` }"
              :data-seo-heading="h.level" :data-place="h.place"
            >
              <span class="badge badge-sm shrink-0 font-mono" :class="h.level === 1 ? 'badge-primary' : 'badge-ghost'">H{{ h.level }}</span>
              <span class="min-w-0 break-words" :class="{ 'italic text-base-content/50': !h.text, 'text-base-content/60': h.place !== 'main' }">{{ h.text || 'titre vide' }}</span>
              <span v-if="h.place !== 'main'" class="text-xs text-base-content/40 shrink-0">{{ placeLabels[h.place] }}</span>
            </li>
          </ol>
          <!-- La page du site, invisible, à la largeur d'un ordinateur : seuls ses titres sont lus. -->
          <iframe v-if="probeSrc" :key="probeKey" ref="probe" :src="probeSrc" title="Lecture des titres de la page" aria-hidden="true" tabindex="-1" class="cms-outline-probe" data-seo-probe />
        </section>

        <!-- Carte de partage -->
        <section class="space-y-2 pt-2 border-t border-base-300">
          <h3 class="text-sm font-semibold pt-3">Aperçu d'un partage</h3>
          <p class="text-xs text-base-content/60">Ce qui s'affiche quand le lien de la page est partagé sur un réseau social ou envoyé par message.</p>
          <div class="cms-share" :class="{ 'cms-share-compact': !shareImage }" data-seo-share>
            <img v-if="shareImage" :src="shareImage" class="cms-share-image" alt="" data-seo-share-image>
            <div v-else class="cms-share-noimage" aria-hidden="true" data-seo-share-noimage>{{ site.name.slice(0, 1) }}</div>
            <div class="cms-share-body">
              <div class="cms-share-host" data-seo-share-host>{{ host }}</div>
              <div v-if="view.shareTitle" class="cms-share-title" data-seo-share-title>{{ view.shareTitle }}</div>
              <div v-else class="cms-share-title cms-serp-empty" data-seo-share-title>Pas de titre</div>
              <div v-if="view.shareDescription" class="cms-share-text" data-seo-share-description>{{ view.shareDescription }}</div>
            </div>
          </div>
          <p v-if="!view.imageId && view.fallbackImage" class="text-xs text-base-content/60" data-seo-share-default>Cette page n'a pas d'image de partage : l'image par défaut du site est utilisée.</p>
        </section>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Titre pour le partage <span class="font-normal text-base-content/50">(facultatif)</span></legend>
          <input v-model="state.values.seo.shareTitle" class="input w-full" :placeholder="view.pageTitle ?? ''" data-seo-input="shareTitle">
          <p class="label whitespace-normal">Laissé vide, le titre ci-dessus est repris. Ici, le nom du site n'est pas ajouté.</p>
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Description pour le partage <span class="font-normal text-base-content/50">(facultatif)</span></legend>
          <textarea v-model="state.values.seo.shareDescription" class="textarea w-full" rows="2" :placeholder="view.description" data-seo-input="shareDescription" />
          <p class="label whitespace-normal">Laissée vide, la description ci-dessus est reprise.</p>
        </fieldset>
      </div>

      <!-- Conseils -->
      <aside class="rounded-box border border-base-300 bg-base-200/40 p-4 text-sm space-y-3 @2xl:sticky @2xl:top-32" data-seo-tips>
        <div class="font-semibold">
          <template v-if="points">{{ points }} point{{ points > 1 ? 's' : '' }} à voir</template>
          <template v-else>Conseils</template>
        </div>
        <p v-if="!allTips.length" class="flex gap-2 text-base-content/70" data-seo-ok><CircleCheck :size="16" class="shrink-0 mt-0.5 text-success" />Rien à signaler : cette page est prête.</p>
        <ul class="space-y-3">
          <li v-for="tip in allTips" :key="tip.id" class="flex gap-2" :data-seo-tip="tip.id">
            <component :is="tipIcon[tip.level]" :size="16" class="shrink-0 mt-0.5" :class="tipClass[tip.level]" />
            <div class="min-w-0">
              <div class="font-medium">{{ tip.title }}</div>
              <div class="text-base-content/70">{{ tip.advice }}</div>
              <div v-if="tip.links?.length" class="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                <NuxtLink v-for="link in tip.links" :key="link.to" :to="link.to" target="_blank" class="link link-primary break-all">{{ link.label }}</NuxtLink>
              </div>
            </div>
          </li>
        </ul>
        <p class="text-xs text-base-content/50">Ce sont des repères, pas des obligations : la page peut être publiée telle quelle.</p>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.cms-outline-probe { position: fixed; left: -20000px; top: 0; width: 1280px; height: 900px; border: 0; opacity: 0; pointer-events: none; }

/* Résultat de recherche : mêmes polices, tailles et couleurs que dans un moteur de recherche, sans logo ni marque. */
.cms-serp { background: #fff; border: 1px solid var(--color-base-300); border-radius: var(--radius-box); padding: 1rem 1.25rem; font-family: Arial, Helvetica, sans-serif; color: #4d5156; overflow: hidden; }
.cms-serp-mobile { max-width: 24rem; padding: 0.875rem 1rem; }
.cms-serp-site { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.4rem; min-width: 0; }
.cms-serp-icon { flex: none; width: 1.75rem; height: 1.75rem; border-radius: 9999px; background: #f1f3f4; border: 1px solid #dadce0; display: grid; place-items: center; font-size: 0.8rem; font-weight: 700; color: #5f6368; text-transform: uppercase; }
.cms-serp-name { display: block; font-size: 0.875rem; line-height: 1.25rem; color: #202124; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cms-serp-url { display: block; font-size: 0.75rem; line-height: 1rem; color: #4d5156; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cms-serp-title { font-size: 20px; line-height: 1.3; color: #1a0dab; }
.cms-serp-desktop .cms-serp-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cms-serp-mobile .cms-serp-title { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.cms-serp-text { margin-top: 0.2rem; font-size: 14px; line-height: 1.58; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.cms-serp-mobile .cms-serp-text { -webkit-line-clamp: 3; }
.cms-serp-empty { color: #9aa0a6; font-style: italic; font-weight: 400; }
.cms-serp-title.cms-serp-empty { font-size: 16px; white-space: normal; }
.cms-serp-hidden { margin-top: 0.6rem; font-size: 0.75rem; color: #b06000; }

/* Carte de partage : image large au-dessus, puis domaine, titre et description. */
.cms-share { max-width: 26rem; background: #fff; border: 1px solid #dadde1; border-radius: 0.75rem; overflow: hidden; font-family: Helvetica, Arial, sans-serif; }
.cms-share-image { display: block; width: 100%; aspect-ratio: 1.91 / 1; object-fit: cover; background: #f0f2f5; }
.cms-share-body { padding: 0.6rem 0.8rem 0.7rem; background: #f0f2f5; min-width: 0; }
.cms-share-host { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.02em; color: #65676b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cms-share-title { margin-top: 0.15rem; font-size: 1rem; line-height: 1.25; font-weight: 600; color: #1c1e21; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.cms-share-text { margin-top: 0.15rem; font-size: 0.85rem; line-height: 1.3; color: #65676b; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
/* Sans image : petite carte, une vignette neutre à gauche. */
.cms-share-compact { display: flex; align-items: stretch; }
.cms-share-noimage { flex: none; width: 5.5rem; display: grid; place-items: center; background: #e4e6eb; color: #8a8d91; font-size: 1.5rem; font-weight: 700; text-transform: uppercase; }
.cms-share-compact .cms-share-body { flex: 1; display: flex; flex-direction: column; justify-content: center; }
</style>
