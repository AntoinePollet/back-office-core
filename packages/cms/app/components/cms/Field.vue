<script setup lang="ts">
import { ChevronDown, ChevronUp, Plus, Trash2 } from '@lucide/vue'
import { applyDefaults } from '../../../shared/content'

/** Un champ de formulaire, choisi d'après son type dans le format. */
const props = defineProps<{
  field: Record<string, any>
  modelValue: any
  /** Chemin du champ, clé de ses erreurs : 'title', 'faq.0.question'. */
  path: string
  errors?: Record<string, string>
}>()
const emit = defineEmits<{ 'update:modelValue': [value: any] }>()

const value = computed({ get: () => props.modelValue, set: v => emit('update:modelValue', v) })
const error = computed(() => props.errors?.[props.path])
const inputType = computed(() => ({ email: 'email', url: 'url', tel: 'tel' } as Record<string, string>)[props.field.format] ?? 'text')
const length = computed(() => (typeof props.modelValue === 'string' ? props.modelValue.length : 0))

const setNumber = (raw: string) => { value.value = raw === '' ? null : Number(raw) }

// Choix multiple
const chosen = computed<string[]>(() => (Array.isArray(props.modelValue) ? props.modelValue : []))
const toggleChoice = (v: string) => { value.value = chosen.value.includes(v) ? chosen.value.filter(x => x !== v) : [...chosen.value, v] }

// Répéteur
const items = computed<Record<string, any>[]>(() => (Array.isArray(props.modelValue) ? props.modelValue : []))
const open = ref(-1)
const itemTitle = (item: Record<string, any>, i: number) => (props.field.itemLabel && item[props.field.itemLabel]) || `Élément ${i + 1}`
const itemHasError = (i: number) => Object.keys(props.errors ?? {}).some(k => k.startsWith(`${props.path}.${i}.`))
function addItem() { value.value = [...items.value, applyDefaults(props.field.fields, {})]; open.value = items.value.length }
function removeItem(i: number) { value.value = items.value.filter((_, j) => j !== i); open.value = -1 }
function moveItem(i: number, delta: number) {
  const next = [...items.value]
  next.splice(i + delta, 0, next.splice(i, 1)[0]!)
  value.value = next
  open.value = -1
}
</script>

<template>
  <!-- Interrupteur : le libellé est à côté, pas au-dessus -->
  <label v-if="field.type === 'boolean'" class="flex items-center gap-3 cursor-pointer py-2">
    <input type="checkbox" class="toggle toggle-sm" :checked="!!value" @change="value = ($event.target as HTMLInputElement).checked">
    <span class="text-sm">{{ field.label }}</span>
    <span v-if="field.help" class="text-xs text-base-content/50">{{ field.help }}</span>
  </label>

  <fieldset v-else class="fieldset">
    <legend class="fieldset-legend">
      {{ field.label }}<span v-if="field.required" class="text-error" title="Obligatoire">*</span>
    </legend>

    <input v-if="field.type === 'text'" v-model="value" :type="inputType" class="input w-full" :class="{ 'input-error': error }" :placeholder="field.placeholder">

    <textarea v-else-if="field.type === 'textarea'" v-model="value" class="textarea w-full" :class="{ 'textarea-error': error }" :rows="field.rows ?? 3" />

    <CmsRichText v-else-if="field.type === 'richText'" v-model="value" :features="field.features" :invalid="!!error" />

    <label v-else-if="field.type === 'number'" class="input w-full" :class="{ 'input-error': error }">
      <input type="number" class="grow" :value="value ?? ''" :min="field.min" :max="field.max" :step="field.step ?? (field.integer ? 1 : 'any')" @input="setNumber(($event.target as HTMLInputElement).value)">
      <span v-if="field.unit" class="text-base-content/50">{{ field.unit }}</span>
    </label>

    <input v-else-if="field.type === 'date'" v-model="value" :type="field.time ? 'datetime-local' : 'date'" class="input w-full" :class="{ 'input-error': error }">

    <div v-else-if="field.type === 'select' && field.multiple" class="flex flex-wrap gap-x-5 gap-y-2 py-1">
      <label v-for="o in field.options" :key="o.value" class="flex items-center gap-2 cursor-pointer text-sm">
        <input type="checkbox" class="checkbox checkbox-sm" :checked="chosen.includes(o.value)" @change="toggleChoice(o.value)">{{ o.label }}
      </label>
    </div>

    <select v-else-if="field.type === 'select'" class="select w-full" :class="{ 'select-error': error }" :value="value ?? ''" @change="value = ($event.target as HTMLSelectElement).value || null">
      <option value="">Aucun</option>
      <option v-for="o in field.options" :key="o.value" :value="o.value">{{ o.label }}</option>
    </select>

    <div v-else-if="field.type === 'repeater'" class="space-y-2">
      <div v-for="(item, i) in items" :key="i" class="border rounded-field" :class="itemHasError(i) ? 'border-error' : 'border-base-300'">
        <div class="flex items-center gap-2 px-3 py-2 cursor-pointer" @click="open = open === i ? -1 : i">
          <span class="text-xs text-base-content/40 w-4">{{ i + 1 }}</span>
          <span class="grow text-sm font-medium truncate">{{ itemTitle(item, i) }}</span>
          <button type="button" class="btn btn-ghost btn-xs" :disabled="i === 0" title="Monter" aria-label="Monter" @click.stop="moveItem(i, -1)"><ChevronUp :size="14" /></button>
          <button type="button" class="btn btn-ghost btn-xs" :disabled="i === items.length - 1" title="Descendre" aria-label="Descendre" @click.stop="moveItem(i, 1)"><ChevronDown :size="14" /></button>
          <button type="button" class="btn btn-ghost btn-xs text-error" title="Supprimer" aria-label="Supprimer" @click.stop="removeItem(i)"><Trash2 :size="14" /></button>
        </div>
        <div v-if="open === i" class="p-3 pt-0">
          <CmsFields :fields="field.fields" :shared="{}" :values="item" scope="all" :errors="errors" :prefix="`${path}.${i}.`" />
        </div>
      </div>
      <button type="button" class="btn btn-sm btn-ghost" :disabled="field.max != null && items.length >= field.max" @click="addItem"><Plus :size="14" />Ajouter</button>
    </div>

    <CmsMediaField v-else-if="field.type === 'image' || field.type === 'file'" v-model="value" :field="field" :invalid="!!error" />
    <CmsRelationField v-else-if="field.type === 'relation'" v-model="value" :field="field" :invalid="!!error" />
    <CmsLinkField v-else-if="field.type === 'link'" v-model="value" :invalid="!!error" />

    <p v-if="error" class="label text-error">{{ error }}</p>
    <p v-else-if="field.help || field.max != null && ['text', 'textarea'].includes(field.type)" class="label flex justify-between gap-2">
      <span>{{ field.help }}</span>
      <span v-if="field.max != null && ['text', 'textarea'].includes(field.type)" :class="{ 'text-error': length > field.max }">{{ length }} / {{ field.max }}</span>
    </p>
  </fieldset>
</template>
