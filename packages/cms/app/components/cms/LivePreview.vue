<script setup lang="ts">
import { ExternalLink, Monitor, MonitorPlay, RefreshCw, Smartphone, Tablet, X } from '@lucide/vue'
import { LIVE_DEVICES, type LiveDeviceId, clampLiveShare, liveScale } from '../../../shared/live-preview'

/**
 * Aperçu en direct : la page du site dans un volet à côté du formulaire, mise à jour pendant la saisie, sans enregistrer.
 * Le composant affiche son bouton là où il est placé, et le volet par-dessus la droite de l'écran
 * (sur petit écran : une bascule Formulaire / Aperçu en bas de l'écran).
 *
 * Fonctionnement (voir `shared/live-preview.ts`) : à chaque pause dans la saisie, les valeurs du formulaire sont
 * préparées par le serveur comme le ferait l'API publique, puis envoyées à la page du cadre, qui les affiche.
 */
const props = defineProps<{
  type: string
  doc: { id: string | null; version: number; shared: Record<string, any>; locales: Record<string, { values: Record<string, any> }> }
  /** Langue en cours d'édition : l'aperçu la suit. */
  locale: string
  defaultLocale: string
}>()

const icons = { desktop: Monitor, tablet: Tablet, phone: Smartphone }

// Le volet reste ouvert d'un contenu à l'autre (et après le premier enregistrement d'un nouveau contenu).
const open = useState('cms-live-open', () => false)
const wide = ref(true)
const view = ref<'form' | 'preview'>('preview')
const device = ref<LiveDeviceId>('desktop')
const share = ref(0.5)
const anchor = ref<HTMLElement>()
const stage = ref<HTMLElement>()
const frame = ref<HTMLIFrameElement>()
const stageSize = reactive({ width: 0, height: 0 })
const panelWidth = ref(0)
const dragging = ref(false)

const { src, frameKey, status, unavailable, problem, prepare, reload } = useCmsLiveFrame({
  type: props.type, doc: () => props.doc, locale: () => props.locale, defaultLocale: () => props.defaultLocale, enabled: open, frame,
})

function openTab() {
  if (src.value) window.open(src.value, '_blank')
}

// ───── Mise en page : volet à droite, ou bascule sur petit écran ─────

/** Colonne du back-office (barre du haut et écran) : elle laisse sa place au volet. */
const column = () => anchor.value?.closest<HTMLElement>('.drawer-content') ?? null
const form = () => anchor.value?.closest<HTMLElement>('section') ?? null

function layout() {
  const host = column()
  if (!host) return
  const side = open.value && wide.value
  panelWidth.value = side ? Math.round(clampLiveShare(share.value) * host.getBoundingClientRect().width) : 0
  host.style.paddingRight = side ? `${panelWidth.value}px` : ''
  host.style.paddingBottom = open.value && !wide.value ? '3.5rem' : ''
  // Formulaire à l'étroit : ses blocs latéraux passent sous les champs (règle en bas de ce fichier).
  form()?.classList.toggle('cms-live-narrow', side && host.getBoundingClientRect().width - panelWidth.value < 960)
}

function measure() {
  if (!stage.value) return
  stageSize.width = stage.value.clientWidth
  stageSize.height = stage.value.clientHeight
}

const current = computed(() => LIVE_DEVICES.find(d => d.id === device.value)!)
/** Le cadre est affiché à la largeur de l'appareil choisi, puis réduit pour tenir dans le volet. */
const frameBox = computed(() => {
  const margin = device.value === 'desktop' ? 0 : 24
  const available = Math.max(0, stageSize.width - margin * 2)
  const height = Math.max(0, stageSize.height - margin * 2)
  // « Ordinateur » occupe tout le volet quand celui-ci est plus large que la largeur de référence.
  const width = device.value === 'desktop' ? Math.max(current.value.width, available) : current.value.width
  const scale = liveScale(width, available)
  return { width, scale, outer: { width: `${Math.round(width * scale)}px`, height: `${height}px`, margin: `${margin}px auto` }, inner: { width: `${width}px`, height: `${scale ? height / scale : height}px`, transform: `scale(${scale})` } }
})

function toggle() {
  open.value = !open.value
  if (open.value) view.value = 'preview'
}
function close() {
  open.value = false
}

function drag(event: PointerEvent) {
  const host = column()
  if (!dragging.value || !host) return
  const box = host.getBoundingClientRect()
  share.value = clampLiveShare((box.right - event.clientX) / box.width)
  layout()
}
function endDrag() {
  dragging.value = false
  try { localStorage.setItem('cms-live-share', String(share.value)) }
  catch { /* stockage indisponible : la largeur n'est retenue que pour cette visite */ }
}
function nudge(by: number) {
  share.value = clampLiveShare(share.value + by)
  layout()
  endDrag()
}

let media: MediaQueryList | undefined
let observer: ResizeObserver | undefined
const onMedia = () => { wide.value = !!media?.matches; if (!wide.value && device.value === 'desktop') device.value = 'phone' }

watch([open, wide], async () => {
  await nextTick()
  layout()
  measure()
})
watch(stage, (el) => {
  observer?.disconnect()
  if (!el) return
  observer = new ResizeObserver(measure)
  observer.observe(el)
  measure()
})

onMounted(() => {
  try { share.value = clampLiveShare(Number(localStorage.getItem('cms-live-share') ?? 0.5)) }
  catch { /* stockage indisponible */ }
  media = window.matchMedia('(min-width: 1024px)')
  media.addEventListener('change', onMedia)
  onMedia()
  window.addEventListener('resize', layout)
  layout()
})
onBeforeUnmount(() => {
  observer?.disconnect()
  media?.removeEventListener('change', onMedia)
  window.removeEventListener('resize', layout)
  // La mise en page du back-office est rendue telle quelle à l'écran suivant.
  const host = column()
  if (host) host.style.paddingRight = host.style.paddingBottom = ''
  form()?.classList.remove('cms-live-narrow')
})

const statusText = computed(() => ({ wait: 'Chargement…', updating: 'Mise à jour…', live: 'À jour avec votre saisie', late: 'Aperçu en retard' })[status.value])
</script>

<template>
  <button
    ref="anchor" type="button" class="btn btn-sm btn-block" :class="{ 'btn-active': open }" :aria-pressed="open" data-cms-live-toggle
    title="Voir la page à côté du formulaire : elle suit ce que vous tapez, sans rien enregistrer" @click="toggle"
  >
    <MonitorPlay :size="16" />{{ open ? 'Fermer l\'aperçu en direct' : 'Aperçu en direct' }}
  </button>

  <!-- `m-0` : le volet est posé dans un bloc qui espace ses éléments ; lui est hors du flux. -->
  <template v-if="open">
    <div
      v-show="wide || view === 'preview'" data-cms-live-panel
      class="fixed z-[25] m-0 bg-base-200 flex flex-col" :class="wide ? 'top-0 right-0 bottom-0 border-l border-base-300' : 'inset-x-0 top-0 bottom-14'"
      :style="wide ? { width: `${panelWidth}px` } : undefined"
    >
      <!-- Séparation réglable : à la souris, ou aux flèches du clavier. -->
      <div
        v-if="wide" role="separator" aria-orientation="vertical" tabindex="0" aria-label="Largeur de l'aperçu (flèches gauche et droite)" data-cms-live-resize
        class="absolute inset-y-0 -left-1 w-2 cursor-col-resize z-10 hover:bg-primary/30 focus-visible:bg-primary/40 outline-none" :class="{ 'bg-primary/40': dragging }"
        @pointerdown.prevent="dragging = true; ($event.target as HTMLElement).setPointerCapture($event.pointerId)"
        @pointermove="drag" @pointerup="endDrag" @pointercancel="endDrag"
        @keydown.left.prevent="nudge(0.05)" @keydown.right.prevent="nudge(-0.05)" @dblclick="share = 0.5; layout(); endDrag()"
      />

      <div class="flex items-center gap-2 h-14 px-3 bg-base-100 border-b border-base-300 shrink-0">
        <div class="min-w-0 mr-auto">
          <div class="text-sm font-semibold truncate">Aperçu en direct</div>
          <div class="text-xs text-base-content/60 flex items-center gap-1.5 truncate" role="status" data-cms-live-status :data-state="unavailable ? 'unavailable' : status" :title="problem ?? undefined">
            <template v-if="!unavailable">
              <span class="status shrink-0" :class="status === 'live' ? 'status-success' : status === 'late' ? 'status-error' : 'status-warning'" />
              <span class="truncate">{{ statusText }}</span>
            </template>
            <span v-else class="truncate">Pas encore disponible</span>
          </div>
        </div>
        <div class="join" role="group" aria-label="Largeur de la page">
          <button
            v-for="d in LIVE_DEVICES" :key="d.id" type="button" class="btn btn-sm btn-square join-item" :class="{ 'btn-active': device === d.id }"
            :title="`${d.label} (${d.width} px)`" :aria-label="d.label" :aria-pressed="device === d.id" :data-cms-live-device="d.id" @click="device = d.id"
          >
            <component :is="icons[d.id]" :size="16" />
          </button>
        </div>
        <button type="button" class="btn btn-sm btn-ghost btn-square" title="Recharger la page de l'aperçu" aria-label="Recharger l'aperçu" :disabled="!src" data-cms-live-reload @click="reload"><RefreshCw :size="16" /></button>
        <button type="button" class="btn btn-sm btn-ghost btn-square" title="Ouvrir dans un onglet (dernière version enregistrée)" aria-label="Ouvrir l'aperçu dans un onglet" :disabled="!src" data-cms-live-tab @click="openTab"><ExternalLink :size="16" /></button>
        <button type="button" class="btn btn-sm btn-ghost btn-square" title="Fermer l'aperçu en direct" aria-label="Fermer l'aperçu en direct" data-cms-live-close @click="close"><X :size="16" /></button>
      </div>

      <div v-if="problem && !unavailable" class="alert alert-warning alert-soft rounded-none text-sm py-2" role="alert">
        <span>{{ problem }} La page affiche votre saisie précédente.</span>
        <button type="button" class="btn btn-xs" @click="prepare">Réessayer</button>
      </div>

      <div ref="stage" class="grow min-h-0 overflow-hidden relative">
        <div v-if="unavailable" class="h-full grid place-items-center p-6 text-center">
          <div class="max-w-xs space-y-2">
            <MonitorPlay :size="28" class="mx-auto text-base-content/40" />
            <p class="text-sm" data-cms-live-unavailable>{{ unavailable }}</p>
            <p class="text-xs text-base-content/60">Enregistrez, puis l'aperçu s'affichera ici et suivra votre saisie.</p>
          </div>
        </div>
        <div v-else-if="src" class="overflow-hidden bg-base-100" :class="device === 'desktop' ? '' : 'rounded-box border border-base-300 shadow-sm'" :style="frameBox.outer">
          <!-- La page du site elle-même, de la même origine que le back-office. Pendant le réglage de la largeur, elle ne capte pas la souris. -->
          <iframe
            :key="frameKey" ref="frame" :src="src" title="Aperçu de la page" data-cms-live-frame :data-device="device"
            class="block border-0 origin-top-left bg-white" :class="{ 'pointer-events-none': dragging }" :style="frameBox.inner"
          />
        </div>
        <div v-else class="h-full grid place-items-center"><span class="loading loading-spinner text-base-content/40" /></div>
      </div>
    </div>

    <!-- Petit écran : le formulaire ou la page, l'un à la place de l'autre. -->
    <div v-if="!wide" class="fixed inset-x-0 bottom-0 z-[25] m-0 h-14 bg-base-100 border-t border-base-300 grid place-items-center" data-cms-live-switch>
      <div role="tablist" class="tabs tabs-box tabs-sm">
        <button type="button" role="tab" class="tab" :class="{ 'tab-active': view === 'form' }" :aria-selected="view === 'form'" @click="view = 'form'">Formulaire</button>
        <button type="button" role="tab" class="tab" :class="{ 'tab-active': view === 'preview' }" :aria-selected="view === 'preview'" @click="view = 'preview'">Aperçu</button>
      </div>
    </div>
  </template>
</template>

<style>
/* Formulaire à l'étroit à côté de l'aperçu : une seule colonne, les blocs « Publication » et « Traductions » dessous. */
.cms-live-narrow > .grid { grid-template-columns: minmax(0, 1fr) !important; }
.cms-live-narrow > .grid > aside { position: static !important; }
</style>
