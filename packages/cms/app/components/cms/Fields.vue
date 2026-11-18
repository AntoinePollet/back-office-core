<script setup lang="ts">
import { ChevronDown } from '@lucide/vue'
import { isVisible } from '../../../shared/format'

/**
 * Affiche une liste de champs du format.
 * Un champ traduit écrit dans `values` (la langue en cours), un champ commun dans `shared`.
 * Les champs rangés dans une section (`section()` dans la configuration) sont regroupés dans un bloc repliable.
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

type Entry = [key: string, field: any]
type Block = { kind: 'field'; entry: Entry } | { kind: 'section'; label: string; help?: string; collapsed?: boolean; entries: Entry[] }

/** Champs de cette zone, dans l'ordre du fichier ; les champs d'une même section sont regroupés. Seuls les champs affichés comptent. */
const blocks = computed(() => {
  const out: Block[] = []
  for (const entry of Object.entries(props.fields)) {
    const field = entry[1]
    if (!(props.scope === 'all' || (props.scope === 'localized') === (field.localized !== false)) || !isVisible(field, context.value)) continue
    const section = field.section
    const last = out.at(-1)
    if (!section?.label) out.push({ kind: 'field', entry })
    else if (last?.kind === 'section' && last.label === section.label) last.entries.push(entry)
    else out.push({ kind: 'section', label: section.label, help: section.help, collapsed: section.collapsed, entries: [entry] })
  }
  // Une section dont aucun champ n'est affiché n'apparaît pas : elle n'a pas de bloc.
  return out
})

/**
 * Sections ouvertes ou fermées. L'état est partagé par le formulaire (voir `[id].vue`) : en traductions côte à côte,
 * les deux langues ouvrent et ferment la même section ensemble et restent alignées.
 */
const local = reactive<Record<string, boolean>>({})
const opened = inject<Record<string, boolean>>('cms-sections', local)
const stateKey = (label: string) => `${props.scope === 'shared' ? 'shared' : 'localized'}:${label}`
const isOpen = (b: Block & { kind: 'section' }) => opened[stateKey(b.label)] ?? !b.collapsed
const toggle = (b: Block & { kind: 'section' }) => { opened[stateKey(b.label)] = !isOpen(b) }

const errorKeys = computed(() => Object.keys(props.errors ?? {}))
/** Erreurs des champs d'une section, sous-champs de répéteur compris ('faq.0.question'). */
const errorsIn = (b: Block & { kind: 'section' }) =>
  errorKeys.value.filter(k => b.entries.some(([key]) => k === (props.prefix ?? '') + key || k.startsWith(`${props.prefix ?? ''}${key}.`))).length
// Une section repliée qui contient une erreur s'ouvre quand les erreurs arrivent (à l'enregistrement ou à la publication).
watch(errorKeys, () => {
  for (const b of blocks.value) if (b.kind === 'section' && errorsIn(b)) opened[stateKey(b.label)] = true
}, { immediate: true })

const sectionId = useId()
const cell = (field: any) => (field.width === 'half' ? 'col-span-2 sm:col-span-1' : 'col-span-2')
</script>

<template>
  <div class="grid grid-cols-2 gap-x-5 gap-y-4">
    <template v-for="(b, n) in blocks" :key="b.kind === 'field' ? b.entry[0] : 'section:' + b.label">
      <div v-if="b.kind === 'field'" class="min-w-0" :class="cell(b.entry[1])">
        <p v-if="b.entry[1].restricted && cannotEditRestricted" class="text-xs text-base-content/50 -mb-1">Champ réservé : vous pouvez le lire, pas le modifier.</p>
        <CmsField
          :inert="b.entry[1].restricted && cannotEditRestricted" :class="{ 'opacity-60': b.entry[1].restricted && cannotEditRestricted }"
          :field="b.entry[1]"
          :model-value="target(b.entry[1])[b.entry[0]]"
          :path="(prefix ?? '') + b.entry[0]"
          :errors="errors"
          @update:model-value="target(b.entry[1])[b.entry[0]] = $event"
        />
      </div>

      <section v-else class="cms-section col-span-2 min-w-0 rounded-box border" :class="errorsIn(b) ? 'border-error/60' : 'border-base-300'" :data-section="b.label">
        <h3>
          <button
            :id="`${sectionId}-${n}-h`" type="button" class="w-full flex items-start gap-3 px-3 sm:px-4 py-3 text-left cursor-pointer rounded-box hover:bg-base-200/50"
            :aria-expanded="isOpen(b)" :aria-controls="`${sectionId}-${n}`" @click="toggle(b)"
          >
            <span class="grow min-w-0">
              <span class="flex items-center gap-2 text-sm font-semibold">
                {{ b.label }}
                <span v-if="errorsIn(b)" class="badge badge-xs badge-error">{{ errorsIn(b) }} à corriger</span>
              </span>
              <span v-if="b.help" class="block text-xs font-normal text-base-content/60 mt-0.5">{{ b.help }}</span>
            </span>
            <span v-if="!isOpen(b)" class="text-xs text-base-content/50 mt-0.5 shrink-0">{{ b.entries.length }} champ{{ b.entries.length > 1 ? 's' : '' }}</span>
            <ChevronDown :size="18" class="shrink-0 mt-0.5 text-base-content/50 transition-transform" :class="{ 'rotate-180': isOpen(b) }" />
          </button>
        </h3>
        <div v-show="isOpen(b)" :id="`${sectionId}-${n}`" role="region" :aria-labelledby="`${sectionId}-${n}-h`" class="grid grid-cols-2 gap-x-5 gap-y-4 px-3 sm:px-4 pb-4 pt-1">
          <div v-for="[key, field] in b.entries" :key="key" class="min-w-0" :class="cell(field)">
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
      </section>
    </template>
  </div>
</template>
