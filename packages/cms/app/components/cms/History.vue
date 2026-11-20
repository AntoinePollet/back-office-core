<script setup lang="ts">
import { RotateCcw } from '@lucide/vue'
import { MAX_REVISIONS } from '../../../shared/content'

/**
 * Historique d'un contenu : la liste des versions enregistrées, ce que chacune contenait, et le retour à l'une d'elles.
 * Restaurer ne publie jamais : la version revient comme brouillon (ou, sans brouillons, dans le formulaire à enregistrer).
 */
type Snapshot = { shared: Record<string, any>; locales: Record<string, { slug: string | null; values: Record<string, any> }> }
type Revision = {
  id: string; version: number; createdAt: string; author: string | null
  changed: string[]; published: string[]; unpublished: string[]; origin: 'restore' | 'duplicate' | 'initial' | 'schedule' | null
}

const props = defineProps<{
  type: string
  id: string
  def: Record<string, any>
  locales: readonly string[]
  defaultLocale: string
  /** Le formulaire contient des modifications non enregistrées : restaurer les remplacerait. */
  dirty: boolean
}>()
const emit = defineEmits<{
  close: []
  /** Version restaurée comme brouillon : le contenu renvoyé par le serveur. */
  restored: [doc: any]
  /** Sans brouillons : la version est à reprendre dans le formulaire, sans enregistrement. */
  load: [snapshot: Snapshot]
}>()

const toast = useCmsToast()
const multi = props.locales.length > 1
const base = `/api/cms/entries/${props.type}/${props.id}/revisions`
const list = ref<Revision[] | null>(null)
const selected = ref<Revision | null>(null)
const snapshot = ref<Snapshot | null>(null)
const locale = ref(props.defaultLocale)
const busy = ref(false)

const localeName = (l: string) => new Intl.DisplayNames(['fr'], { type: 'language' }).of(l) ?? l
const partName = (p: string) => (p === 'shared' ? 'champs communs' : localeName(p))
const langs = (codes: string[]) => (multi && codes.length ? ` (${codes.map(localeName).join(', ')})` : '')
/** Ce que cet enregistrement a fait, en clair. */
function summary(r: Revision) {
  if (r.origin === 'initial') return 'Version d\'origine'
  const what = r.origin === 'restore' ? 'Restauration d\'une version' : r.origin === 'duplicate' ? 'Copie d\'un autre contenu' : r.origin === 'schedule' ? 'Publication programmée' : null
  const parts: string[] = []
  if (r.published.length) parts.push(`Publication${langs(r.published)}`)
  if (r.unpublished.length) parts.push(`Retrait du site${langs(r.unpublished)}`)
  if (!parts.length) parts.push(what ?? (props.def.drafts ? 'Brouillon enregistré' : 'Enregistrement'))
  else if (what) parts.unshift(what)
  return parts.join(' · ')
}
const snapshotLocales = computed(() => props.locales.filter(l => snapshot.value?.locales[l]))

async function select(r: Revision) {
  selected.value = r
  snapshot.value = null
  try {
    const detail = await cmsApi<{ snapshot: Snapshot }>(`${base}/${r.id}`)
    if (selected.value?.id !== r.id) return
    // Le référencement est toujours présent dans le formulaire, même vide.
    for (const l of Object.values(detail.snapshot.locales)) l.values.seo ??= {}
    snapshot.value = detail.snapshot
    if (!detail.snapshot.locales[locale.value]) locale.value = props.locales.find(l => detail.snapshot.locales[l]) ?? props.defaultLocale
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
}

async function restore() {
  const r = selected.value
  if (!r || !snapshot.value) return
  if (props.dirty && !confirm('Vos modifications non enregistrées seront remplacées par cette version. Continuer ?')) return
  if (!props.def.drafts) return emit('load', snapshot.value)
  busy.value = true
  try {
    emit('restored', await cmsApi(`${base}/${r.id}/restore`, { method: 'POST' }))
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
  busy.value = false
}

onMounted(async () => {
  try {
    list.value = await cmsApi<Revision[]>(base)
    if (list.value[0]) await select(list.value[0])
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
    emit('close')
  }
})
</script>

<template>
  <div class="modal modal-open" data-cms-history>
    <div class="modal-box max-w-5xl">
      <h3 class="font-bold text-lg">Historique</h3>
      <p class="text-sm text-base-content/60 mb-4">
        Les {{ MAX_REVISIONS }} derniers enregistrements sont gardés ici. Vous pouvez revoir une version et y revenir.
      </p>

      <div v-if="!list" class="py-12 text-center"><span class="loading loading-spinner" /></div>
      <div v-else-if="!list.length" class="py-12 text-center text-base-content/50">Aucune version pour le moment : l'historique commence au prochain enregistrement.</div>
      <div v-else class="grid gap-4 md:grid-cols-[17rem_1fr] items-start">
        <ul class="menu w-full p-0 gap-0.5 max-h-[60vh] overflow-y-auto flex-nowrap">
          <li v-for="(r, i) in list" :key="r.id">
            <a class="block space-y-0.5" :class="{ 'menu-active': selected?.id === r.id }" @click="select(r)">
              <div class="font-medium first-letter:uppercase">
                {{ cmsFormatWhen(r.createdAt) }}
                <span v-if="i === 0" class="badge badge-xs badge-soft badge-success ml-1 align-middle">Version actuelle</span>
              </div>
              <div class="text-xs opacity-70">{{ summary(r) }}</div>
              <div class="text-xs opacity-70">
                {{ r.author ?? (r.origin === 'initial' ? 'Avant l\'historique' : 'Auteur inconnu') }}<template v-if="multi && r.changed.length"> · {{ r.changed.map(partName).join(', ') }}</template>
              </div>
            </a>
          </li>
        </ul>

        <div class="min-w-0">
          <div v-if="!snapshot" class="py-12 text-center"><span class="loading loading-spinner" /></div>
          <template v-else>
            <div v-if="multi" role="tablist" class="tabs tabs-box tabs-xs w-fit mb-3">
              <a v-for="l in snapshotLocales" :key="l" role="tab" class="tab uppercase" :class="{ 'tab-active': locale === l }" @click="locale = l">{{ l }}</a>
            </div>
            <!-- Les champs du formulaire, en lecture seule : la version s'affiche comme elle était saisie. -->
            <fieldset disabled class="pointer-events-none border border-base-300 rounded-box p-4 max-h-[52vh] overflow-y-auto space-y-4" data-cms-history-preview>
              <CmsFields :fields="def.fields" :shared="snapshot.shared" :values="snapshot.locales[locale]?.values ?? {}" scope="all" />
              <div v-if="snapshot.locales[locale]?.slug && def.path" class="text-sm">
                <span class="text-base-content/60">Adresse de la page à ce moment-là :</span> {{ def.path.replace('[slug]', snapshot.locales[locale]!.slug) }}
              </div>
              <div v-if="def.seo && (snapshot.locales[locale]?.values.seo?.title || snapshot.locales[locale]?.values.seo?.description)" class="text-sm space-y-1">
                <div class="font-semibold">Référencement</div>
                <div v-if="snapshot.locales[locale]!.values.seo.title"><span class="text-base-content/60">Titre :</span> {{ snapshot.locales[locale]!.values.seo.title }}</div>
                <div v-if="snapshot.locales[locale]!.values.seo.description"><span class="text-base-content/60">Description :</span> {{ snapshot.locales[locale]!.values.seo.description }}</div>
              </div>
            </fieldset>
          </template>
        </div>
      </div>

      <div class="modal-action items-center">
        <p v-if="selected && list && selected.id !== list[0]?.id" class="text-xs text-base-content/60 mr-auto max-w-md">
          <template v-if="def.drafts">Restaurer ne publie rien : la version revient comme brouillon{{ multi ? ', dans toutes les langues' : '' }}. Vous la relisez, puis vous publiez.</template>
          <template v-else>La version est reprise dans le formulaire. Elle n'est mise en ligne que lorsque vous enregistrez.</template>
        </p>
        <button type="button" class="btn" @click="emit('close')">Fermer</button>
        <button
          v-if="selected && list && selected.id !== list[0]?.id" type="button" class="btn btn-primary" :disabled="busy || !snapshot" @click="restore"
        >
          <RotateCcw :size="16" />{{ def.drafts ? 'Restaurer comme brouillon' : 'Reprendre dans le formulaire' }}
        </button>
      </div>
    </div>
    <div class="modal-backdrop" @click="emit('close')" />
  </div>
</template>
