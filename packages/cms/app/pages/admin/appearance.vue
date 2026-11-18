<script setup lang="ts">
import { type CmsTheme, DEFAULT_ADMIN_COLOR, DEFAULT_THEME, isDarkTheme, themeVars } from '../../../shared/theme'

definePageMeta({ layout: 'admin', middleware: ['cms-auth', 'cms-admin'] })

const toast = useCmsToast()
const schema = await useCmsSchema()
const current = await cmsApi<{ theme: CmsTheme | null; adminColor: string | null }>('/api/cms/theme')
const saved = ref<CmsTheme | null>(current.theme)

// Couleur du back-office : indépendante du thème du site, appliquée dès le clic.
const adminColor = useState<string | null>('cms-admin-color', () => current.adminColor)
const adminPresets = [DEFAULT_ADMIN_COLOR, '#0f766e', '#b91c1c', '#c2410c', '#1d4ed8', '#7c3aed', '#111827']
async function setAdminColor(color: string | null) {
  if (color && !validHex(color)) return
  const before = adminColor.value
  adminColor.value = color
  try {
    await cmsApi('/api/cms/admin-color', { method: 'PUT', body: { color } })
  }
  catch (e) {
    adminColor.value = before
    toast.error(cmsErrorMessage(e))
  }
}
const theme = reactive<CmsTheme>({ ...DEFAULT_THEME, ...saved.value })
const saving = ref(false)
const dirty = computed(() => JSON.stringify(theme) !== JSON.stringify({ ...DEFAULT_THEME, ...saved.value }))
const vars = computed(() => themeVars(theme))

const colors: { key: 'primary' | 'secondary' | 'accent' | 'neutral' | 'base'; label: string; help: string; presets: string[] }[] = [
  { key: 'primary', label: 'Couleur principale', help: 'Boutons et liens importants.', presets: ['#4f46e5', '#0f766e', '#b91c1c', '#c2410c', '#1d4ed8'] },
  { key: 'secondary', label: 'Couleur secondaire', help: 'Éléments mis en valeur, en complément.', presets: ['#db2777', '#7c3aed', '#0284c7', '#ca8a04', '#475569'] },
  { key: 'accent', label: 'Couleur d\'accent', help: 'Étiquettes et petits détails.', presets: ['#0d9488', '#d97706', '#e11d48', '#65a30d', '#9333ea'] },
  { key: 'neutral', label: 'Couleur neutre', help: 'Pied de page, zones sombres.', presets: ['#1f2937', '#0f172a', '#292524', '#3f3f46', '#134e4a'] },
  { key: 'base', label: 'Fond des pages', help: 'Un fond sombre donne un site en mode sombre.', presets: ['#ffffff', '#fafaf9', '#f8fafc', '#111827', '#0c0a09'] },
]
const validHex = (v: string) => /^#[0-9a-f]{6}$/i.test(v)
// Les services de l'aperçu viennent du fichier de collections, pour ressembler au vrai site.
const sampleCards = Object.values(schema.value.collections ?? {}).slice(0, 3).map(c => c.label)

async function save() {
  saving.value = true
  try {
    saved.value = (await cmsApi<{ theme: CmsTheme }>('/api/cms/theme', { method: 'PUT', body: theme })).theme
    toast.success('Thème enregistré. Le site est à jour.')
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
  saving.value = false
}

async function reset() {
  if (!confirm('Revenir à l\'apparence d\'origine du site ? Le thème enregistré sera supprimé.')) return
  try {
    await cmsApi('/api/cms/theme', { method: 'DELETE' })
    saved.value = null
    Object.assign(theme, DEFAULT_THEME)
    toast.success('Apparence d\'origine rétablie')
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
}

onBeforeRouteLeave(() => !dirty.value || confirm('Le thème modifié n\'est pas enregistré. Quitter quand même ?'))
</script>

<template>
  <section class="max-w-6xl mx-auto">
    <div class="flex flex-wrap items-end gap-3 mb-6">
      <div>
        <h1 class="text-2xl font-bold">Apparence</h1>
        <p class="text-sm text-base-content/60">Couleurs et formes du site. L'aperçu se met à jour en direct ; le site ne change qu'à l'enregistrement.</p>
      </div>
      <div class="ml-auto flex gap-2">
        <button v-if="saved" class="btn btn-sm" :disabled="saving" @click="reset">Rétablir l'origine</button>
        <button class="btn btn-sm btn-primary" :disabled="saving || (!dirty && !!saved)" @click="save">Enregistrer</button>
      </div>
    </div>

    <div class="grid lg:grid-cols-[21rem_1fr] gap-6 items-start">
      <div class="card bg-base-100 border border-base-300 p-5 space-y-4">
        <fieldset v-for="c in colors" :key="c.key" class="fieldset">
          <legend class="fieldset-legend">{{ c.label }}</legend>
          <div class="flex items-center gap-2">
            <input v-model="theme[c.key]" type="color" class="w-9 h-9 rounded-field cursor-pointer border border-base-300 shrink-0" :aria-label="c.label">
            <input
              class="input input-sm w-24 font-mono" :class="{ 'input-error': !validHex(theme[c.key]) }" :value="theme[c.key]"
              @change="validHex(($event.target as HTMLInputElement).value) ? theme[c.key] = ($event.target as HTMLInputElement).value.toLowerCase() : ($event.target as HTMLInputElement).value = theme[c.key]"
            >
            <div class="flex gap-1 ml-auto">
              <button
                v-for="p in c.presets" :key="p" type="button" class="w-5 h-5 rounded-full border border-base-300 cursor-pointer"
                :class="{ 'ring-2 ring-offset-1 ring-base-content/40': theme[c.key] === p }" :style="{ background: p }" :title="p" @click="theme[c.key] = p"
              />
            </div>
          </div>
          <p class="label">{{ c.help }}</p>
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Arrondi des angles</legend>
          <input v-model.number="theme.radius" type="range" class="range range-sm" min="0" max="2" step="0.125">
          <p class="label flex justify-between"><span>Carré</span><span>Très arrondi</span></p>
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Épaisseur des bordures</legend>
          <input v-model.number="theme.border" type="range" class="range range-sm" min="0.5" max="2" step="0.5">
          <p class="label flex justify-between"><span>Fine</span><span>{{ String(theme.border).replace('.', ',') }} px</span><span>Épaisse</span></p>
        </fieldset>
        <label class="flex items-center justify-between cursor-pointer">
          <span class="text-sm">Relief sur les boutons et les champs</span>
          <input v-model="theme.depth" type="checkbox" class="toggle toggle-sm">
        </label>
        <label class="flex items-center justify-between cursor-pointer">
          <span class="text-sm">Texture légère (grain)</span>
          <input v-model="theme.noise" type="checkbox" class="toggle toggle-sm">
        </label>
      </div>

      <div class="space-y-6 lg:sticky lg:top-20">
      <div class="card border border-base-300 overflow-hidden">
        <div class="px-4 py-2 text-xs text-base-content/50 border-b border-base-300 bg-base-100 flex justify-between">
          <span>Aperçu</span><span>{{ isDarkTheme(theme) ? 'Thème sombre' : 'Thème clair' }}</span>
        </div>
        <!-- Les variables du thème ne s'appliquent qu'à ce bloc : le back-office garde son apparence. -->
        <div data-cms-theme-preview class="bg-base-100 text-base-content p-8 space-y-6" :style="vars">
          <div class="flex flex-wrap items-center gap-4 text-sm">
            <span class="font-bold text-lg">{{ schema.site.name }}</span>
            <span class="ml-auto">Services</span><span>Contact</span>
            <button class="btn btn-primary btn-sm">Prendre rendez-vous</button>
          </div>
          <div class="py-4">
            <span class="badge badge-accent mb-3">Nouveau</span>
            <h2 class="text-3xl font-bold mb-2">Un titre de page d'accueil</h2>
            <p class="opacity-70 mb-4 max-w-md">Un paragraphe d'introduction, pour juger de la lisibilité du texte sur le fond choisi.</p>
            <div class="flex flex-wrap gap-2">
              <button class="btn btn-primary">Bouton principal</button>
              <button class="btn btn-secondary">Secondaire</button>
              <button class="btn btn-outline">Contour</button>
              <a class="link link-primary self-center">Un lien</a>
            </div>
          </div>
          <div class="grid sm:grid-cols-3 gap-3">
            <div v-for="label in sampleCards" :key="label" class="card card-border bg-base-200 p-4">
              <div class="font-semibold">{{ label }}</div>
              <div class="text-sm opacity-70">Une carte de contenu.</div>
            </div>
          </div>
          <div class="flex flex-wrap gap-2 items-center">
            <input class="input w-56" placeholder="Votre adresse e-mail">
            <button class="btn btn-neutral">Envoyer</button>
            <input type="checkbox" class="toggle toggle-primary" checked>
            <input type="checkbox" class="checkbox checkbox-primary" checked>
          </div>
          <div class="bg-neutral text-neutral-content rounded-box p-4 text-sm">Pied de page · {{ schema.site.name }}</div>
        </div>
      </div>

      <div class="card bg-base-100 border border-base-300 p-5 space-y-3">
        <div>
          <div class="font-semibold">Couleur du back-office</div>
          <p class="text-sm text-base-content/60">La couleur des boutons et des éléments actifs de cette interface, pour tous les utilisateurs. Elle ne change pas le site.</p>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <input
            type="color" class="w-9 h-9 rounded-field cursor-pointer border border-base-300 shrink-0" aria-label="Couleur du back-office"
            :value="adminColor ?? DEFAULT_ADMIN_COLOR" @change="setAdminColor(($event.target as HTMLInputElement).value)"
          >
          <div class="flex gap-1.5">
            <button
              v-for="p in adminPresets" :key="p" type="button" class="w-6 h-6 rounded-full border border-base-300 cursor-pointer"
              :class="{ 'ring-2 ring-offset-1 ring-base-content/40': (adminColor ?? DEFAULT_ADMIN_COLOR) === p }" :style="{ background: p }" :title="p" @click="setAdminColor(p)"
            />
          </div>
          <button class="btn btn-primary btn-sm ml-auto">Exemple de bouton</button>
        </div>
      </div>
      </div>
    </div>
  </section>
</template>
