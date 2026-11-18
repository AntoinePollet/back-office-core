<script setup lang="ts">
import { Copy, GripVertical, Plus, Search } from '@lucide/vue'
// Une page unique n'a pas de liste : son formulaire s'affiche directement à /admin/<type>.
import EntryEditor from './[id].vue'

definePageMeta({ layout: 'admin', middleware: 'cms-auth' })

type Item = { id: string; title: string; slug: string | null; thumbnail: string | null; values: Record<string, unknown>; statuses: Record<string, string>; review?: boolean; updatedAt: string }

const route = useRoute()
const type = route.params.type as string
const schema = await useCmsSchema()

const singleton = !!schema.value.singletons?.[type]
const def = schema.value.collections?.[type]
if (!def && !schema.value.singletons?.[type]) throw createError({ statusCode: 404, message: 'Type de contenu inconnu.', fatal: true })

const locales = schema.value.site.locales as readonly string[]
const columns = (def?.list?.columns ?? []) as string[]
const items = ref<Item[]>(def ? await cmsApi<Item[]>(`/api/cms/entries/${type}`) : [])

const search = ref('')
const filter = ref<'all' | 'published' | 'draft'>('all')
const isPublished = (item: Item) => Object.values(item.statuses).some(s => s !== 'draft')
const matches = (item: Item, f: string) => f === 'all' || (f === 'published') === isPublished(item)
const filters = [{ id: 'all', label: 'Tous' }, { id: 'published', label: 'Publiés' }, { id: 'draft', label: 'Brouillons' }] as const
const filtered = computed(() => items.value.filter(i => matches(i, filter.value) && i.title.toLowerCase().includes(search.value.toLowerCase())))

const statusMeta: Record<string, { label: string; cls: string }> = {
  published: { label: 'Publié', cls: 'badge-success' },
  changed: { label: 'Modifications en attente', cls: 'badge-warning' },
  draft: { label: 'Brouillon', cls: 'badge-neutral' },
}
const mainStatus = (item: Item) => item.statuses[schema.value.site.defaultLocale] ?? Object.values(item.statuses)[0] ?? 'draft'

function display(key: string, value: unknown) {
  const field = def?.fields[key] as Record<string, any> | undefined
  if (value == null || value === '') return '—'
  if (field?.type === 'boolean') return value ? 'Oui' : 'Non'
  if (field?.type === 'select') {
    const label = (v: unknown) => field.options.find((o: any) => o.value === v)?.label ?? v
    return Array.isArray(value) ? value.map(label).join(', ') : label(value)
  }
  return String(value)
}
// Ordre manuel : possible seulement quand toute la liste est affichée.
const toast = useCmsToast()
const access = useCmsAccess(type)
// L'ordre s'applique au site tout de suite : il demande le droit de publier.
const canDrag = computed(() => !!def?.orderable && access.publish && filter.value === 'all' && !search.value)
const dragId = ref<string | null>(null)
let orderBefore = ''
function dragStart(item: Item, e: DragEvent) {
  dragId.value = item.id
  orderBefore = items.value.map(i => i.id).join()
  e.dataTransfer!.effectAllowed = 'move'
}
function dragOver(target: Item) {
  if (!dragId.value || dragId.value === target.id) return
  const list = items.value
  const from = list.findIndex(i => i.id === dragId.value)
  list.splice(list.findIndex(i => i.id === target.id), 0, list.splice(from, 1)[0]!)
}
async function dragEnd() {
  dragId.value = null
  const ids = items.value.map(i => i.id)
  if (ids.join() === orderBefore) return
  try {
    cmsSiteUpdated(await cmsApi(`/api/cms/entries/${type}/order`, { method: 'PUT', body: { ids } }))
    toast.success('Ordre enregistré')
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
    items.value = await cmsApi<Item[]>(`/api/cms/entries/${type}`)
  }
}

const duplicating = ref<string | null>(null)
/** Duplique un contenu et ouvre le formulaire de la copie. */
async function duplicate(item: Item) {
  duplicating.value = item.id
  try {
    const to = await cmsDuplicate(type, item.id, !!def?.drafts)
    if (def?.drafts) toast.success('Copie créée en brouillon')
    await navigateTo(to)
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
  duplicating.value = null
}

const formatDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
</script>

<template>
  <EntryEditor v-if="singleton" />
  <section v-else-if="def" class="max-w-6xl mx-auto">
    <CmsSiteDelayNotice />
    <div class="flex flex-wrap items-end gap-3 mb-6">
      <div>
        <h1 class="text-2xl font-bold">{{ def.label }}</h1>
        <p class="text-sm text-base-content/60">
          {{ items.length }} élément{{ items.length > 1 ? 's' : '' }}<template v-if="def.orderable"> · glissez les lignes pour changer l'ordre sur le site</template>
        </p>
      </div>
      <NuxtLink :to="`/admin/${type}/new`" class="btn btn-primary ml-auto"><Plus :size="18" />Ajouter</NuxtLink>
    </div>

    <div class="flex flex-wrap items-center gap-3 mb-3">
      <div v-if="def.drafts" role="tablist" class="tabs tabs-border tabs-sm">
        <a v-for="f in filters" :key="f.id" role="tab" class="tab" :class="{ 'tab-active': filter === f.id }" @click="filter = f.id">
          {{ f.label }} <span class="ml-1.5 opacity-60">{{ items.filter(i => matches(i, f.id)).length }}</span>
        </a>
      </div>
      <label class="input input-sm ml-auto w-full sm:w-64"><Search :size="16" class="opacity-50" /><input v-model="search" type="search" class="grow" placeholder="Filtrer par titre"></label>
    </div>

    <div class="card bg-base-100 border border-base-300 overflow-x-auto">
      <table class="table">
        <thead>
          <tr>
            <th v-if="def.orderable" class="w-8" />
            <th>{{ def.fields[def.titleField]?.label }}</th>
            <th v-for="c in columns" :key="c">{{ def.fields[c]?.label }}</th>
            <th v-if="locales.length > 1">Langues</th>
            <th v-if="def.drafts">Statut</th>
            <th class="text-right">Modifié</th>
            <th class="w-8" />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in filtered" :key="item.id" class="hover:bg-base-200 cursor-pointer" :class="{ 'opacity-40': dragId === item.id }"
            :draggable="canDrag" @dragstart="dragStart(item, $event)" @dragover.prevent="dragOver(item)" @dragend="dragEnd"
            @click="navigateTo(`/admin/${type}/${item.id}`)"
          >
            <td
              v-if="def.orderable" class="text-base-content/40 select-none" :class="canDrag ? 'cursor-grab' : 'opacity-30'"
              :title="canDrag ? 'Glisser pour déplacer' : 'Retirez le filtre et la recherche pour changer l\'ordre'"
            >
              <GripVertical :size="16" />
            </td>
            <td>
              <div class="flex items-center gap-3">
                <div v-if="def.list?.thumbnail" class="w-12 h-9 rounded-field bg-base-300 overflow-hidden shrink-0">
                  <img v-if="item.thumbnail" :src="item.thumbnail" class="w-full h-full object-cover" alt="">
                </div>
                <div class="min-w-0">
                  <div class="font-medium truncate">{{ item.title || 'Sans titre' }}</div>
                  <div v-if="item.slug && def.path" class="text-xs text-base-content/50 truncate">{{ def.path.replace('[slug]', item.slug) }}</div>
                </div>
              </div>
            </td>
            <td v-for="c in columns" :key="c" class="text-sm">{{ display(c, item.values[c]) }}</td>
            <td v-if="locales.length > 1">
              <div class="flex gap-1">
                <span v-for="l in locales" :key="l" class="badge badge-xs uppercase" :class="item.statuses[l] ? 'badge-neutral' : 'badge-outline opacity-40'">{{ l }}</span>
              </div>
            </td>
            <td v-if="def.drafts">
              <span class="badge badge-sm badge-soft" :class="statusMeta[mainStatus(item)]?.cls">{{ statusMeta[mainStatus(item)]?.label }}</span>
              <span v-if="item.review" class="badge badge-sm badge-info badge-soft ml-1" title="Quelqu'un a demandé la publication de ce contenu">Publication demandée</span>
            </td>
            <td class="text-right text-sm text-base-content/60 whitespace-nowrap">{{ formatDate(item.updatedAt) }}</td>
            <td class="pl-0">
              <button
                type="button" class="btn btn-ghost btn-xs btn-square" title="Dupliquer" aria-label="Dupliquer"
                :disabled="duplicating === item.id" @click.stop="duplicate(item)"
              >
                <Copy :size="14" />
              </button>
            </td>
          </tr>
          <tr v-if="!filtered.length">
            <td :colspan="columns.length + 6" class="text-center py-12 text-base-content/50">
              {{ items.length ? 'Aucun élément ne correspond à ce filtre.' : 'Aucun élément pour le moment.' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
