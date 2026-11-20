<script setup lang="ts">
import type { Component } from 'vue'
import { CircleCheck, Construction, Wrench } from '@lucide/vue'
import {
  type Availability, type AvailabilityMode, type ClosedMode, type ClosedTemplate, CLOSED_MODES, CLOSED_TEMPLATES, CONTACT_MAX,
  MESSAGE_MAX, MODE_LABELS, TITLE_MAX, closedPageHtml, closedTexts, defaultAvailability, normalizeAvailability,
} from '../../../shared/availability'
import { languageName } from '../../../shared/activity'
import type { CmsTheme } from '../../../shared/theme'

definePageMeta({ layout: 'admin', middleware: ['cms-auth', 'cms-admin'] })

const toast = useCmsToast()
const schema = await useCmsSchema()
const site = schema.value.site
const locales = site.locales as readonly string[]
const multi = locales.length > 1

const [loaded, themeData] = await Promise.all([
  cmsApi<Availability>('/api/cms/availability'),
  cmsApi<{ theme: CmsTheme | null }>('/api/cms/theme'),
])
const saved = ref<Availability>(structuredClone(toRaw(loaded)))
const form = reactive<Availability>({ ...defaultAvailability(), ...structuredClone(toRaw(loaded)) })
const siteMode = useState<AvailabilityMode | null>('cms-site-mode', () => loaded.mode)
// Comparés une fois nettoyés : ouvrir l'onglet d'une langue (textes vides) ne compte pas comme une modification.
const dirty = computed(() => JSON.stringify(normalizeAvailability(form, locales)) !== JSON.stringify(normalizeAvailability(saved.value, locales)))
const saving = ref(false)

const modes: { key: AvailabilityMode; icon: Component; help: string; seo: string }[] = [
  { key: 'online', icon: CircleCheck, help: 'Le site est visible de tous.', seo: 'Fonctionnement normal.' },
  { key: 'construction', icon: Construction, help: 'Pour un site pas encore lancé : les visiteurs voient la page « En construction ».', seo: 'Pages non référencées par les moteurs de recherche.' },
  { key: 'maintenance', icon: Wrench, help: 'Coupure temporaire d\'un site déjà en ligne : les visiteurs voient « De retour bientôt ».', seo: 'Les moteurs de recherche comprennent que la coupure est temporaire et gardent vos pages.' },
]

// Page d'attente affichée dans le formulaire : celle de l'état choisi, sinon la dernière ouverte.
const editing = ref<ClosedMode>(form.mode === 'online' ? 'construction' : form.mode)
watch(() => form.mode, (mode) => { if (mode !== 'online') editing.value = mode })
const page = computed(() => form.pages[editing.value])
const locale = ref(site.defaultLocale)
const texts = computed(() => {
  page.value.texts[locale.value] ??= { title: '', message: '' }
  return page.value.texts[locale.value]!
})
// Ce qu'affichera la page si le champ reste vide : texte de la langue par défaut, ou texte proposé.
const placeholder = computed(() => closedTexts({ ...page.value, texts: { ...page.value.texts, [locale.value]: { title: '', message: '' } } }, editing.value, locale.value, site.defaultLocale))

const { load, byId } = useCmsMedia()
onMounted(() => load())
const image = computed(() => {
  const media = byId(page.value.imageId)
  return media?.mime.startsWith('image/') ? { url: cmsImageUrl(media, 1920), position: cmsObjectPosition(media) } : null
})

const previewHtml = computed(() => closedPageHtml({
  mode: editing.value, page: page.value, locale: locale.value, defaultLocale: site.defaultLocale,
  siteName: site.name, theme: themeData.theme, image: image.value,
}))
const previewWidth = ref<'desktop' | 'mobile'>('desktop')

async function save() {
  if (form.mode !== 'online' && saved.value.mode === 'online'
    && !confirm(`Passer le site en « ${MODE_LABELS[form.mode]} » ? Les visiteurs ne verront plus que la page d'attente. Vous pourrez toujours voir le site en mode aperçu.`)) return
  saving.value = true
  try {
    const result = await cmsApi<{ availability: Availability }>('/api/cms/availability', { method: 'PUT', body: form })
    const changed = result.availability.mode !== saved.value.mode
    saved.value = structuredClone(result.availability)
    Object.assign(form, structuredClone(result.availability))
    siteMode.value = result.availability.mode
    const fresh = cmsSiteUpdated(result)
    toast.success(!changed
      ? 'Pages d\'attente enregistrées'
      : result.availability.mode === 'online'
        ? (fresh ? 'Le site est de nouveau en ligne.' : 'Site remis en ligne')
        : `Le site est maintenant « ${MODE_LABELS[result.availability.mode]} ».`)
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
  saving.value = false
}

onBeforeRouteLeave(() => !dirty.value || confirm('Les modifications ne sont pas enregistrées. Quitter quand même ?'))
</script>

<template>
  <section class="max-w-6xl mx-auto">
    <CmsSiteDelayNotice />
    <div class="flex flex-wrap items-end gap-3 mb-6">
      <div>
        <h1 class="text-2xl font-bold">Disponibilité du site</h1>
        <p class="text-sm text-base-content/60">Fermez le site au public le temps d'une construction ou d'une maintenance. Le back-office reste accessible.</p>
      </div>
      <div class="ml-auto flex gap-2">
        <a v-if="saved.mode !== 'online'" href="/?preview=1" target="_blank" class="btn btn-sm">Voir le site (aperçu)</a>
        <button class="btn btn-sm btn-primary" :disabled="saving || !dirty" @click="save">Enregistrer</button>
      </div>
    </div>

    <fieldset class="grid sm:grid-cols-3 gap-3 mb-6" aria-label="État du site">
      <label
        v-for="m in modes" :key="m.key" data-cms-mode
        class="rounded-box bg-base-100 border-2 p-4 cursor-pointer transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary"
        :class="form.mode === m.key ? (m.key === 'online' ? 'border-success' : 'border-warning') : 'border-base-300 hover:border-base-content/30'"
      >
        <input v-model="form.mode" type="radio" name="mode" :value="m.key" class="sr-only">
        <div class="flex items-center gap-2 font-semibold">
          <component :is="m.icon" :size="18" :class="m.key === 'online' ? 'text-success' : 'text-warning'" />
          {{ MODE_LABELS[m.key] }}
          <span v-if="saved.mode === m.key" class="badge badge-sm ml-auto" :class="m.key === 'online' ? 'badge-success' : 'badge-warning'">Actuel</span>
        </div>
        <p class="text-sm mt-1">{{ m.help }}</p>
        <p class="text-xs text-base-content/50 mt-1">{{ m.seo }}</p>
      </label>
    </fieldset>

    <div v-if="saved.mode !== 'online'" role="status" class="alert alert-warning mb-6 text-sm">
      Le site est fermé au public. Vous, et les personnes à qui vous avez envoyé un lien d'aperçu, voyez le vrai site en mode aperçu.
    </div>

    <div class="grid lg:grid-cols-[22rem_1fr] gap-6 items-start">
      <div class="card bg-base-100 border border-base-300 p-5 space-y-4">
        <div role="tablist" class="tabs tabs-box tabs-sm">
          <button
            v-for="m in CLOSED_MODES" :key="m" role="tab" type="button" class="tab grow"
            :class="{ 'tab-active': editing === m }" :aria-selected="editing === m" @click="editing = m"
          >
            Page « {{ MODE_LABELS[m] }} »
          </button>
        </div>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Modèle</legend>
          <div class="space-y-2">
            <label
              v-for="(t, key) in CLOSED_TEMPLATES" :key="key"
              class="flex gap-3 items-start border rounded-field p-3 cursor-pointer"
              :class="page.template === key ? 'border-primary bg-primary/5' : 'border-base-300'"
            >
              <input v-model="page.template" type="radio" class="radio radio-sm radio-primary mt-0.5" :value="key as ClosedTemplate" :name="`template-${editing}`">
              <span><span class="font-medium text-sm">{{ t.label }}</span><span class="block text-xs text-base-content/60">{{ t.help }}</span></span>
            </label>
          </div>
        </fieldset>

        <fieldset v-if="page.template === 'image'" class="fieldset">
          <legend class="fieldset-legend">Image de fond</legend>
          <CmsMediaField v-model="page.imageId" :field="{ type: 'image' }" />
          <p class="label whitespace-normal">Le point d'intérêt réglé dans la médiathèque reste visible. Sans image, la page prend le modèle « Sobre ».</p>
        </fieldset>

        <div v-if="multi" role="tablist" class="tabs tabs-border tabs-sm">
          <button
            v-for="l in locales" :key="l" role="tab" type="button" class="tab"
            :class="{ 'tab-active': locale === l }" :aria-selected="locale === l" @click="locale = l"
          >
            {{ languageName(l) }}
          </button>
        </div>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Titre</legend>
          <input v-model="texts.title" class="input w-full" :maxlength="TITLE_MAX" :placeholder="placeholder.title">
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Message</legend>
          <textarea v-model="texts.message" class="textarea w-full" rows="4" :maxlength="MESSAGE_MAX" :placeholder="placeholder.message" />
          <p class="label whitespace-normal">Laissé vide, le texte affiché en gris est utilisé.</p>
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Contact <span class="font-normal text-base-content/50">(facultatif)</span></legend>
          <input v-model="page.contact" class="input w-full" :maxlength="CONTACT_MAX" placeholder="contact@exemple.fr ou 01 23 45 67 89">
          <p class="label whitespace-normal">Une adresse e-mail ou un numéro devient un bouton cliquable. Commun à toutes les langues.</p>
        </fieldset>
      </div>

      <div class="card border border-base-300 overflow-hidden lg:sticky lg:top-20">
        <div class="px-4 py-2 text-xs text-base-content/50 border-b border-base-300 bg-base-100 flex items-center gap-2">
          <span>Aperçu de la page « {{ MODE_LABELS[editing] }} »<template v-if="multi"> · {{ languageName(locale) }}</template></span>
          <div class="join ml-auto">
            <button type="button" class="btn btn-xs join-item" :class="{ 'btn-active': previewWidth === 'desktop' }" @click="previewWidth = 'desktop'">Ordinateur</button>
            <button type="button" class="btn btn-xs join-item" :class="{ 'btn-active': previewWidth === 'mobile' }" @click="previewWidth = 'mobile'">Téléphone</button>
          </div>
        </div>
        <div class="bg-base-300 flex justify-center">
          <iframe
            data-cms-closed-preview :srcdoc="previewHtml" title="Aperçu de la page d'attente" sandbox=""
            class="bg-white h-[34rem] transition-[width]" :class="previewWidth === 'mobile' ? 'w-[390px] max-w-full' : 'w-full'"
          />
        </div>
      </div>
    </div>
  </section>
</template>
