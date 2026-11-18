<script setup lang="ts">
import type { CmsMedia } from '../../composables/useCms'

/** Champ image ou fichier : la valeur est l'identifiant d'un fichier de la médiathèque. */
const props = defineProps<{ field: Record<string, any>; modelValue?: string | null; invalid?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string | null] }>()

const { load, byId } = useCmsMedia()
const picking = ref(false)
const isImageField = computed(() => props.field.type === 'image')
const current = computed(() => byId(props.modelValue))
// Valeur présente mais fichier absent de la médiathèque : il a été supprimé.
const missing = computed(() => !!props.modelValue && !current.value)

onMounted(() => { if (props.modelValue) load() })

function pick(media: CmsMedia) {
  emit('update:modelValue', media.id)
  picking.value = false
}
</script>

<template>
  <div>
    <div v-if="current" class="flex items-center gap-3 border rounded-field p-2" :class="invalid ? 'border-error' : 'border-base-300'">
      <div class="w-24 h-16 rounded-field bg-base-300 overflow-hidden shrink-0 grid place-items-center">
        <img v-if="current.mime.startsWith('image/')" :src="cmsImageUrl(current, 320)" class="w-full h-full object-cover" alt="">
        <span v-else class="text-xs font-semibold text-base-content/60">{{ current.name.split('.').pop()?.toUpperCase() }}</span>
      </div>
      <div class="min-w-0 grow text-sm">
        <div class="font-medium truncate">{{ current.name }}</div>
        <div class="text-xs text-base-content/50">
          <template v-if="current.width">{{ current.width }} × {{ current.height }} px · </template>{{ formatFileSize(current.size) }}
        </div>
      </div>
      <button type="button" class="btn btn-sm" @click="picking = true">Remplacer</button>
      <button type="button" class="btn btn-sm btn-ghost text-error" @click="emit('update:modelValue', null)">Retirer</button>
    </div>

    <div v-else-if="missing" class="flex items-center gap-3 border border-warning rounded-field p-2 text-sm">
      <span class="grow">Ce fichier n'existe plus dans la médiathèque.</span>
      <button type="button" class="btn btn-sm" @click="picking = true">Choisir un autre</button>
      <button type="button" class="btn btn-sm btn-ghost" @click="emit('update:modelValue', null)">Retirer</button>
    </div>

    <button
      v-else type="button"
      class="w-full h-20 rounded-field border-2 border-dashed hover:border-primary hover:text-primary text-sm text-base-content/50 cursor-pointer"
      :class="invalid ? 'border-error' : 'border-base-300'" @click="picking = true"
    >
      {{ isImageField ? 'Choisir une image' : 'Choisir un fichier' }}
    </button>

    <Teleport to="body">
    <!-- Hors de la page : la fenêtre reprend elle-même l'apparence du back-office. -->
    <div v-if="picking" class="cms-admin modal modal-open" data-theme="light" :style="useCmsAdminStyle().value">
      <div class="modal-box max-w-4xl">
        <h3 class="font-bold text-lg mb-4">{{ isImageField ? 'Choisir une image' : 'Choisir un fichier' }}</h3>
        <div class="max-h-[60vh] overflow-y-auto p-1">
          <CmsMediaLibrary :selected-id="modelValue" :images-only="isImageField" :accept="field.accept" @select="pick" />
        </div>
        <div class="modal-action"><button type="button" class="btn" @click="picking = false">Annuler</button></div>
      </div>
      <div class="modal-backdrop" @click="picking = false" />
    </div>
    </Teleport>
  </div>
</template>
