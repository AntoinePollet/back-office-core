<script setup lang="ts">
import { Check, Folder, FolderInput, FolderPlus, Images, Pencil, Search, Trash2, Upload, X } from '@lucide/vue'
import type { CmsMedia, CmsMediaFolder } from '../../composables/useCms'
import { FOLDER_NAME_MAX, MEDIA_ROOT_LABEL, folderLabel, folderPath } from '../../../shared/media-folders'

/**
 * Médiathèque : dossiers, grille, recherche et import. Sert à la page Médiathèque (`manage` : ranger les fichiers)
 * et au choix d'un fichier dans un formulaire (navigation et envoi dans le dossier affiché seulement).
 */
const props = defineProps<{
  selectedId?: string | null
  /** N'affiche que les images. */
  imagesOnly?: boolean
  /** Types de fichiers acceptés (ex. ['application/pdf']). */
  accept?: readonly string[]
  /** Sélection de plusieurs fichiers (galerie) : un clic coche ou décoche, `picked` garde l'ordre des clics. */
  multiple?: boolean
  picked?: string[]
  /** Fichiers déjà dans la galerie : affichés, mais pas sélectionnables une seconde fois. */
  taken?: string[]
  /** Nombre maximal de fichiers sélectionnables (place restante dans la galerie). */
  limit?: number
  /** Page Médiathèque : dossiers à créer, renommer, supprimer ; fichiers à cocher et à déplacer. */
  manage?: boolean
}>()
const emit = defineEmits<{ select: [media: CmsMedia]; 'update:picked': [ids: string[]] }>()

const { items, load, upload } = useCmsMedia()
const media = useCmsMediaFolders()
const { folders, current } = media
const toast = useCmsToast()
const ready = ref(!!items.value && !!folders.value)
onMounted(async () => {
  await Promise.all([load(), media.load()]).catch(e => toast.error(cmsErrorMessage(e)))
  ready.value = true
})
/** Ranger (dossiers, déplacements) : page Médiathèque, et droit de gérer la médiathèque. Le serveur fait foi. */
const canOrganize = computed(() => !!props.manage && useCmsUser().value?.organizeMedia !== false)

const search = ref('')
const dropping = ref(false)
const uploading = ref(0)
const input = ref<HTMLInputElement>()

const allowed = (mime: string) => (props.imagesOnly ? mime.startsWith('image/') : !props.accept?.length || props.accept.includes(mime))
const all = computed(() => folders.value ?? [])
const searching = computed(() => !!search.value.trim())
const needle = computed(() => search.value.trim().toLocaleLowerCase('fr'))
const here = computed(() => current.value ?? null)
const path = computed(() => folderPath(all.value, here.value))
const currentName = computed(() => path.value.at(-1)?.name ?? MEDIA_ROOT_LABEL)
const byName = (a: CmsMediaFolder, b: CmsMediaFolder) => a.name.localeCompare(b.name, 'fr', { numeric: true })

/** Dossiers affichés : ceux du dossier ouvert, ou ceux dont le nom correspond à la recherche (partout). */
const shownFolders = computed(() => (searching.value
  ? all.value.filter(f => f.name.toLocaleLowerCase('fr').includes(needle.value))
  : all.value.filter(f => (f.parentId ?? null) === here.value)).sort(byName))
/** Fichiers affichés : ceux du dossier ouvert, ou ceux dont le nom correspond à la recherche, dans tous les dossiers. */
const shown = computed(() => (items.value ?? []).filter(m => allowed(m.mime) && (searching.value
  ? m.name.toLocaleLowerCase('fr').includes(needle.value)
  : (m.folderId ?? null) === here.value)))
const fileCount = (id: string) => (items.value ?? []).filter(m => m.folderId === id && allowed(m.mime)).length
const subCount = (id: string) => all.value.filter(f => f.parentId === id).length
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`
function folderSummary(id: string) {
  const files = fileCount(id), subs = subCount(id)
  if (!files && !subs) return 'Vide'
  return [subs ? plural(subs, 'dossier', 'dossiers') : '', files ? plural(files, 'fichier', 'fichiers') : ''].filter(Boolean).join(' · ')
}
const where = (m: CmsMedia) => folderLabel(all.value, m.folderId)

function open(id: string | null) {
  media.open(id)
  search.value = ''
  checked.value = []
}

// ───── Choix d'un fichier ─────
const isImage = (m: CmsMedia) => m.mime.startsWith('image/')
const isTaken = (m: CmsMedia) => !!props.taken?.includes(m.id)
const rank = (m: CmsMedia) => (props.picked ?? []).indexOf(m.id) + 1
const full = () => props.limit != null && (props.picked?.length ?? 0) >= props.limit

/** Clic sur un fichier : choisi tout de suite, ou coché/décoché en sélection multiple. */
function choose(m: CmsMedia) {
  if (!props.multiple) return emit('select', m)
  if (isTaken(m)) return
  const picked = props.picked ?? []
  if (picked.includes(m.id)) emit('update:picked', picked.filter(id => id !== m.id))
  else if (full()) toast.error(`${props.limit} fichier${props.limit! > 1 ? 's' : ''} au plus peuvent encore être ajoutés.`)
  else emit('update:picked', [...picked, m.id])
}
const extension = (m: CmsMedia) => m.name.split('.').pop()?.toUpperCase() ?? 'FICHIER'

// ───── Import : dans le dossier affiché ─────
async function importFiles(files: FileList | File[] | null | undefined) {
  let last: CmsMedia | undefined
  const added: string[] = []
  // Sélection au départ : `props.picked` est mis à jour entre deux envois, on ne doit pas l'ajouter deux fois.
  const before = props.picked ?? []
  // Pendant une recherche, on importe tout de même dans le dossier ouvert.
  const folderId = here.value
  for (const file of Array.from(files ?? [])) {
    uploading.value++
    try {
      last = await upload(file, folderId)
      // En sélection multiple, chaque fichier importé est coché, dans l'ordre d'import, tant qu'il reste de la place.
      if (props.multiple && allowed(last.mime) && (props.limit == null || before.length + added.length < props.limit)) {
        added.push(last.id)
        emit('update:picked', [...before, ...added])
      }
    }
    catch (e) {
      toast.error(`${file.name} : ${cmsErrorMessage(e, 'import impossible.')}`)
    }
    uploading.value--
  }
  if (last) {
    const into = folderId ? ` dans « ${currentName.value} »` : ''
    toast.success(props.multiple && added.length > 1 ? `${added.length} fichiers importés${into} et sélectionnés. Pensez au texte alternatif.` : `Fichier importé${into}. Pensez au texte alternatif.`)
    if (!props.multiple && allowed(last.mime)) emit('select', last)
  }
  if (input.value) input.value.value = ''
}
const isFileDrag = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files')

// ───── Fichiers cochés (page Médiathèque) ─────
const checked = ref<string[]>([])
const isChecked = (m: CmsMedia) => checked.value.includes(m.id)
function toggle(m: CmsMedia) {
  checked.value = isChecked(m) ? checked.value.filter(id => id !== m.id) : [...checked.value, m.id]
}
// Un fichier supprimé ne reste pas coché.
watch(items, list => { checked.value = checked.value.filter(id => list?.some(m => m.id === id)) })

// ───── Déplacer : fenêtre « Déplacer vers… » ou glisser-déposer ─────
const moving = ref<{ files: string[] } | { folder: CmsMediaFolder } | null>(null)
const movingWhat = computed(() => {
  const m = moving.value
  if (!m) return ''
  return 'folder' in m ? `le dossier « ${m.folder.name} »` : m.files.length > 1 ? `${m.files.length} fichiers` : `« ${items.value?.find(i => i.id === m.files[0])?.name ?? 'le fichier'} »`
})
const movingFrom = computed(() => {
  const m = moving.value
  if (!m) return null
  if ('folder' in m) return m.folder.parentId
  const places = new Set(m.files.map(id => items.value?.find(i => i.id === id)?.folderId ?? null))
  return places.size === 1 ? [...places][0]! : '' // '' : plusieurs emplacements, aucun n'est « actuel »
})

async function moveFiles(ids: string[], folderId: string | null) {
  try {
    await media.moveFiles(ids, folderId)
    checked.value = checked.value.filter(id => !ids.includes(id))
    toast.success(`${ids.length > 1 ? `${ids.length} fichiers déplacés` : 'Fichier déplacé'} dans « ${folderLabel(all.value, folderId)} »`)
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
}
async function moveFolder(folder: CmsMediaFolder, parentId: string | null) {
  try {
    await media.update(folder.id, { parentId })
    toast.success(`Dossier « ${folder.name} » déplacé dans « ${folderLabel(all.value, parentId)} »`)
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
}
async function moveTo(folderId: string | null) {
  const m = moving.value
  moving.value = null
  if (!m) return
  if ('folder' in m) await moveFolder(m.folder, folderId)
  else await moveFiles(m.files, folderId)
}
/** Déplacer un fichier précis (bouton du panneau de détails de la page Médiathèque). */
function askMove(ids: string[]) { moving.value = { files: ids } }
defineExpose({ askMove })

const FILES = 'application/x-cms-media'
const FOLDER = 'application/x-cms-folder'
const dropTarget = ref<string | null | undefined>(undefined)
function dragFile(m: CmsMedia, e: DragEvent) {
  // Un fichier coché emporte tous les fichiers cochés avec lui.
  const ids = isChecked(m) ? checked.value : [m.id]
  e.dataTransfer!.effectAllowed = 'move'
  e.dataTransfer!.setData(FILES, JSON.stringify(ids))
  e.dataTransfer!.setData('text/plain', ids.length > 1 ? `${ids.length} fichiers` : m.name)
}
function dragFolder(f: CmsMediaFolder, e: DragEvent) {
  e.dataTransfer!.effectAllowed = 'move'
  e.dataTransfer!.setData(FOLDER, f.id)
  e.dataTransfer!.setData('text/plain', f.name)
}
const isMoveDrag = (e: DragEvent) => canOrganize.value && !!e.dataTransfer && (e.dataTransfer.types.includes(FILES) || e.dataTransfer.types.includes(FOLDER))
function dragOver(target: string | null, e: DragEvent) {
  if (!isMoveDrag(e)) return
  e.preventDefault()
  e.dataTransfer!.dropEffect = 'move'
  dropTarget.value = target
}
async function drop(target: string | null, e: DragEvent) {
  dropTarget.value = undefined
  if (!isMoveDrag(e)) return
  e.preventDefault()
  const files = e.dataTransfer!.getData(FILES)
  const folderId = e.dataTransfer!.getData(FOLDER)
  if (files) {
    const ids = (JSON.parse(files) as string[]).filter(id => (items.value?.find(m => m.id === id)?.folderId ?? null) !== target)
    if (ids.length) await moveFiles(ids, target)
  }
  else if (folderId && folderId !== target) {
    const folder = all.value.find(f => f.id === folderId)
    if (folder && (folder.parentId ?? null) !== target) await moveFolder(folder, target)
  }
}

// ───── Créer, renommer, supprimer un dossier ─────
const naming = ref<{ id: string | null; name: string } | null>(null)
const nameInput = ref<HTMLInputElement>()
function askName(folder: CmsMediaFolder | null) {
  naming.value = { id: folder?.id ?? null, name: folder?.name ?? '' }
  nextTick(() => { nameInput.value?.focus(); nameInput.value?.select() })
}
async function saveName() {
  const n = naming.value
  if (!n) return
  try {
    if (n.id) {
      const folder = await media.update(n.id, { name: n.name })
      toast.success(`Dossier renommé « ${folder.name} »`)
    }
    else {
      const folder = await media.create(n.name, here.value)
      toast.success(`Dossier « ${folder.name} » créé`)
    }
    naming.value = null
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
}
const currentFolder = computed(() => path.value.at(-1) ?? null)
async function removeFolder() {
  const folder = currentFolder.value
  if (!folder) return
  const files = (items.value ?? []).filter(m => m.folderId === folder.id).length
  const subs = subCount(folder.id)
  const parent = folderLabel(all.value, folder.parentId)
  const content = [subs ? plural(subs, 'dossier', 'dossiers') : '', files ? plural(files, 'fichier', 'fichiers') : ''].filter(Boolean).join(' et ')
  const question = content
    ? `Le dossier « ${folder.name} » contient ${content}. Aucun fichier ne sera supprimé : ${files + subs > 1 ? 'ils remonteront' : 'il remontera'} dans « ${parent} ». Supprimer le dossier ?`
    : `Supprimer le dossier vide « ${folder.name} » ?`
  if (!confirm(question)) return
  try {
    await media.remove(folder.id, !!content)
    search.value = ''
    checked.value = []
    toast.success(content ? `Dossier supprimé ; son contenu est dans « ${parent} »` : 'Dossier supprimé')
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
}
</script>

<template>
  <div class="cms-media-library">
    <!-- Emplacement : fil d'Ariane. Chaque niveau reçoit aussi les fichiers glissés dessus. -->
    <div class="flex flex-wrap items-center gap-x-3 gap-y-2 mb-3">
      <nav class="breadcrumbs text-sm py-0 min-w-0 grow" aria-label="Emplacement dans la médiathèque">
        <ul>
          <li>
            <button
              type="button" class="inline-flex items-center gap-1.5 rounded px-1 -mx-1 hover:underline" :class="{ 'font-semibold': !here && !searching, 'bg-primary/15 ring-2 ring-primary': dropTarget === null }"
              :aria-current="!here && !searching ? 'location' : undefined" data-crumb=""
              @click="open(null)" @dragover="dragOver(null, $event)" @dragleave="dropTarget = undefined" @drop="drop(null, $event)"
            >
              <Images :size="16" class="opacity-60" />{{ MEDIA_ROOT_LABEL }}
            </button>
          </li>
          <li v-for="(f, i) in path" :key="f.id">
            <button
              type="button" class="rounded px-1 -mx-1 hover:underline truncate max-w-48" :class="{ 'font-semibold': i === path.length - 1 && !searching, 'bg-primary/15 ring-2 ring-primary': dropTarget === f.id }"
              :aria-current="i === path.length - 1 && !searching ? 'location' : undefined" :data-crumb="f.id"
              @click="open(f.id)" @dragover="dragOver(f.id, $event)" @dragleave="dropTarget = undefined" @drop="drop(f.id, $event)"
            >
              {{ f.name }}
            </button>
          </li>
        </ul>
      </nav>
      <div v-if="canOrganize && currentFolder && !searching" class="flex flex-wrap gap-1" data-folder-actions>
        <button type="button" class="btn btn-xs btn-ghost" @click="askName(currentFolder)"><Pencil :size="14" />Renommer</button>
        <button type="button" class="btn btn-xs btn-ghost" @click="moving = { folder: currentFolder }"><FolderInput :size="14" />Déplacer</button>
        <button type="button" class="btn btn-xs btn-ghost text-error" @click="removeFolder"><Trash2 :size="14" />Supprimer le dossier</button>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2 mb-3">
      <label class="input input-sm w-full sm:w-72">
        <Search :size="16" class="opacity-50" />
        <input v-model="search" type="search" class="grow" placeholder="Rechercher dans toute la médiathèque" aria-label="Rechercher un fichier dans toute la médiathèque">
      </label>
      <span v-if="uploading" class="text-sm text-base-content/60 flex items-center gap-2"><span class="loading loading-spinner loading-xs" />Import en cours…</span>
      <div class="flex gap-2 ml-auto">
        <button v-if="canOrganize" type="button" class="btn btn-sm" @click="askName(null)"><FolderPlus :size="16" />Nouveau dossier</button>
        <button type="button" class="btn btn-sm btn-primary" @click="input?.click()"><Upload :size="16" />Importer</button>
      </div>
      <input ref="input" type="file" class="hidden" multiple :accept="imagesOnly ? 'image/*' : accept?.join(',')" @change="importFiles(($event.target as HTMLInputElement).files)">
    </div>

    <div
      class="rounded-box border-2 border-dashed p-3 mb-4 text-center text-sm transition"
      :class="dropping ? 'border-primary bg-primary/5 text-primary' : 'border-base-300 text-base-content/50'"
      @dragover.prevent="isFileDrag($event) && (dropping = true)" @dragleave="dropping = false" @drop.prevent="dropping = false; isFileDrag($event) && importFiles($event.dataTransfer?.files)"
    >
      Déposez vos fichiers ici<template v-if="here"> : ils seront rangés dans « {{ currentName }} »</template> (images ou PDF, 20 Mo au maximum).
    </div>

    <!-- Fichiers cochés : actions groupées. -->
    <div v-if="canOrganize && checked.length" class="flex flex-wrap items-center gap-2 mb-3 rounded-box bg-primary/10 px-3 py-2 text-sm" data-selection>
      <span class="font-medium">{{ checked.length }} fichier{{ checked.length > 1 ? 's' : '' }} sélectionné{{ checked.length > 1 ? 's' : '' }}</span>
      <span class="hidden sm:inline text-base-content/60">· glissez-{{ checked.length > 1 ? 'les' : 'le' }} sur un dossier, ou</span>
      <button type="button" class="btn btn-xs btn-primary" @click="moving = { files: [...checked] }"><FolderInput :size="14" />Déplacer vers…</button>
      <button type="button" class="btn btn-xs btn-ghost ml-auto" @click="checked = []"><X :size="14" />Désélectionner</button>
    </div>

    <p v-if="searching && ready" class="text-sm text-base-content/60 mb-2">
      {{ plural(shown.length, 'fichier trouvé', 'fichiers trouvés') }} dans toute la médiathèque<template v-if="shownFolders.length">, {{ plural(shownFolders.length, 'dossier', 'dossiers') }}</template>.
    </p>

    <p v-if="!ready" class="text-center py-10"><span class="loading loading-spinner" /></p>
    <div v-else-if="shown.length || shownFolders.length" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
      <!-- Dossiers -->
      <button
        v-for="f in shownFolders" :key="f.id" type="button" :data-media-folder="f.id" :draggable="canOrganize"
        class="relative aspect-[4/3] rounded-box border border-base-300 bg-base-200/60 hover:bg-base-200 hover:border-primary cursor-pointer flex flex-col items-center justify-center gap-1 p-2 text-center transition"
        :class="{ 'ring-2 ring-primary ring-offset-2 ring-offset-base-100 bg-primary/10': dropTarget === f.id }"
        :title="`Ouvrir le dossier « ${f.name} »`"
        @click="open(f.id)" @dragstart="dragFolder(f, $event)" @dragover="dragOver(f.id, $event)" @dragleave="dropTarget = undefined" @drop="drop(f.id, $event)"
      >
        <Folder :size="36" class="text-primary/70" fill="currentColor" fill-opacity="0.15" />
        <span class="text-sm font-medium leading-tight line-clamp-2 break-words">{{ f.name }}</span>
        <span class="text-xs text-base-content/50">{{ searching ? `dans ${folderLabel(all, f.parentId)}` : folderSummary(f.id) }}</span>
      </button>

      <!-- Fichiers -->
      <div v-for="m in shown" :key="m.id" class="min-w-0" :data-media="m.id">
        <div class="group relative aspect-[4/3]">
          <button
            type="button" :draggable="canOrganize"
            class="relative w-full h-full rounded-box overflow-hidden bg-base-300 cursor-pointer ring-offset-2 ring-offset-base-100 hover:ring-2 ring-primary"
            :class="{ 'ring-2': selectedId === m.id || rank(m) || isChecked(m), 'opacity-50 cursor-not-allowed hover:ring-0': multiple && isTaken(m) }"
            :title="m.name" :aria-pressed="multiple ? !!rank(m) : undefined" :aria-disabled="multiple && isTaken(m) ? true : undefined"
            @click="choose(m)" @dragstart="dragFile(m, $event)"
          >
            <img v-if="isImage(m)" :src="cmsImageUrl(m, 320)" class="w-full h-full object-cover pointer-events-none" :alt="m.alt.fr ?? ''" loading="lazy">
            <span v-else class="w-full h-full grid place-items-center text-sm font-semibold text-base-content/60">{{ extension(m) }}</span>
            <span v-if="isImage(m) && !Object.values(m.alt).some(Boolean)" class="absolute top-1.5 left-1.5 badge badge-xs badge-warning" title="Texte alternatif manquant">alt</span>
            <span v-if="rank(m)" class="absolute top-1.5 right-1.5 badge badge-sm badge-primary font-semibold" :aria-label="`Sélectionné en position ${rank(m)}`">{{ rank(m) }}</span>
            <span v-else-if="multiple && isTaken(m)" class="absolute top-1.5 right-1.5 badge badge-sm bg-base-100/90 border-0 gap-1"><Check :size="12" />Déjà ajouté</span>
            <span v-if="!searching" class="absolute inset-x-0 bottom-0 p-1.5 text-xs text-left text-white bg-gradient-to-t from-black/70 to-transparent truncate opacity-0 group-hover:opacity-100 transition">{{ m.name }}</span>
          </button>
          <!-- Case à cocher : visible au survol, au clavier, sur écran tactile, et dès qu'un fichier est coché. -->
          <label
            v-if="canOrganize"
            class="absolute top-1 right-1 p-1 rounded-field bg-base-100/90 cursor-pointer transition"
            :class="checked.length || isChecked(m) ? 'opacity-100' : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100'"
          >
            <input type="checkbox" class="checkbox checkbox-sm checkbox-primary" :checked="isChecked(m)" :aria-label="`Sélectionner ${m.name}`" @change="toggle(m)">
          </label>
        </div>
        <div v-if="searching" class="px-0.5 pt-1 text-xs min-w-0">
          <div class="truncate font-medium" :title="m.name">{{ m.name }}</div>
          <button type="button" class="flex items-center gap-1 max-w-full text-base-content/60 hover:text-primary hover:underline" :title="`Ouvrir « ${where(m)} »`" data-where @click="open(m.folderId)">
            <component :is="m.folderId ? Folder : Images" :size="12" class="shrink-0" /><span class="truncate">{{ where(m) }}</span>
          </button>
        </div>
      </div>
    </div>
    <p v-else class="text-center text-sm text-base-content/50 py-10">
      <template v-if="searching">Aucun fichier ne correspond, dans aucun dossier.</template>
      <template v-else-if="here">Ce dossier est vide. Déposez-y des fichiers ou importez-en.</template>
      <template v-else>{{ items?.length ? 'Aucun fichier à la racine.' : 'La médiathèque est vide. Importez un premier fichier.' }}</template>
    </p>

    <CmsMediaMoveDialog
      v-if="moving" :what="movingWhat" :from="movingFrom" :folder-id="'folder' in moving ? moving.folder.id : undefined"
      @move="moveTo" @close="moving = null"
    />

    <div v-if="naming" class="modal modal-open" data-cms-folder-name>
      <form class="modal-box max-w-sm" @submit.prevent="saveName">
        <h3 class="font-bold text-lg mb-3">{{ naming.id ? 'Renommer le dossier' : 'Nouveau dossier' }}</h3>
        <p v-if="!naming.id" class="text-sm text-base-content/60 mb-2">Il sera créé dans « {{ currentName }} ».</p>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Nom du dossier</legend>
          <input ref="nameInput" v-model="naming.name" type="text" class="input w-full" :maxlength="FOLDER_NAME_MAX" placeholder="Ex. : Chantiers 2026" required>
        </fieldset>
        <div class="modal-action">
          <button type="button" class="btn" @click="naming = null">Annuler</button>
          <button type="submit" class="btn btn-primary">{{ naming.id ? 'Renommer' : 'Créer' }}</button>
        </div>
      </form>
      <div class="modal-backdrop" @click="naming = null" />
    </div>
  </div>
</template>
