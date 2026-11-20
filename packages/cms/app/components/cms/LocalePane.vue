<script setup lang="ts">
import { isEmpty, slugify } from '../../../shared/content'

/** Un volet du formulaire pour une langue : adresse, champs traduits, référencement. */
const props = defineProps<{
  def: Record<string, any>
  doc: { shared: Record<string, any>; locales: Record<string, { slug: string; status: string | null; values: Record<string, any> }> }
  loc: string
  /** Langue affichée dans l'autre volet, en mode côte à côte. */
  other?: string
  tab: 'content' | 'seo'
  split: boolean
  locales: readonly string[]
  defaultLocale: string
  errors?: Record<string, string>
}>()
const emit = defineEmits<{ loc: [locale: string] }>()

const multi = computed(() => props.locales.length > 1)
const state = computed(() => props.doc.locales[props.loc]!)
const hasSlug = computed(() => props.def.kind === 'collection' && !!props.def.path?.includes('[slug]'))
const autoSlug = computed(() => slugify(String(state.value.values[props.def.slugFrom ?? props.def.titleField] ?? '')))
const untranslated = computed(() => props.loc !== props.defaultLocale && Object.values(state.value.values).every(isEmpty))
const localeName = (l: string) => new Intl.DisplayNames(['fr'], { type: 'language' }).of(l) ?? l

function copyFromDefault() {
  state.value.values = JSON.parse(JSON.stringify(props.doc.locales[props.defaultLocale]!.values))
  state.value.slug = ''
}
</script>

<template>
  <div class="p-5 space-y-5 min-w-0">
    <div v-if="split" class="flex items-center gap-2">
      <select class="select select-sm w-40 capitalize" :value="loc" @change="emit('loc', ($event.target as HTMLSelectElement).value)">
        <option v-for="l in locales.filter(x => x !== other)" :key="l" :value="l">{{ localeName(l) }}</option>
      </select>
      <span class="badge badge-xs badge-soft" :class="state.status ? 'badge-success' : 'badge-warning'">{{ state.status ? 'Traduit' : 'À traduire' }}</span>
    </div>

    <div v-if="untranslated" class="alert alert-soft alert-warning text-sm">
      <span>Pas encore traduit en {{ localeName(loc) }} : ce contenu n'apparaît pas sur le site dans cette langue.</span>
      <button type="button" class="btn btn-sm" @click="copyFromDefault">Copier depuis le {{ localeName(defaultLocale) }}</button>
    </div>

    <div v-show="tab === 'content'" class="space-y-4">
      <CmsFields :fields="def.fields" :shared="doc.shared" :values="state.values" :scope="multi ? 'localized' : 'all'" :errors="errors" />

      <fieldset v-if="hasSlug" class="fieldset">
        <legend class="fieldset-legend">Adresse de la page</legend>
        <label class="input w-full" :class="{ 'input-error': errors?.slug }">
          <span class="text-base-content/40">{{ (loc === defaultLocale ? '' : '/' + loc) + def.path.replace('[slug]', '') }}</span>
          <input v-model="state.slug" class="grow" :placeholder="autoSlug || 'générée depuis le titre'">
        </label>
        <p v-if="errors?.slug" class="label text-error">{{ errors.slug }}</p>
        <p v-else class="label">Laissée vide, elle est générée depuis le titre au premier enregistrement.</p>
      </fieldset>
    </div>

    <!-- Référencement : champs, aperçus et conseils de cette langue. -->
    <CmsSeoPanel v-if="def.seo" v-show="tab === 'seo'" :def="def" :doc="doc" :loc="loc" :default-locale="defaultLocale" :active="tab === 'seo'" />
  </div>
</template>
