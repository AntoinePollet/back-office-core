<script setup lang="ts">
import { FileText, LayoutList, RotateCcw, Trash2 } from '@lucide/vue'
import { adminEntryPath } from '../../../shared/admin-paths'
import { trashDaysLabel } from '../../../shared/trash'

definePageMeta({ layout: 'admin', middleware: 'cms-auth' })

type Common = { id: string; title: string; deletedAt: string; deletedBy: string | null; daysLeft: number }
type Item = Common & (
  | { kind: 'entry'; type: string; typeLabel: string; wasPublished: boolean; restoresPublished: boolean }
  | { kind: 'media'; mime: string; size: number; thumbnail: string | null; thumbnailPosition?: string | null }
)
type Trash = { items: Item[]; days: number; canPurge: boolean }
type Restored = {
  kind: 'entry' | 'media'; id: string; title: string; type?: string; purgeFailed: boolean
  renamed?: { locale: string; from: string; to: string }[]; asDraft?: boolean; published?: boolean; movedToRoot?: boolean
}

const toast = useCmsToast()
const data = ref(await cmsApi<Trash>('/api/cms/trash').catch((e) => { throw createError({ statusCode: e?.statusCode ?? 500, message: cmsErrorMessage(e), fatal: true }) }))
const refresh = async () => { data.value = await cmsApi<Trash>('/api/cms/trash') }

const tabs = [{ id: 'all', label: 'Tout' }, { id: 'entry', label: 'Contenus' }, { id: 'media', label: 'Fichiers' }] as const
const tab = ref<typeof tabs[number]['id']>('all')
const count = (id: string) => data.value.items.filter(i => id === 'all' || i.kind === id).length
const list = computed(() => data.value.items.filter(i => tab.value === 'all' || i.kind === tab.value))
const busy = ref<string | null>(null)
/** Dernière restauration : ce qui est revenu, où, et ce qui a dû changer. Reste affiché jusqu'à la suivante. */
const restored = ref<{ title: string; text: string; to: string; warn: boolean } | null>(null)

const what = (item: Item) => (item.kind === 'media' ? `le fichier « ${item.title} »` : `« ${item.title} »`)

async function restore(item: Item) {
  // Remettre une page en ligne se confirme ; un brouillon ou un fichier revient sans question.
  const online = item.kind === 'entry' && item.wasPublished && item.restoresPublished
  if (online && !confirm(`Restaurer « ${item.title} » ? Ce contenu était en ligne : il sera de nouveau visible sur le site.`)) return
  busy.value = item.id
  try {
    const r = await cmsApi<Restored>(`/api/cms/trash/${item.id}/restore`, { method: 'POST' })
    const upToDate = cmsSiteUpdated(r)
    const notes: string[] = []
    if (r.kind === 'media') notes.push(r.movedToRoot ? 'Son dossier n\'existe plus : le fichier est à la racine de la médiathèque.' : 'Le fichier a retrouvé sa place dans la médiathèque et dans les contenus qui l\'utilisaient.')
    else {
      if (r.asDraft) notes.push('Il était en ligne et revient en brouillon : demandez sa publication à un éditeur.')
      else if (r.published) notes.push(upToDate ? 'Il est de nouveau en ligne.' : 'Il sera de nouveau en ligne d\'ici une heure.')
      else notes.push('Il revient en brouillon, comme avant sa suppression.')
      for (const change of r.renamed ?? []) notes.push(`Son adresse « ${change.from} » a été reprise entre-temps par un autre contenu : il porte maintenant l'adresse « ${change.to} ».`)
    }
    restored.value = {
      title: r.kind === 'media' ? `Le fichier « ${r.title} » est restauré.` : `« ${r.title} » est restauré.`,
      text: notes.join(' '), warn: !!(r.asDraft || r.renamed?.length || r.movedToRoot),
      to: r.kind === 'media' ? '/admin/media' : adminEntryPath(r.type!, r.id),
    }
    toast.success('Restauré')
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
  busy.value = null
  await refresh().catch(() => {})
}

async function purge(item: Item) {
  if (!confirm(`Supprimer définitivement ${what(item)} ? Cette fois, il ne pourra plus être récupéré.`)) return
  busy.value = item.id
  try {
    await cmsApi(`/api/cms/trash/${item.id}`, { method: 'DELETE' })
    toast.success('Supprimé définitivement')
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
  busy.value = null
  await refresh().catch(() => {})
}

async function empty() {
  const n = data.value.items.length
  if (!confirm(`Vider la corbeille ? ${n > 1 ? `Ses ${n} éléments seront supprimés` : 'Son élément sera supprimé'} définitivement, sans récupération possible.`)) return
  try {
    await cmsApi('/api/cms/trash', { method: 'DELETE' })
    restored.value = null
    toast.success('Corbeille vidée')
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
  await refresh().catch(() => {})
}
</script>

<template>
  <section class="max-w-5xl mx-auto">
    <CmsSiteDelayNotice />
    <div class="flex flex-wrap items-end gap-3 mb-6">
      <div class="min-w-0">
        <h1 class="text-2xl font-bold">Corbeille</h1>
        <p class="text-sm text-base-content/60">
          Ce qui est supprimé reste ici {{ data.days }} jours et peut être restauré. Passé ce délai, c'est supprimé pour de bon.
        </p>
      </div>
      <button v-if="data.canPurge" class="btn btn-sm btn-error btn-soft ml-auto" :disabled="!data.items.length" @click="empty"><Trash2 :size="16" />Vider la corbeille</button>
    </div>

    <div v-if="restored" role="status" class="alert mb-4 text-sm" :class="restored.warn ? 'alert-warning alert-soft' : 'alert-success alert-soft'" data-trash-restored>
      <RotateCcw :size="18" class="shrink-0" />
      <div><span class="font-semibold">{{ restored.title }}</span> {{ restored.text }}</div>
      <NuxtLink :to="restored.to" class="btn btn-sm">Ouvrir</NuxtLink>
    </div>

    <div role="tablist" class="tabs tabs-border tabs-sm mb-3">
      <a v-for="t in tabs" :key="t.id" role="tab" class="tab" :class="{ 'tab-active': tab === t.id }" @click="tab = t.id">
        {{ t.label }} <span class="ml-1.5 opacity-60">{{ count(t.id) }}</span>
      </a>
    </div>

    <div class="card bg-base-100 border border-base-300 overflow-hidden">
      <div v-if="!list.length" class="p-12 text-center text-sm text-base-content/50">
        {{ data.items.length ? 'Rien de ce type dans la corbeille.' : 'La corbeille est vide.' }}
      </div>
      <ul v-else class="divide-y divide-base-300">
        <li v-for="item in list" :key="item.id" class="px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2" data-trash-item>
          <div class="w-10 h-10 rounded-field bg-base-200 overflow-hidden shrink-0 grid place-items-center text-base-content/50">
            <img v-if="item.kind === 'media' && item.thumbnail" :src="item.thumbnail" class="w-full h-full object-cover" :style="{ objectPosition: item.thumbnailPosition ?? undefined }" alt="" loading="lazy">
            <FileText v-else-if="item.kind === 'media'" :size="18" />
            <LayoutList v-else :size="18" />
          </div>
          <div class="min-w-0 grow basis-52">
            <div class="font-medium truncate">{{ item.title || 'Sans titre' }}</div>
            <div class="text-xs text-base-content/60">
              <template v-if="item.kind === 'entry'">{{ item.typeLabel }}<template v-if="item.wasPublished"> · était en ligne</template></template>
              <template v-else>Fichier · {{ formatFileSize(item.size) }}</template>
              · supprimé {{ cmsFormatWhen(item.deletedAt) }}<template v-if="item.deletedBy"> par {{ item.deletedBy }}</template>
            </div>
          </div>
          <span
            class="badge badge-sm badge-soft shrink-0" :class="item.daysLeft <= 3 ? 'badge-warning' : 'badge-ghost'"
            :title="`Supprimé définitivement dans ${item.daysLeft} jour${item.daysLeft > 1 ? 's' : ''}`"
          >{{ trashDaysLabel(item.daysLeft) }}</span>
          <div class="flex gap-1 shrink-0 ml-auto">
            <button class="btn btn-sm" :disabled="busy === item.id" @click="restore(item)"><RotateCcw :size="16" />Restaurer</button>
            <button
              v-if="data.canPurge" class="btn btn-sm btn-ghost btn-square text-error" :disabled="busy === item.id"
              title="Supprimer définitivement" aria-label="Supprimer définitivement" @click="purge(item)"
            >
              <Trash2 :size="16" />
            </button>
          </div>
        </li>
      </ul>
    </div>
    <p v-if="!data.canPurge" class="text-xs text-base-content/50 mt-3">Vous voyez ici ce que vous avez le droit de supprimer. Seul un administrateur peut supprimer définitivement avant la fin du délai.</p>
  </section>
</template>
