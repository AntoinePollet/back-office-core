<script setup lang="ts">
import { ChevronLeft, ChevronRight, GripVertical, Plus, X } from '@lucide/vue'
import type { CmsMedia } from '../../composables/useCms'

/**
 * Champ image ou fichier avec `multiple` : une liste ordonnée de fichiers de la médiathèque (galerie).
 * Valeur : [{ media: 'id', caption?: '…' }]. Ordre par glisser-déposer, ou au clavier avec les boutons « avant » / « après ».
 */
type Item = { media: string; caption?: string }
const props = defineProps<{ field: Record<string, any>; modelValue?: unknown; invalid?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: Item[]] }>()

const { items: library, load, byId, upload } = useCmsMedia()
const toast = useCmsToast()
const isImageField = computed(() => props.field.type === 'image')
const noun = (n: number) => (isImageField.value ? (n > 1 ? 'images' : 'image') : (n > 1 ? 'fichiers' : 'fichier'))

// Valeur tolérante : une ancienne valeur seule ou une liste d'identifiants s'affichent aussi (le serveur les remet en forme).
const items = computed<Item[]>(() => {
  const v = props.modelValue
  const list = Array.isArray(v) ? v : v ? [v] : []
  return list.flatMap(x => (typeof x === 'string' ? [{ media: x }] : x && typeof x === 'object' && typeof x.media === 'string' ? [x as Item] : []))
})
const set = (next: Item[]) => emit('update:modelValue', next)
/** Clé stable d'un élément, même si le même fichier figure deux fois : le glisser-déposer garde ainsi l'élément déplacé. */
const keys = computed(() => {
  const seen = new Map<string, number>()
  return items.value.map((item) => {
    const n = (seen.get(item.media) ?? 0) + 1
    seen.set(item.media, n)
    return `${item.media}#${n}`
  })
})
/** Fichier supprimé de la médiathèque (une fois la médiathèque chargée). */
const isMissing = (item: Item) => !!library.value && !byId(item.media)
const room = computed(() => (props.field.max != null ? Math.max(0, props.field.max - items.value.length) : undefined))
const full = computed(() => room.value === 0)

onMounted(() => { if (items.value.length) load() })

// ───── Ajout ─────
const picking = ref(false)
const picked = ref<string[]>([])
function openPicker() { picked.value = []; picking.value = true }
function addPicked() {
  set([...items.value, ...picked.value.map(media => ({ media }))])
  picking.value = false
}

/** Fichiers déposés directement sur le champ : importés dans la médiathèque puis ajoutés à la suite. */
const dropping = ref(false)
const uploading = ref(0)
const accepts = (mime: string) => (isImageField.value ? mime.startsWith('image/') : !props.field.accept?.length || props.field.accept.includes(mime))
async function dropFiles(files: FileList | undefined) {
  dropping.value = false
  const added: Item[] = []
  for (const file of Array.from(files ?? [])) {
    if (room.value != null && added.length >= room.value) { toast.error(`${props.field.max} ${noun(props.field.max)} au maximum.`); break }
    if (!accepts(file.type)) { toast.error(`${file.name} : ${isImageField.value ? 'ce n\'est pas une image' : 'type de fichier non accepté ici'}.`); continue }
    uploading.value++
    try {
      added.push({ media: (await upload(file)).id })
      set([...items.value, added.at(-1)!])
    }
    catch (e) {
      toast.error(`${file.name} : ${cmsErrorMessage(e, 'import impossible.')}`)
    }
    uploading.value--
  }
  if (added.length) toast.success(`${added.length} ${noun(added.length)} ajouté${isImageField.value ? 'e' : ''}${added.length > 1 ? 's' : ''}. Pensez au texte alternatif, dans la médiathèque.`)
}
// Un glisser-déposer de fichiers depuis l'ordinateur, pas un déplacement d'image dans la galerie.
const isFileDrag = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files')

// ───── Ordre, légende, retrait ─────
const root = ref<HTMLElement>()
function move(i: number, delta: number, refocus = false) {
  const j = i + delta
  if (j < 0 || j >= items.value.length) return
  const next = [...items.value]
  next.splice(j, 0, next.splice(i, 1)[0]!)
  set(next)
  // Au clavier, le focus suit l'image déplacée.
  if (refocus) nextTick(() => root.value?.querySelector<HTMLElement>(`[data-item="${j}"] [data-move="${delta < 0 ? 'before' : 'after'}"]:not(:disabled)`)?.focus()
    ?? root.value?.querySelector<HTMLElement>(`[data-item="${j}"] [data-move]:not(:disabled)`)?.focus())
}
function remove(i: number) {
  set(items.value.filter((_, j) => j !== i))
}
function setCaption(i: number, caption: string) {
  set(items.value.map((item, j) => (j === i ? { ...item, caption } : item)))
}

const dragIndex = ref<number | null>(null)
function dragStart(i: number, e: DragEvent) {
  dragIndex.value = i
  e.dataTransfer!.effectAllowed = 'move'
  e.dataTransfer!.setData('text/plain', String(i))
}
function dragOver(i: number) {
  if (dragIndex.value === null || dragIndex.value === i) return
  move(dragIndex.value, i - dragIndex.value)
  dragIndex.value = i
}

const mediaOf = (item: Item): CmsMedia | undefined => byId(item.media)
const extension = (m: CmsMedia) => m.name.split('.').pop()?.toUpperCase() ?? 'FICHIER'
const summary = computed(() => {
  const n = items.value.length
  const parts = [n ? `${n} ${noun(n)}` : `Aucun${isImageField.value ? 'e' : ''} ${noun(1)}`]
  if (props.field.min != null && props.field.max != null) parts.push(`de ${props.field.min} à ${props.field.max}`)
  else if (props.field.max != null) parts.push(`${props.field.max} au maximum`)
  else if (props.field.min != null) parts.push(`${props.field.min} au minimum`)
  return parts.join(' · ')
})
</script>

<template>
  <div
    ref="root" class="cms-gallery rounded-field border p-2 transition"
    :class="[dropping ? 'border-primary bg-primary/5' : invalid ? 'border-error' : 'border-base-300']"
    @dragover.prevent="isFileDrag($event) && (dropping = true)" @dragleave.self="dropping = false" @drop.prevent="isFileDrag($event) && dropFiles($event.dataTransfer?.files)"
  >
    <ol v-if="items.length" class="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2" :aria-label="field.label">
      <li
        v-for="(item, i) in items" :key="keys[i]" :data-item="i"
        class="rounded-box border bg-base-100 overflow-hidden flex flex-col transition"
        :class="dragIndex === i ? 'opacity-40 border-primary' : isMissing(item) ? 'border-warning' : 'border-base-300'"
        @dragover.prevent="dragOver(i)"
      >
        <div
          class="group relative aspect-[4/3] bg-base-300 cursor-grab active:cursor-grabbing" draggable="true"
          :title="mediaOf(item)?.name" @dragstart="dragStart(i, $event)" @dragend="dragIndex = null"
        >
          <template v-if="mediaOf(item)">
            <img v-if="mediaOf(item)!.mime.startsWith('image/')" :src="cmsImageUrl(mediaOf(item)!, 320)" class="w-full h-full object-cover pointer-events-none" alt="">
            <div v-else class="w-full h-full grid place-items-center p-2 text-center">
              <span class="text-sm font-semibold text-base-content/60">{{ extension(mediaOf(item)!) }}</span>
            </div>
          </template>
          <div v-else-if="isMissing(item)" class="w-full h-full grid place-items-center p-2 text-center text-xs bg-warning/20">
            Ce fichier n'existe plus dans la médiathèque.
          </div>
          <span class="absolute top-1.5 left-1.5 badge badge-sm bg-base-100/90 border-0 gap-0.5 pl-1"><GripVertical :size="12" class="opacity-50" />{{ i + 1 }}</span>
          <div class="absolute top-1 right-1 flex gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 transition">
            <button
              type="button" class="btn btn-xs btn-square bg-base-100/90 border-0" data-move="before" :disabled="i === 0"
              :title="`Déplacer avant`" :aria-label="`Déplacer ${noun(1)} ${i + 1} avant`" @click="move(i, -1, true)"
            >
              <ChevronLeft :size="14" />
            </button>
            <button
              type="button" class="btn btn-xs btn-square bg-base-100/90 border-0" data-move="after" :disabled="i === items.length - 1"
              :title="`Déplacer après`" :aria-label="`Déplacer ${noun(1)} ${i + 1} après`" @click="move(i, 1, true)"
            >
              <ChevronRight :size="14" />
            </button>
            <button type="button" class="btn btn-xs btn-square bg-base-100/90 border-0 text-error" title="Retirer" :aria-label="`Retirer ${noun(1)} ${i + 1}`" @click="remove(i)">
              <X :size="14" />
            </button>
          </div>
          <span v-if="mediaOf(item) && !field.captions" class="absolute inset-x-0 bottom-0 px-1.5 py-1 text-xs text-white bg-gradient-to-t from-black/70 to-transparent truncate">{{ mediaOf(item)!.name }}</span>
        </div>
        <input
          v-if="field.captions" type="text" class="w-full px-2 py-1.5 text-sm bg-transparent border-t border-base-300 outline-none focus:bg-base-200/60 placeholder:text-base-content/40"
          :value="item.caption ?? ''" placeholder="Légende" :aria-label="`Légende de ${isImageField ? 'l\'image' : 'du fichier'} ${i + 1}`"
          @input="setCaption(i, ($event.target as HTMLInputElement).value)"
        >
      </li>
      <li v-if="!full">
        <button
          type="button" class="w-full h-full min-h-28 rounded-box border-2 border-dashed border-base-300 hover:border-primary hover:text-primary text-sm text-base-content/50 cursor-pointer flex flex-col items-center justify-center gap-1 p-2"
          @click="openPicker"
        >
          <Plus :size="18" />{{ isImageField ? 'Ajouter des images' : 'Ajouter des fichiers' }}
        </button>
      </li>
    </ol>

    <button
      v-else type="button"
      class="w-full h-24 rounded-box border-2 border-dashed border-base-300 hover:border-primary hover:text-primary text-sm text-base-content/50 cursor-pointer flex flex-col items-center justify-center gap-1"
      @click="openPicker"
    >
      <span class="flex items-center gap-1.5"><Plus :size="16" />{{ isImageField ? 'Ajouter des images' : 'Ajouter des fichiers' }}</span>
      <span class="text-xs">ou déposez-les ici</span>
    </button>

    <div class="flex items-center gap-2 px-1 pt-2 text-xs text-base-content/50">
      <span>{{ summary }}</span>
      <span v-if="uploading" class="flex items-center gap-1.5"><span class="loading loading-spinner loading-xs" />Import en cours…</span>
      <span v-else-if="items.length > 1" class="ml-auto hidden sm:inline">Glissez les vignettes pour changer l'ordre.</span>
    </div>

    <Teleport to="body">
      <!-- Hors de la page : la fenêtre reprend elle-même l'apparence du back-office. -->
      <div v-if="picking" class="cms-admin modal modal-open" data-theme="light" :style="useCmsAdminStyle().value">
        <div class="modal-box max-w-4xl">
          <h3 class="font-bold text-lg">{{ isImageField ? 'Ajouter des images' : 'Ajouter des fichiers' }}</h3>
          <p class="text-sm text-base-content/60 mb-4">
            Cliquez sur {{ isImageField ? 'les images' : 'les fichiers' }} dans l'ordre voulu, ou importez-en de nouve{{ isImageField ? 'lles' : 'aux' }}.
          </p>
          <div class="max-h-[60vh] overflow-y-auto p-1">
            <CmsMediaLibrary
              v-model:picked="picked" multiple :taken="items.map(i => i.media)" :limit="room"
              :images-only="isImageField" :accept="field.accept"
            />
          </div>
          <div class="modal-action items-center">
            <span v-if="picked.length" class="text-sm text-base-content/60 mr-auto">{{ picked.length }} sélectionné{{ isImageField ? 'e' : '' }}{{ picked.length > 1 ? 's' : '' }}</span>
            <button type="button" class="btn" @click="picking = false">Annuler</button>
            <button type="button" class="btn btn-primary" :disabled="!picked.length" @click="addPicked">
              {{ picked.length ? `Ajouter ${picked.length} ${noun(picked.length)}` : 'Ajouter' }}
            </button>
          </div>
        </div>
        <div class="modal-backdrop" @click="picking = false" />
      </div>
    </Teleport>
  </div>
</template>
