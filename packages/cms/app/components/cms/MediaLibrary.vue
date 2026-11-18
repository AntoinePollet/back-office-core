<script setup lang="ts">
import { Search, Upload } from '@lucide/vue'
import type { CmsMedia } from '../../composables/useCms'

/** Grille de la médiathèque avec import et recherche. Sert à la page Médiathèque et au choix d'un fichier dans un formulaire. */
const props = defineProps<{
  selectedId?: string | null
  /** N'affiche que les images. */
  imagesOnly?: boolean
  /** Types de fichiers acceptés (ex. ['application/pdf']). */
  accept?: readonly string[]
}>()
const emit = defineEmits<{ select: [media: CmsMedia] }>()

const { items, load, upload } = useCmsMedia()
const toast = useCmsToast()
const ready = ref(!!items.value)
onMounted(async () => { await load().catch(e => toast.error(cmsErrorMessage(e))); ready.value = true })

const search = ref('')
const dropping = ref(false)
const uploading = ref(0)
const input = ref<HTMLInputElement>()

const allowed = (mime: string) => (props.imagesOnly ? mime.startsWith('image/') : !props.accept?.length || props.accept.includes(mime))
const shown = computed(() => (items.value ?? []).filter(m => allowed(m.mime) && m.name.toLowerCase().includes(search.value.toLowerCase())))
const isImage = (m: CmsMedia) => m.mime.startsWith('image/')
const extension = (m: CmsMedia) => m.name.split('.').pop()?.toUpperCase() ?? 'FICHIER'

async function importFiles(files: FileList | File[] | null | undefined) {
  let last: CmsMedia | undefined
  for (const file of Array.from(files ?? [])) {
    uploading.value++
    try {
      last = await upload(file)
    }
    catch (e) {
      toast.error(`${file.name} : ${cmsErrorMessage(e, 'import impossible.')}`)
    }
    uploading.value--
  }
  if (last) {
    toast.success('Fichier importé. Pensez au texte alternatif.')
    if (allowed(last.mime)) emit('select', last)
  }
  if (input.value) input.value.value = ''
}
</script>

<template>
  <div>
    <div class="flex flex-wrap items-center gap-3 mb-3">
      <label class="input input-sm w-full sm:w-64"><Search :size="16" class="opacity-50" /><input v-model="search" type="search" class="grow" placeholder="Rechercher un fichier"></label>
      <span v-if="uploading" class="text-sm text-base-content/60 flex items-center gap-2"><span class="loading loading-spinner loading-xs" />Import en cours…</span>
      <button type="button" class="btn btn-sm btn-primary ml-auto" @click="input?.click()"><Upload :size="16" />Importer</button>
      <input ref="input" type="file" class="hidden" multiple :accept="imagesOnly ? 'image/*' : accept?.join(',')" @change="importFiles(($event.target as HTMLInputElement).files)">
    </div>

    <div
      class="rounded-box border-2 border-dashed p-4 mb-4 text-center text-sm transition"
      :class="dropping ? 'border-primary bg-primary/5 text-primary' : 'border-base-300 text-base-content/50'"
      @dragover.prevent="dropping = true" @dragleave="dropping = false" @drop.prevent="dropping = false; importFiles($event.dataTransfer?.files)"
    >
      Déposez vos fichiers ici (images ou PDF, 20 Mo au maximum).
    </div>

    <p v-if="!ready" class="text-center py-10"><span class="loading loading-spinner" /></p>
    <div v-else-if="shown.length" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
      <button
        v-for="m in shown" :key="m.id" type="button"
        class="group relative aspect-[4/3] rounded-box overflow-hidden bg-base-300 cursor-pointer ring-offset-2 ring-offset-base-100 hover:ring-2 ring-primary"
        :class="{ 'ring-2': selectedId === m.id }" :title="m.name" @click="emit('select', m)"
      >
        <img v-if="isImage(m)" :src="cmsImageUrl(m, 320)" class="w-full h-full object-cover" :alt="m.alt.fr ?? ''" loading="lazy">
        <span v-else class="w-full h-full grid place-items-center text-sm font-semibold text-base-content/60">{{ extension(m) }}</span>
        <span v-if="isImage(m) && !Object.values(m.alt).some(Boolean)" class="absolute top-1.5 left-1.5 badge badge-xs badge-warning" title="Texte alternatif manquant">alt</span>
        <span class="absolute inset-x-0 bottom-0 p-1.5 text-xs text-left text-white bg-gradient-to-t from-black/70 to-transparent truncate opacity-0 group-hover:opacity-100 transition">{{ m.name }}</span>
      </button>
    </div>
    <p v-else class="text-center text-sm text-base-content/50 py-10">
      {{ items?.length ? 'Aucun fichier ne correspond.' : 'La médiathèque est vide. Importez un premier fichier.' }}
    </p>
  </div>
</template>
