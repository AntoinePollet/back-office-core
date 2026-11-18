<script setup lang="ts">
import { isVisible } from '../../../shared/format'

/**
 * Affiche une liste de champs du format.
 * Un champ traduit écrit dans `values` (la langue en cours), un champ commun dans `shared`.
 */
const props = defineProps<{
  fields: Record<string, any>
  shared: Record<string, any>
  values: Record<string, any>
  /** 'localized' : champs traduits. 'shared' : champs communs. 'all' : tous, dans l'ordre du fichier. */
  scope: 'all' | 'localized' | 'shared'
  errors?: Record<string, string>
  /** Préfixe des clés d'erreur, pour les sous-champs d'un répéteur : 'faq.0.' */
  prefix?: string
}>()

const context = computed(() => ({ ...props.shared, ...props.values }))
// Champs réservés : affichés, mais figés pour qui n'a pas le droit de les modifier (le serveur ignore de toute façon sa saisie).
const cannotEditRestricted = useCmsUser().value?.restrictedFields === false
const target = (field: any) => (field.localized === false ? props.shared : props.values)
const visible = computed(() => Object.entries(props.fields).filter(([, field]) =>
  (props.scope === 'all' || (props.scope === 'localized') === (field.localized !== false)) && isVisible(field, context.value)))
</script>

<template>
  <div class="grid grid-cols-2 gap-x-5 gap-y-4">
    <div v-for="[key, field] in visible" :key="key" class="min-w-0" :class="field.width === 'half' ? 'col-span-2 sm:col-span-1' : 'col-span-2'">
      <p v-if="field.restricted && cannotEditRestricted" class="text-xs text-base-content/50 -mb-1">Champ réservé : vous pouvez le lire, pas le modifier.</p>
      <CmsField
        :inert="field.restricted && cannotEditRestricted" :class="{ 'opacity-60': field.restricted && cannotEditRestricted }"
        :field="field"
        :model-value="target(field)[key]"
        :path="(prefix ?? '') + key"
        :errors="errors"
        @update:model-value="target(field)[key] = $event"
      />
    </div>
  </div>
</template>
