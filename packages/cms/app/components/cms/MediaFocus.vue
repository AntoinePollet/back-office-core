<script setup lang="ts">
import { Crosshair } from '@lucide/vue'
import type { CmsMedia } from '../../composables/useCms'
import { normalizeFocus } from '../../../shared/media'

/**
 * Point d'intérêt d'une image (fiche d'un fichier, dans la médiathèque) : on clique sur l'image là où se trouve le sujet,
 * ou on déplace le point à la souris, au doigt ou avec les flèches du clavier. Les aperçus montrent aussitôt ce que
 * donnent les recadrages courants. Le réglage vaut pour tous les usages du fichier ; il est enregistré dès qu'on relâche.
 */
const props = defineProps<{ media: CmsMedia }>()
const emit = defineEmits<{ saved: [media: CmsMedia] }>()
const toast = useCmsToast()

const CENTER = { x: 0.5, y: 0.5 }
const FORMATS = [
  { ratio: '1/1', label: 'Carré' },
  { ratio: '16/9', label: 'Paysage' },
  { ratio: '3/4', label: 'Portrait' },
  { ratio: '3/1', label: 'Bandeau' },
]

const point = ref({ ...(props.media.focus ?? CENTER) })
// Autre fichier, ou réglage changé ailleurs : le point affiché suit.
watch(() => [props.media.id, props.media.focus?.x, props.media.focus?.y], () => { point.value = { ...(props.media.focus ?? CENTER) } })

const percent = (n: number) => Math.round(n * 100)
const position = computed(() => `${percent(point.value.x)}% ${percent(point.value.y)}%`)
const centered = computed(() => !normalizeFocus(point.value))
const where = computed(() => (centered.value ? 'au centre' : `à ${percent(point.value.x)} % depuis la gauche et ${percent(point.value.y)} % depuis le haut`))

// Place de l'image, connue avant son chargement : 16rem de haut au plus, sans dépasser la largeur disponible.
const frame = computed(() => (props.media.width && props.media.height
  ? { aspectRatio: `${props.media.width} / ${props.media.height}`, width: `calc(16rem * ${props.media.width / props.media.height})` }
  : undefined))

const saving = ref(false)
let pending = false
async function save() {
  const focus = normalizeFocus(point.value)
  const saved = props.media.focus
  if ((focus?.x ?? 0.5) === (saved?.x ?? 0.5) && (focus?.y ?? 0.5) === (saved?.y ?? 0.5)) return
  // Un réglage arrivé pendant un enregistrement part juste après : c'est toujours le dernier point qui est gardé.
  if (saving.value) { pending = true; return }
  saving.value = true
  try {
    const { purgeFailed, ...updated } = await cmsApi<CmsMedia & { purgeFailed: boolean }>(`/api/cms/media/${props.media.id}`, { method: 'PATCH', body: { focus } })
    cmsSiteUpdated({ purgeFailed })
    emit('saved', updated)
    toast.success(focus ? 'Point d\'intérêt enregistré' : 'Point d\'intérêt remis au centre')
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
  finally {
    saving.value = false
    if (pending) { pending = false; nextTick(save) }
  }
}

// ───── Souris et doigt ─────
const area = ref<HTMLElement>()
const dragging = ref(false)
function place(e: PointerEvent) {
  const box = area.value!.getBoundingClientRect()
  if (!box.width || !box.height) return
  const unit = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 100) / 100
  point.value = { x: unit((e.clientX - box.left) / box.width), y: unit((e.clientY - box.top) / box.height) }
}
function down(e: PointerEvent) {
  if (e.button > 0) return
  dragging.value = true
  area.value!.setPointerCapture?.(e.pointerId)
  place(e)
}
function move(e: PointerEvent) {
  if (dragging.value) place(e)
}
function up() {
  if (!dragging.value) return
  dragging.value = false
  save()
}

// ───── Clavier ─────
let timer: ReturnType<typeof setTimeout> | undefined
function key(e: KeyboardEvent) {
  const step = e.shiftKey ? 0.1 : 0.01
  const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
  const by = moves[e.key]
  if (!by) return
  e.preventDefault()
  const unit = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 100) / 100
  point.value = { x: unit(point.value.x + by[0]), y: unit(point.value.y + by[1]) }
  // Enregistré quand les flèches s'arrêtent (ou quand on quitte le point).
  clearTimeout(timer)
  timer = setTimeout(save, 700)
}
function leave() {
  clearTimeout(timer)
  save()
}
onBeforeUnmount(() => clearTimeout(timer))

function reset() {
  point.value = { ...CENTER }
  save()
}
</script>

<template>
  <div class="space-y-2" data-focus>
    <div class="rounded-field bg-base-200 text-center leading-none">
      <!-- La zone épouse l'image : la position du point se lit en proportion de ses côtés. -->
      <div
        ref="area" class="relative inline-block max-w-full align-top cursor-crosshair touch-none select-none" :style="frame" data-focus-area
        @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up"
      >
        <img :src="cmsImageUrl(media, 640)" class="block rounded-field pointer-events-none" :class="frame ? 'w-full h-full' : 'max-w-full max-h-64'" alt="" draggable="false">
        <button
          type="button" data-focus-point
          class="absolute size-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-primary/60 shadow-[0_0_0_2px_rgba(0,0,0,.55)] cursor-grab focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white grid place-items-center text-white"
          :class="{ 'cursor-grabbing': dragging }"
          :style="{ left: `${percent(point.x)}%`, top: `${percent(point.y)}%` }"
          :aria-label="`Point d'intérêt : ${where}. Déplacez-le avec les flèches du clavier (Maj : plus vite).`"
          @keydown="key" @blur="leave"
        >
          <Crosshair :size="14" aria-hidden="true" />
        </button>
      </div>
    </div>

    <p class="text-xs text-base-content/60">
      <span class="font-medium text-base-content">Point d'intérêt</span> : cliquez sur l'image là où se trouve le sujet (un visage, un produit).
      Il restera visible partout où l'image est recadrée.
    </p>

    <div>
      <div class="flex items-center gap-2 mb-1.5">
        <span class="text-xs text-base-content/60 grow">Aperçu des recadrages <span v-if="saving" class="loading loading-spinner loading-xs align-middle" /></span>
        <button type="button" class="btn btn-xs shrink-0" :disabled="centered" data-focus-reset @click="reset">Remettre au centre</button>
      </div>
      <ul class="flex flex-wrap items-end gap-x-3 gap-y-2">
        <li v-for="f in FORMATS" :key="f.ratio" class="text-center">
          <div class="h-14 rounded-sm overflow-hidden bg-base-300" :style="{ aspectRatio: f.ratio }" :data-focus-preview="f.ratio">
            <img :src="cmsImageUrl(media, 640)" class="w-full h-full object-cover" :style="{ objectPosition: position }" alt="">
          </div>
          <div class="text-[0.6875rem] text-base-content/60 mt-0.5">{{ f.label }}</div>
        </li>
      </ul>
    </div>
  </div>
</template>
