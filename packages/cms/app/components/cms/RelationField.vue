<script setup lang="ts">
/** Champ relation : la valeur est l'identifiant d'un contenu d'une autre collection, ou un tableau si `multiple`. */
const props = defineProps<{ field: Record<string, any>; modelValue?: string | string[] | null; invalid?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string | string[] | null] }>()

const { cache, load } = useCmsOptions()
const loaded = ref(false)
onMounted(async () => { await load(props.field.to).catch(() => {}); loaded.value = true })

const options = computed(() => cache.value[props.field.to] ?? [])
const chosen = computed<string[]>(() => (Array.isArray(props.modelValue) ? props.modelValue : props.modelValue ? [props.modelValue] : []))
// Identifiants enregistrés dont le contenu a été supprimé depuis.
const orphans = computed(() => (loaded.value ? chosen.value.filter(id => !options.value.some(o => o.id === id)) : []))

function toggle(id: string) {
  // L'ordre de sélection est conservé : c'est l'ordre d'affichage sur le site.
  emit('update:modelValue', chosen.value.includes(id) ? chosen.value.filter(x => x !== id) : [...chosen.value, id])
}
</script>

<template>
  <div>
    <p v-if="loaded && !options.length" class="text-sm text-base-content/50 border border-dashed border-base-300 rounded-field px-3 py-2">
      Aucun contenu à choisir pour l'instant.
      <NuxtLink :to="`/admin/${field.to}/new`" target="_blank" class="link">En créer un</NuxtLink>
    </p>

    <div v-else-if="field.multiple" class="border rounded-field max-h-56 overflow-y-auto p-2 space-y-1" :class="invalid ? 'border-error' : 'border-base-300'">
      <label v-for="o in options" :key="o.id" class="flex items-center gap-2 cursor-pointer text-sm px-1 py-0.5 rounded hover:bg-base-200">
        <input type="checkbox" class="checkbox checkbox-sm" :checked="chosen.includes(o.id)" @change="toggle(o.id)">
        <span class="truncate">{{ o.title }}</span>
        <span v-if="chosen.includes(o.id)" class="ml-auto text-xs text-base-content/40">{{ chosen.indexOf(o.id) + 1 }}</span>
      </label>
    </div>

    <select
      v-else class="select w-full" :class="{ 'select-error': invalid }" :value="chosen[0] ?? ''"
      @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value || null)"
    >
      <option value="">Aucun</option>
      <option v-for="o in options" :key="o.id" :value="o.id">{{ o.title }}</option>
    </select>

    <p v-if="orphans.length" class="label text-warning">
      {{ orphans.length > 1 ? `${orphans.length} contenus sélectionnés n'existent plus.` : 'Le contenu sélectionné n\'existe plus.' }}
      <button type="button" class="link" @click="emit('update:modelValue', field.multiple ? chosen.filter(id => !orphans.includes(id)) : null)">Retirer</button>
    </p>
  </div>
</template>
