<script setup lang="ts">
import type { CmsMedia } from '../../composables/useCms'

definePageMeta({ layout: 'admin', middleware: 'cms-auth' })

type Usage = { id: string; type: string; label: string; title: string }

const schema = await useCmsSchema()
const { items } = useCmsMedia()
const toast = useCmsToast()
const locales = schema.value.site.locales as readonly string[]
const localeName = (l: string) => new Intl.DisplayNames(['fr'], { type: 'language' }).of(l) ?? l

const selected = ref<CmsMedia | null>(null)
const alt = ref<Record<string, string>>({})
const usage = ref<Usage[] | null>(null)
const totalSize = computed(() => (items.value ?? []).reduce((n, m) => n + m.size, 0))

async function select(media: CmsMedia) {
  selected.value = media
  alt.value = { ...media.alt }
  usage.value = null
  usage.value = await cmsApi<Usage[]>(`/api/cms/media/${media.id}/usage`).catch(() => [])
}

async function saveAlt() {
  const media = selected.value
  if (!media || locales.every(l => (alt.value[l] ?? '') === (media.alt[l] ?? ''))) return
  try {
    const { purgeFailed, ...updated } = await cmsApi<CmsMedia & { purgeFailed: boolean }>(`/api/cms/media/${media.id}`, { method: 'PATCH', body: { alt: alt.value } })
    cmsSiteUpdated({ purgeFailed })
    items.value = (items.value ?? []).map(m => (m.id === updated.id ? updated : m))
    if (selected.value?.id === updated.id) selected.value = updated
    toast.success('Texte alternatif enregistré')
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
}

async function remove() {
  const media = selected.value
  if (!media) return
  const used = usage.value?.length ?? 0
  const question = used
    ? `Ce fichier est utilisé par ${used} contenu${used > 1 ? 's' : ''}. Il disparaîtra de ces pages. Supprimer quand même ?`
    : 'Supprimer définitivement ce fichier ?'
  if (!confirm(question)) return
  try {
    cmsSiteUpdated(await cmsApi(`/api/cms/media/${media.id}`, { method: 'DELETE', query: used ? { force: 1 } : {} }))
    items.value = (items.value ?? []).filter(m => m.id !== media.id)
    selected.value = null
    toast.success('Fichier supprimé')
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
}

async function copyUrl() {
  await navigator.clipboard.writeText(location.origin + selected.value!.url).then(() => toast.success('Adresse copiée'), () => toast.error('Copie impossible.'))
}
</script>

<template>
  <section class="max-w-6xl mx-auto">
    <CmsSiteDelayNotice />
    <div class="mb-6">
      <h1 class="text-2xl font-bold">Médiathèque</h1>
      <p class="text-sm text-base-content/60">{{ items?.length ?? 0 }} fichier{{ (items?.length ?? 0) > 1 ? 's' : '' }} · {{ formatFileSize(totalSize) }}</p>
    </div>

    <div class="grid lg:grid-cols-[1fr_20rem] gap-6 items-start">
      <div class="card bg-base-100 border border-base-300 p-4">
        <CmsMediaLibrary :selected-id="selected?.id" @select="select" />
      </div>

      <aside class="card bg-base-100 border border-base-300 p-4 text-sm lg:sticky lg:top-20">
        <div v-if="!selected" class="text-base-content/50 py-10 text-center">Sélectionnez un fichier pour voir ses détails.</div>
        <div v-else class="space-y-3">
          <img v-if="selected.mime.startsWith('image/')" :src="cmsImageUrl(selected, 640)" class="rounded-field w-full max-h-56 object-contain bg-base-200" alt="">
          <div class="font-semibold break-all">{{ selected.name }}</div>
          <div class="text-base-content/60">
            <template v-if="selected.width">{{ selected.width }} × {{ selected.height }} px · </template>{{ formatFileSize(selected.size) }}
          </div>

          <fieldset v-for="l in locales" :key="l" class="fieldset">
            <legend class="fieldset-legend">Texte alternatif<template v-if="locales.length > 1"> ({{ localeName(l) }})</template></legend>
            <textarea v-model="alt[l]" class="textarea textarea-sm w-full" rows="2" placeholder="Décrivez l'image pour les lecteurs d'écran et Google" @blur="saveAlt" />
          </fieldset>

          <div>
            <div class="text-base-content/60 mb-1">Utilisé dans</div>
            <div v-if="usage === null" class="text-base-content/50">Recherche…</div>
            <div v-else-if="usage.length" class="flex flex-wrap gap-1">
              <NuxtLink v-for="u in usage" :key="u.id" :to="`/admin/${u.type}/${u.id}`" class="badge badge-sm badge-ghost">{{ u.title }}</NuxtLink>
            </div>
            <div v-else class="text-base-content/50">Aucun contenu. Peut être supprimé sans risque.</div>
          </div>

          <div class="flex gap-2 pt-1">
            <button class="btn btn-sm grow" @click="copyUrl">Copier l'adresse</button>
            <button class="btn btn-sm btn-error btn-soft" @click="remove">Supprimer</button>
          </div>
        </div>
      </aside>
    </div>
  </section>
</template>
