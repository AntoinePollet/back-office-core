<script setup lang="ts">
import { Folder, FolderOpen, Images } from '@lucide/vue'
import { MEDIA_ROOT_LABEL, checkFolderMove, folderTree } from '../../../shared/media-folders'

/**
 * Fenêtre « Déplacer vers… » : choix d'un dossier dans l'arbre de la médiathèque, au clavier comme au doigt.
 * Sert aux fichiers (un ou plusieurs) et au dossier ouvert (`folderId` : ses sous-dossiers ne sont pas proposés).
 */
const props = defineProps<{
  /** Ce qui est déplacé, pour le titre : « 3 fichiers », « le dossier « Isolation » ». */
  what: string
  /** Emplacement actuel (null : la racine). Proposé, mais sans effet. */
  from: string | null
  /** Dossier déplacé, le cas échéant. */
  folderId?: string
}>()
const emit = defineEmits<{ move: [folderId: string | null]; close: [] }>()

const { folders } = useCmsMediaFolders()
const target = ref<string | null | undefined>(undefined)
const rows = computed(() => folderTree(folders.value ?? []))
/** Raison pour laquelle un dossier ne peut pas recevoir le dossier déplacé (null : il peut). */
const refusal = (id: string | null) => (props.folderId ? checkFolderMove(folders.value ?? [], props.folderId, id) : null)
const disabled = (id: string | null) => id === props.from || !!refusal(id)
const box = ref<HTMLElement>()
onMounted(() => box.value?.querySelector<HTMLElement>('[data-folder]:not(:disabled)')?.focus())
</script>

<template>
  <div class="modal modal-open" data-cms-move @keydown.esc="emit('close')">
    <div ref="box" class="modal-box max-w-md">
      <h3 class="font-bold text-lg">Déplacer {{ what }}</h3>
      <p class="text-sm text-base-content/60 mb-3">Choisissez le dossier de destination. Les adresses des fichiers ne changent pas : les pages du site continuent de les afficher.</p>
      <ul class="menu w-full p-0 max-h-[50vh] overflow-y-auto flex-nowrap" role="listbox" aria-label="Dossiers">
        <li>
          <button
            type="button" data-folder="" role="option" :aria-selected="target === null" :disabled="disabled(null)"
            :class="{ 'menu-active': target === null }" @click="target = null" @dblclick="!disabled(null) && emit('move', null)"
          >
            <Images :size="16" />{{ MEDIA_ROOT_LABEL }}
            <span v-if="from === null" class="ml-auto text-xs opacity-60">emplacement actuel</span>
          </button>
        </li>
        <li v-for="{ folder, depth } in rows" :key="folder.id">
          <button
            type="button" :data-folder="folder.id" role="option" :aria-selected="target === folder.id" :disabled="disabled(folder.id)"
            :title="refusal(folder.id) ?? undefined" :style="{ paddingLeft: `${0.75 + depth}rem` }"
            :class="{ 'menu-active': target === folder.id }" @click="target = folder.id" @dblclick="!disabled(folder.id) && emit('move', folder.id)"
          >
            <component :is="target === folder.id ? FolderOpen : Folder" :size="16" class="shrink-0" /><span class="truncate">{{ folder.name }}</span>
            <span v-if="from === folder.id" class="ml-auto text-xs opacity-60 shrink-0">emplacement actuel</span>
            <span v-else-if="folder.id === folderId" class="ml-auto text-xs opacity-60 shrink-0">dossier déplacé</span>
          </button>
        </li>
      </ul>
      <div class="modal-action">
        <button type="button" class="btn" @click="emit('close')">Annuler</button>
        <button type="button" class="btn btn-primary" :disabled="target === undefined" @click="emit('move', target!)">Déplacer ici</button>
      </div>
    </div>
    <div class="modal-backdrop" @click="emit('close')" />
  </div>
</template>
