<script setup lang="ts">
import type { Component } from 'vue'
import { ExternalLink, FileText, LogOut, Plus, Search, UserRound } from '@lucide/vue'
import type { CmsConfig } from '../../../shared/format'
import { matchScore, searchWords } from '../../../shared/search'

/**
 * Recherche et navigation rapide : le bouton « Rechercher » de la barre du haut et la fenêtre qu'il ouvre (aussi par ⌘K / Ctrl+K).
 * Les écrans proposés sont ceux du menu, reçus tels quels : ils respectent donc déjà le rôle de la personne.
 */
type NavItem = { key: string; label: string; to: string; icon: Component }
type SearchItem = { id: string; type: string; title: string; locale: string; status: string }
type Option = {
  id: string
  label: string
  icon: Component
  /** Précision affichée à droite : type de contenu, groupe du menu. */
  hint?: string
  badges?: { label: string; cls: string }[]
  run: () => unknown
}

const props = defineProps<{ schema: CmsConfig; groups: [string, NavItem[]][] }>()
const emit = defineEmits<{ logout: [] }>()

const dialog = ref<HTMLDialogElement>()
const list = ref<HTMLElement>()
const isOpen = ref(false)
const query = ref('')
const found = ref<SearchItem[]>([])
const more = ref(false)
const loading = ref(false)
const failed = ref(false)
const active = ref(0)

const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
const statusMeta: Record<string, { label: string; cls: string }> = {
  published: { label: 'Publié', cls: 'badge-success' },
  changed: { label: 'Modifications en attente', cls: 'badge-warning' },
  draft: { label: 'Brouillon', cls: 'badge-neutral' },
}

const words = computed(() => searchWords(query.value))
/** La recherche de contenus ne part qu'à partir de deux caractères. */
const searching = computed(() => words.value.join('').length >= 2)

/** Garde les éléments qui correspondent à la saisie, les plus proches d'abord. Sans saisie : tous, dans l'ordre. */
function filter<T>(items: T[], text: (item: T) => string) {
  if (!words.value.length) return items
  return items
    .map(item => ({ item, score: matchScore(text(item), words.value) }))
    .filter((x): x is { item: T; score: number } => x.score !== null)
    .sort((a, b) => a.score - b.score)
    .map(x => x.item)
}

const router = useRouter()

/**
 * Navigation par le routeur : un formulaire aux modifications non enregistrées demande confirmation, comme pour le menu.
 *
 * Cas particulier : d'un formulaire de contenu à un autre (même écran, autre contenu), le routeur considère qu'on ne
 * quitte pas la page et n'appelle pas ses garde-fous de sortie (`onBeforeRouteLeave`). C'est le trajet le plus courant
 * depuis la recherche : on les appelle donc ici. Si la page déclare un jour son propre garde-fou de changement de contenu
 * (`onBeforeRouteUpdate`), le routeur s'en charge et ce passage ne fait plus rien.
 */
async function go(to: string) {
  const from = router.currentRoute.value
  const target = router.resolve(to)
  const record = from.matched.at(-1)
  if (record && target.matched.at(-1) === record && target.fullPath !== from.fullPath && !record.updateGuards.size) {
    for (const guard of record.leaveGuards) {
      const answer = await new Promise<unknown>((resolve) => {
        const result = guard.call(undefined, target as never, from, resolve as never)
        // Un garde-fou répond soit par sa valeur de retour, soit en appelant `next`.
        if (guard.length < 3) resolve(result)
      })
      if (answer === false) return
    }
  }
  return navigateTo(to)
}

const sections = computed(() => {
  const out: { key: string; label: string; options: Option[] }[] = []
  const nav = props.groups.flatMap(([group, items]) => items.map(item => ({ ...item, group })))
  const iconOf = (type: string) => nav.find(n => n.key === type)?.icon ?? FileText

  const contents = found.value.map((item): Option => {
    const def = props.schema.collections?.[item.type]
    const badges = []
    if (props.schema.site.locales.length > 1 && item.locale !== props.schema.site.defaultLocale)
      badges.push({ label: item.locale.toUpperCase(), cls: 'badge-ghost' })
    if (def?.drafts && statusMeta[item.status]) badges.push(statusMeta[item.status]!)
    return { id: `content-${item.id}`, label: item.title, icon: iconOf(item.type), hint: def?.labelSingular ?? def?.label, badges, run: () => go(`/admin/${item.type}/${item.id}`) }
  })
  if (contents.length) out.push({ key: 'contents', label: more.value ? `Contenus (les ${contents.length} premiers)` : 'Contenus', options: contents })

  const screens = filter(nav, n => n.label).map((n): Option => ({ id: `nav-${n.key}`, label: n.label, icon: n.icon, hint: n.group, run: () => go(n.to) }))
  if (screens.length) out.push({ key: 'nav', label: 'Aller à', options: screens })

  const actions: (Option & { text: string })[] = [
    ...Object.entries(props.schema.collections ?? {}).map(([type, def]) => {
      const label = `Ajouter : ${def.labelSingular ?? def.label}`
      return { id: `new-${type}`, label, text: `${label} nouveau créer ${def.label}`, icon: Plus, run: () => go(`/admin/${type}/new`) }
    }),
    { id: 'act-site', label: 'Voir le site', text: 'Voir le site ouvrir', icon: ExternalLink, hint: 'Nouvel onglet', run: () => window.open('/', '_blank', 'noopener') },
    { id: 'act-account', label: 'Mon compte', text: 'Mon compte mot de passe profil', icon: UserRound, run: () => go('/admin/account') },
    { id: 'act-logout', label: 'Se déconnecter', text: 'Se déconnecter déconnexion quitter', icon: LogOut, run: () => emit('logout') },
  ]
  const matching = filter(actions, a => a.text)
  if (matching.length) out.push({ key: 'actions', label: 'Actions', options: matching })
  return out
})

const options = computed(() => sections.value.flatMap(s => s.options))
const activeId = computed(() => (options.value[active.value] ? `cms-palette-${options.value[active.value]!.id}` : undefined))
const count = computed(() => (options.value.length ? `${options.value.length} résultat${options.value.length > 1 ? 's' : ''}` : 'Aucun résultat'))

// ───────────── Recherche de contenus : une requête après une courte pause dans la frappe ─────────────

let timer: ReturnType<typeof setTimeout> | undefined
let request: AbortController | undefined

watch(query, () => {
  clearTimeout(timer)
  request?.abort()
  active.value = 0
  failed.value = false
  if (!searching.value) { found.value = []; more.value = false; loading.value = false; return }
  loading.value = true
  const q = query.value
  timer = setTimeout(async () => {
    const mine = request = new AbortController()
    try {
      const result = await cmsApi<{ items: SearchItem[]; more: boolean }>('/api/cms/search', { query: { q }, signal: mine.signal })
      if (mine.signal.aborted) return
      found.value = result.items
      more.value = result.more
      active.value = 0
    }
    catch {
      if (mine.signal.aborted) return
      found.value = []
      failed.value = true
    }
    loading.value = false
  }, 180)
})

// ───────────── Ouverture, fermeture, clavier ─────────────

async function show() {
  if (isOpen.value) return
  // Pas par-dessus une autre fenêtre (médiathèque, invitation…) : on ne quitte pas un travail en cours sans le voir.
  if (document.querySelector('.modal.modal-open, dialog[open]')) return
  isOpen.value = true
  // Le contenu doit être affiché avant l'ouverture, pour que le curseur se place dans le champ de recherche.
  await nextTick()
  // showModal rend le reste de la page inactif (le focus reste dans la fenêtre) et, à la fermeture,
  // le navigateur rend le focus à l'élément qui l'avait.
  dialog.value?.showModal()
}
function close() {
  dialog.value?.close()
}
function onClosed() {
  isOpen.value = false
  clearTimeout(timer)
  request?.abort()
  query.value = ''
  found.value = []
  loading.value = false
}

function run(option: Option | undefined) {
  if (!option) return
  close()
  option.run()
}

function move(step: number) {
  const n = options.value.length
  if (!n) return
  active.value = (active.value + step + n) % n
  nextTick(() => list.value?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }))
}

function onInputKey(e: KeyboardEvent) {
  // Pendant la composition d'un caractère (accent, saisie asiatique), les touches appartiennent au clavier.
  if (e.isComposing) return
  if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
  else if (e.key === 'Enter') { e.preventDefault(); run(options.value[active.value]) }
}

/**
 * ⌘K sur Mac, Ctrl+K ailleurs : le raccourci comporte toujours une touche de commande, il ne gêne donc jamais la saisie
 * et fonctionne aussi quand le curseur est dans un champ. Sur Mac, Ctrl+K reste au système (il efface la fin de la ligne).
 */
function onShortcut(e: KeyboardEvent) {
  if (e.key.toLowerCase() !== 'k' || e.altKey || e.shiftKey || e.isComposing) return
  if (isMac ? !e.metaKey || e.ctrlKey : !e.ctrlKey || e.metaKey) return
  e.preventDefault()
  if (e.repeat) return
  if (isOpen.value) close()
  else show()
}
onMounted(() => window.addEventListener('keydown', onShortcut))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onShortcut)
  clearTimeout(timer)
  request?.abort()
})
</script>

<template>
  <button
    type="button" class="btn btn-sm btn-ghost bg-base-200 font-normal text-base-content/60 justify-start gap-2 max-sm:btn-square sm:w-64"
    aria-label="Rechercher" aria-haspopup="dialog" :aria-keyshortcuts="isMac ? 'Meta+K' : 'Control+K'" :title="`Rechercher (${isMac ? '⌘K' : 'Ctrl+K'})`" @click="show"
  >
    <Search :size="16" class="shrink-0" />
    <span class="max-sm:hidden">Rechercher…</span>
    <kbd class="kbd kbd-sm ml-auto max-sm:hidden">{{ isMac ? '⌘K' : 'Ctrl K' }}</kbd>
  </button>

  <dialog ref="dialog" class="modal items-start pt-[10vh] px-4" aria-label="Recherche et navigation rapide" @close="onClosed">
    <div v-if="isOpen" class="modal-box w-full max-w-xl p-0 flex flex-col max-h-[min(32rem,75vh)] overflow-hidden">
      <div class="flex items-center gap-3 px-4 border-b border-base-300">
        <span v-if="loading" class="loading loading-spinner loading-xs shrink-0" aria-hidden="true" />
        <Search v-else :size="18" class="shrink-0 text-base-content/50" aria-hidden="true" />
        <input
          v-model="query" type="text" class="grow h-14 bg-transparent outline-none text-base min-w-0" placeholder="Chercher un contenu, un écran, une action…"
          role="combobox" aria-label="Rechercher" aria-autocomplete="list" aria-expanded="true" aria-controls="cms-palette-list" :aria-activedescendant="activeId"
          autocomplete="off" autocapitalize="off" spellcheck="false" autofocus @keydown="onInputKey"
        >
        <button type="button" class="btn btn-ghost btn-xs" aria-label="Fermer la recherche" @click="close"><kbd class="kbd kbd-sm">Échap</kbd></button>
      </div>

      <p v-if="!searching" class="px-5 pt-3 text-xs text-base-content/50">Tapez au moins deux lettres pour chercher un contenu par son titre.</p>
      <div id="cms-palette-list" ref="list"role="listbox" aria-label="Résultats" class="overflow-y-auto p-2 grow">
        <div v-for="section in sections" :key="section.key" role="group" :aria-labelledby="`cms-palette-group-${section.key}`" class="mb-1 last:mb-0">
          <div :id="`cms-palette-group-${section.key}`" class="px-3 pt-2 pb-1 text-xs font-semibold text-base-content/50">{{ section.label }}</div>
          <div
            v-for="option in section.options" :id="`cms-palette-${option.id}`" :key="option.id" role="option" :aria-selected="option === options[active]"
            class="flex items-center gap-3 px-3 py-2 rounded-field text-sm cursor-pointer aria-selected:bg-primary/10 aria-selected:text-primary"
            @mousemove="active = options.indexOf(option)" @click="run(option)"
          >
            <component :is="option.icon" :size="16" class="shrink-0 opacity-70" aria-hidden="true" />
            <span class="truncate grow">{{ option.label }}</span>
            <span v-for="badge in option.badges" :key="badge.label" class="badge badge-sm badge-soft shrink-0" :class="badge.cls">{{ badge.label }}</span>
            <span v-if="option.hint" class="text-xs text-base-content/50 shrink-0">{{ option.hint }}</span>
          </div>
        </div>

        <p v-if="failed" class="px-3 py-2 text-sm text-error">La recherche de contenus n'a pas abouti. Réessayez dans un instant.</p>
        <div v-else-if="!options.length && !loading" class="px-3 py-8 text-center text-sm">
          <p class="font-medium">Aucun résultat pour « {{ query.trim() }} »</p>
          <p class="text-base-content/60 mt-1">Essayez un autre mot du titre, ou seulement son début. La recherche porte sur les titres des contenus, dans toutes les langues.</p>
        </div>
        <p v-else-if="searching && !loading && !found.length" class="px-3 py-2 text-xs text-base-content/50">Aucun contenu n'a ce texte dans son titre.</p>
      </div>

      <div class="flex items-center gap-4 px-4 py-2 border-t border-base-300 text-xs text-base-content/50 max-sm:hidden" aria-hidden="true">
        <span><kbd class="kbd kbd-xs">↑</kbd> <kbd class="kbd kbd-xs">↓</kbd> choisir</span>
        <span><kbd class="kbd kbd-xs">Entrée</kbd> ouvrir</span>
        <span><kbd class="kbd kbd-xs">Échap</kbd> fermer</span>
      </div>
      <div class="sr-only" role="status">{{ loading ? 'Recherche en cours' : count }}</div>
    </div>
    <form method="dialog" class="modal-backdrop"><button tabindex="-1" aria-label="Fermer la recherche">Fermer</button></form>
  </dialog>
</template>
