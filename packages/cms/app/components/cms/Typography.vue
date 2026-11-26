<script setup lang="ts">
import { Trash2, Upload } from '@lucide/vue'
import {
  BUILTIN_FONTS, FONT_CATEGORIES, type CustomFont, type FontCategory, type FontChoice, type LevelStyle, SITE_FONT, SYSTEM_FONTS, TYPE_LEVELS, TYPE_LEVEL_LABELS,
  TYPE_LIMITS, TYPE_SCALES, type TypeLevel, type TypeScale, type Typography, customChoice, customFamilies,
} from '../../../shared/fonts'

/**
 * Typographie du site, dans l'écran Apparence : police du texte et des titres, échelle des tailles, réglages fins par
 * niveau, et polices envoyées. Les choix s'appliquent à l'aperçu tout de suite ; le site ne change qu'à
 * l'enregistrement du thème. L'envoi et la suppression d'un fichier de police, eux, sont immédiats.
 */
const typography = defineModel<Typography>({ required: true })
const fonts = defineModel<CustomFont[]>('fonts', { required: true })
const toast = useCmsToast()

const families = computed(() => customFamilies(fonts.value))
const groups = computed(() => (Object.keys(FONT_CATEGORIES) as FontCategory[]).map(category => ({ label: FONT_CATEGORIES[category], fonts: BUILTIN_FONTS.filter(f => f.category === category) })))
const set = (patch: Partial<Typography>) => { typography.value = { ...typography.value, ...patch } }

/** Change une propriété d'un niveau ; vide, elle est retirée (le site garde alors la sienne). */
function setLevel(level: TypeLevel, key: keyof LevelStyle, raw: string) {
  const style: LevelStyle = { ...typography.value.levels[level] }
  if (raw === '' || raw === SITE_FONT) delete style[key]
  else if (key === 'font') style.font = raw
  else if (Number.isFinite(Number(raw.replace(',', '.')))) style[key] = Number(raw.replace(',', '.'))
  const levels = { ...typography.value.levels }
  if (Object.keys(style).length) levels[level] = style
  else delete levels[level]
  set({ levels })
}
const value = (level: TypeLevel, key: keyof LevelStyle) => typography.value.levels[level]?.[key] ?? ''
const WEIGHTS = [[300, 'Léger'], [400, 'Normal'], [500, 'Moyen'], [600, 'Demi-gras'], [700, 'Gras'], [800, 'Très gras'], [900, 'Noir']] as const
const fine = computed(() => Object.keys(typography.value.levels).length)

// ───── Polices envoyées ─────
const input = ref<HTMLInputElement>()
const sending = ref(false)
async function upload(files: FileList | null) {
  if (!files?.length) return
  sending.value = true
  for (const file of files) {
    const body = new FormData()
    body.append('file', file)
    try {
      fonts.value = [...fonts.value, await cmsApi<CustomFont>('/api/cms/fonts', { method: 'POST', body })]
    }
    catch (e) {
      toast.error(`${file.name} : ${cmsErrorMessage(e)}`)
    }
  }
  sending.value = false
  if (input.value) input.value.value = ''
}
async function update(font: CustomFont, patch: Partial<Pick<CustomFont, 'family' | 'weight' | 'style'>>) {
  const before = font.family
  try {
    const result = await cmsApi<{ font: CustomFont }>(`/api/cms/fonts/${font.id}`, { method: 'PATCH', body: patch })
    fonts.value = fonts.value.map(f => (f.id === font.id ? result.font : f))
    // Famille renommée : les choix qui la désignaient suivent, s'il n'en reste aucun fichier sous l'ancien nom.
    if (patch.family && result.font.family !== before && !fonts.value.some(f => f.family === before)) rename(customChoice(before), customChoice(result.font.family))
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
}
function rename(from: FontChoice, to: FontChoice) {
  const swap = (choice: FontChoice) => (choice === from ? to : choice)
  set({
    body: swap(typography.value.body), heading: swap(typography.value.heading),
    levels: Object.fromEntries(Object.entries(typography.value.levels).map(([level, style]) => [level, style?.font ? { ...style, font: swap(style.font) } : style])),
  })
}
async function remove(font: CustomFont) {
  if (!confirm(`Supprimer le fichier « ${font.name} » ? Si le site s'en sert, il affichera une police du système à la place.`)) return
  try {
    await cmsApi(`/api/cms/fonts/${font.id}`, { method: 'DELETE' })
    fonts.value = fonts.value.filter(f => f.id !== font.id)
    if (!fonts.value.some(f => f.family === font.family)) rename(customChoice(font.family), SITE_FONT)
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
}
const weightValue = (font: CustomFont) => (Array.isArray(font.weight) ? 'variable' : String(font.weight))
const setWeight = (font: CustomFont, raw: string) => update(font, { weight: raw === 'variable' ? [100, 900] : Number(raw) })
</script>

<template>
  <div class="space-y-4" data-typography>
    <fieldset v-for="slot in [{ key: 'body', label: 'Police du texte', site: 'Police du site (celle prévue par son code)' }, { key: 'heading', label: 'Police des titres', site: 'Comme le texte (ou celle prévue par le site)' }] as const" :key="slot.key" class="fieldset">
      <legend class="fieldset-legend">{{ slot.label }}</legend>
      <select class="select select-sm w-full" :value="typography[slot.key]" :data-typography-font="slot.key" @change="set({ [slot.key]: ($event.target as HTMLSelectElement).value })">
        <option :value="SITE_FONT">{{ slot.site }}</option>
        <optgroup v-if="families.length" label="Vos polices">
          <option v-for="f in families" :key="f.family" :value="customChoice(f.family)">{{ f.family }}</option>
        </optgroup>
        <optgroup v-for="g in groups" :key="g.label" :label="g.label">
          <option v-for="f in g.fonts" :key="f.id" :value="f.id">{{ f.family }}</option>
        </optgroup>
        <optgroup label="Sans téléchargement">
          <option v-for="(f, id) in SYSTEM_FONTS" :key="id" :value="id">{{ f.label }}</option>
        </optgroup>
      </select>
    </fieldset>

    <fieldset class="fieldset">
      <legend class="fieldset-legend">Taille des titres</legend>
      <select class="select select-sm w-full" :value="typography.scale" data-typography-scale @change="set({ scale: ($event.target as HTMLSelectElement).value as TypeScale })">
        <option v-for="(s, id) in TYPE_SCALES" :key="id" :value="id">{{ s.label }}</option>
      </select>
      <p class="label whitespace-normal">{{ TYPE_SCALES[typography.scale].help }} Sur un téléphone, les grands titres se réduisent d'eux-mêmes.</p>
    </fieldset>

    <details class="rounded-box border border-base-300" data-typography-fine>
      <summary class="cursor-pointer px-3 py-2 text-sm font-medium">Réglages fins <span v-if="fine" class="badge badge-xs badge-primary ml-1">{{ fine }}</span></summary>
      <div class="px-3 pb-3 space-y-4">
        <p class="text-xs text-base-content/60">Niveau par niveau. Un réglage laissé vide n'est pas touché : il garde la valeur de l'échelle choisie, ou celle du site.</p>
        <div v-for="level in TYPE_LEVELS" :key="level" class="space-y-1.5" :data-typography-level="level">
          <div class="text-xs font-semibold">{{ TYPE_LEVEL_LABELS[level] }}</div>
          <select v-if="level !== 'body'" class="select select-xs w-full" :value="value(level, 'font') || SITE_FONT" aria-label="Police" @change="setLevel(level, 'font', ($event.target as HTMLSelectElement).value)">
            <option :value="SITE_FONT">Police des titres</option>
            <optgroup v-if="families.length" label="Vos polices"><option v-for="f in families" :key="f.family" :value="customChoice(f.family)">{{ f.family }}</option></optgroup>
            <optgroup v-for="g in groups" :key="g.label" :label="g.label"><option v-for="f in g.fonts" :key="f.id" :value="f.id">{{ f.family }}</option></optgroup>
          </select>
          <div class="grid grid-cols-2 gap-1.5">
            <select class="select select-xs" :value="value(level, 'weight')" aria-label="Graisse" data-typography-input="weight" @change="setLevel(level, 'weight', ($event.target as HTMLSelectElement).value)">
              <option value="">Graisse</option>
              <option v-for="[w, name] in WEIGHTS" :key="w" :value="w">{{ name }} ({{ w }})</option>
            </select>
            <label class="input input-xs" title="1 rem = 16 px sur la plupart des appareils">
              <input
                type="number" class="grow min-w-0" placeholder="Taille" step="0.0625" :min="(level === 'body' ? TYPE_LIMITS.bodySize : TYPE_LIMITS.headingSize)[0]" :max="(level === 'body' ? TYPE_LIMITS.bodySize : TYPE_LIMITS.headingSize)[1]"
                :value="value(level, 'size')" aria-label="Taille en rem" data-typography-input="size" @change="setLevel(level, 'size', ($event.target as HTMLInputElement).value)"
              ><span class="text-base-content/50">rem</span>
            </label>
            <label class="input input-xs" title="Hauteur d'une ligne, en proportion de la taille du texte">
              <input type="number" class="grow min-w-0" placeholder="Interligne" step="0.05" :min="TYPE_LIMITS.lineHeight[0]" :max="TYPE_LIMITS.lineHeight[1]" :value="value(level, 'lineHeight')" aria-label="Interligne" data-typography-input="lineHeight" @change="setLevel(level, 'lineHeight', ($event.target as HTMLInputElement).value)">
            </label>
            <label class="input input-xs" title="Espace entre les lettres ; négatif pour les resserrer">
              <input type="number" class="grow min-w-0" placeholder="Espacement" step="0.005" :min="TYPE_LIMITS.letterSpacing[0]" :max="TYPE_LIMITS.letterSpacing[1]" :value="value(level, 'letterSpacing')" aria-label="Espacement des lettres en em" data-typography-input="letterSpacing" @change="setLevel(level, 'letterSpacing', ($event.target as HTMLInputElement).value)"
              ><span class="text-base-content/50">em</span>
            </label>
          </div>
        </div>
      </div>
    </details>

    <div class="space-y-2" data-typography-custom>
      <div class="flex items-center gap-2">
        <div class="text-sm font-medium grow">Vos polices</div>
        <button type="button" class="btn btn-xs" :disabled="sending" @click="input?.click()"><Upload :size="13" />{{ sending ? 'Envoi…' : 'Envoyer' }}</button>
        <input ref="input" type="file" class="hidden" multiple accept=".woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf" data-typography-upload @change="upload(($event.target as HTMLInputElement).files)">
      </div>
      <p class="text-xs text-base-content/60">
        Fichiers WOFF2 de préférence (ou WOFF, TTF, OTF), un par graisse et par style, ou un seul fichier variable. Vérifiez que la licence de la police autorise son usage sur un site web.
      </p>
      <div v-for="group in families" :key="group.family" class="rounded-box border border-base-300 p-2 space-y-2" :data-typography-family="group.family">
        <div v-for="font in group.files" :key="font.id" class="space-y-1" data-typography-file>
          <div class="flex items-center gap-2 text-xs">
            <span class="truncate grow min-w-0 text-base-content/60" :title="font.name">{{ font.name }} · {{ formatFileSize(font.size) }}</span>
            <button type="button" class="btn btn-ghost btn-xs btn-square text-error shrink-0" title="Supprimer ce fichier" aria-label="Supprimer ce fichier" @click="remove(font)"><Trash2 :size="13" /></button>
          </div>
          <div class="grid grid-cols-[1fr_auto_auto] gap-1.5">
            <input class="input input-xs min-w-0" :value="font.family" aria-label="Nom de la famille" @change="update(font, { family: ($event.target as HTMLInputElement).value })">
            <select class="select select-xs w-auto" :value="weightValue(font)" aria-label="Graisse" @change="setWeight(font, ($event.target as HTMLSelectElement).value)">
              <option v-for="w in [100, 200, 300, 400, 500, 600, 700, 800, 900]" :key="w" :value="w">{{ w }}</option>
              <option value="variable">Variable</option>
            </select>
            <select class="select select-xs w-auto" :value="font.style" aria-label="Style" @change="update(font, { style: ($event.target as HTMLSelectElement).value as 'normal' | 'italic' })">
              <option value="normal">Droit</option>
              <option value="italic">Italique</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
