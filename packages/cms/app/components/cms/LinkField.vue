<script setup lang="ts">
import type { LinkValue } from '../../../shared/content'
import type { CmsConfig } from '../../../shared/format'

/**
 * Champ lien : vers une page du site ou une adresse libre.
 * Tant que la cible n'est pas choisie, la valeur est null ; le texte saisi reste affiché.
 */
const props = defineProps<{ modelValue?: LinkValue | null; invalid?: boolean; /** Seulement la cible : ni texte du lien, ni « nouvel onglet » (destination d'une redirection). */ targetOnly?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: LinkValue | null] }>()

// Le schéma est déjà chargé par la mise en page : lecture directe, sans attente.
const schema = useState<CmsConfig>('cms-schema')
const { cache, load } = useCmsOptions()

// Seuls les contenus qui ont une adresse publique peuvent être la cible d'un lien.
const pageTypes = computed(() => [
  ...Object.entries(schema.value.singletons ?? {}).filter(([, d]) => d.path).map(([key, d]) => ({ key, label: d.label, single: true })),
  ...Object.entries(schema.value.collections ?? {}).filter(([, d]) => d.path).map(([key, d]) => ({ key, label: d.label, single: false })),
])

const blank = () => ({ kind: 'page' as 'page' | 'url', type: '', id: '', url: '', label: '', newTab: false })
const draft = reactive(blank())

function toValue(): LinkValue | null {
  const common = { label: draft.label.trim() || undefined, newTab: draft.newTab || undefined }
  if (draft.kind === 'url') return draft.url.trim() ? { kind: 'url', url: draft.url.trim(), ...common } : null
  return draft.type && draft.id ? { kind: 'page', type: draft.type, id: draft.id, ...common } : null
}
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

// Valeur venue de l'extérieur (chargement, copie depuis une autre langue).
watch(() => props.modelValue, (value) => {
  if (same(value, toValue())) return
  Object.assign(draft, blank(), value ?? {})
}, { immediate: true })

watch(draft, () => { if (!same(props.modelValue, toValue())) emit('update:modelValue', toValue()) })

const currentType = computed(() => pageTypes.value.find(t => t.key === draft.type))
watch(() => draft.type, async (type) => {
  const found = pageTypes.value.find(t => t.key === type)
  if (!found) return
  if (found.single) draft.id = type // un singleton est désigné par son propre identifiant
  else {
    await load(type).catch(() => {})
    if (!cache.value[type]?.some(o => o.id === draft.id)) draft.id = ''
  }
}, { immediate: true })
</script>

<template>
  <div class="border rounded-field p-3 space-y-3" :class="invalid ? 'border-error' : 'border-base-300'">
    <div class="flex flex-wrap gap-x-5 gap-y-1 text-sm">
      <label class="flex items-center gap-2 cursor-pointer"><input v-model="draft.kind" type="radio" class="radio radio-sm" value="page">Page du site</label>
      <label class="flex items-center gap-2 cursor-pointer"><input v-model="draft.kind" type="radio" class="radio radio-sm" value="url">Autre adresse</label>
    </div>

    <div v-if="draft.kind === 'page'" class="grid sm:grid-cols-2 gap-2">
      <select v-model="draft.type" class="select select-sm w-full">
        <option value="">Type de page</option>
        <option v-for="t in pageTypes" :key="t.key" :value="t.key">{{ t.label }}</option>
      </select>
      <select v-if="currentType && !currentType.single" v-model="draft.id" class="select select-sm w-full">
        <option value="">Choisir…</option>
        <option v-for="o in cache[draft.type] ?? []" :key="o.id" :value="o.id">{{ o.title }}</option>
      </select>
    </div>
    <input v-else v-model="draft.url" class="input input-sm w-full" placeholder="https://… , mailto:… , tel:… ou /chemin">

    <div v-if="!targetOnly" class="grid sm:grid-cols-[1fr_auto] gap-3 items-center">
      <input v-model="draft.label" class="input input-sm w-full" placeholder="Texte du lien (facultatif)">
      <label class="flex items-center gap-2 cursor-pointer text-sm"><input v-model="draft.newTab" type="checkbox" class="checkbox checkbox-sm">Nouvel onglet</label>
    </div>
  </div>
</template>
