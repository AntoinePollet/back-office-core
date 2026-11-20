<script setup lang="ts">
import type { Component } from 'vue'
import { ArrowLeftRight, CalendarClock, ChartLine, ClipboardCheck, Construction, CreditCard, DatabaseBackup, ExternalLink, FileSearch, FileText, Folder, Images, Inbox, LayoutList, LogOut, Menu, Palette, Puzzle, ScrollText, SearchCheck, Settings, ShieldCheck, Signpost, Trash2, Users, Workflow } from '@lucide/vue'
import configIcons from '#cms-icons'
import { roleLabel } from '../../shared/access'
import { type AvailabilityMode, MODE_LABELS } from '../../shared/availability'
import { adminEntryPath } from '../../shared/admin-paths'
import { canOpenTrash } from '../../shared/trash'
import '../assets/css/admin.css'

const schema = await useCmsSchema()
const user = useCmsUser()
const route = useRoute()
const cmsVersion = useRuntimeConfig().public.cmsVersion

// Demandes de publication qui concernent la personne, relues à chaque changement d'écran.
const reviews = useState<unknown[]>('cms-reviews', () => [])
watch(() => route.fullPath, async () => { reviews.value = await cmsApi<unknown[]>('/api/cms/reviews').catch(() => reviews.value) }, { immediate: true })
// Mises en ligne et retraits programmés : lus à l'ouverture, puis tenus à jour par le formulaire et l'écran « Programmé ».
const scheduled = useState<unknown[]>('cms-scheduled', () => [])
onMounted(() => cmsApi<{ items: unknown[] }>('/api/cms/schedules').then((r) => { scheduled.value = r.items }, () => {}))
// Module « Formulaires » : messages reçus non lus, pour qui peut les lire (administrateur, éditeur).
// Modules actifs (déclarés ou activés dans le back-office), relus quand on en active ou désactive un.
const hasModule = (test: (m: { id: string; category?: string }) => boolean) => !!schema.value.modules?.some(m => test(m as { id: string; category?: string }))
const hasForms = computed(() => hasModule(m => m.id === 'forms') && ['admin', 'editor'].includes(user.value?.role ?? ''))
const unreadMessages = useCmsUnreadMessages()
watch(() => route.fullPath, () => { if (hasForms.value) refreshCmsUnreadMessages() }, { immediate: true })
// Site fermé au public (écran « Disponibilité ») : rappelé dans l'en-tête, et « Voir le site » ouvre l'aperçu.
const siteMode = useState<AvailabilityMode | null>('cms-site-mode', () => null)
onMounted(() => cmsApi<{ mode: AvailabilityMode }>('/api/cms/availability').then((r) => { siteMode.value = r.mode }, () => {}))
const siteClosed = computed(() => !!siteMode.value && siteMode.value !== 'online')
const { toasts } = useCmsToast()

type NavItem = { key: string; label: string; to: string; icon: Component; count?: number }
/** Dossier repliable du menu. `open` : ouvert tant que la personne ne l'a pas replié. */
type NavFolder = { folder: true; key: string; label: string; icon: Component; items: NavItem[]; open: boolean }
type NavSection = { title?: string; nodes: (NavItem | NavFolder)[] }
const isFolder = (node: NavItem | NavFolder): node is NavFolder => 'folder' in node

/**
 * Le menu : des sections (titre facultatif) faites d'entrées et de dossiers repliables.
 * - À faire : demandes à valider, contenus programmés (seulement s'il y en a) ;
 * - Contenus : un dossier par groupe de cms.config.ts (`group`, sinon « Pages » et « Collections ») ;
 * - Outils : ce qu'on consulte souvent (médiathèque, messages, audience, paiements). Pas « Site » : c'est souvent
 *   déjà le nom d'un groupe de contenus ;
 * - puis Référencement, Réglages et Administration, repliés par défaut.
 * Une entrée n'apparaît que pour qui y a droit ; un dossier vide n'apparaît pas.
 */
const nav = computed<NavSection[]>(() => {
  const role = user.value?.role ?? ''
  const isAdmin = role === 'admin'
  const staff = isAdmin || role === 'editor'
  const sections: NavSection[] = []
  const folder = (key: string, label: string, icon: Component, items: (NavItem | false)[], open = false): NavFolder =>
    ({ folder: true, key, label, icon, items: items.filter((i): i is NavItem => !!i), open })

  // Demandes de publication et programmations : la section n'apparaît que s'il y en a, pour ne pas encombrer le menu.
  const todo: NavItem[] = []
  if (reviews.value.length) todo.push({ key: 'reviews', label: 'À valider', icon: ClipboardCheck, to: '/admin/reviews', count: reviews.value.length })
  if (scheduled.value.length) todo.push({ key: 'scheduled', label: 'Programmé', icon: CalendarClock, to: '/admin/scheduled', count: scheduled.value.length })
  if (todo.length) sections.push({ title: 'À faire', nodes: todo })

  const all = [...Object.entries(schema.value.singletons ?? {}), ...Object.entries(schema.value.collections ?? {})]
  const contents = new Map<string, NavItem[]>()
  for (const [key, def] of all) {
    const group = def.group ?? (def.kind === 'singleton' ? 'Pages' : 'Collections')
    // Icône choisie dans cms.config.ts (nom Lucide), sinon une icône selon la nature du contenu.
    const icon = (def.icon && configIcons[def.icon]) || (def.kind === 'singleton' ? FileText : LayoutList)
    contents.set(group, [...(contents.get(group) ?? []), { key, label: def.label, icon, to: def.kind === 'singleton' ? adminEntryPath(key, key) : `/admin/${key}` }])
  }
  if (contents.size) sections.push({ title: 'Contenus', nodes: [...contents].map(([group, items]) => folder(`contents:${group}`, group, Folder, items, true)) })

  sections.push({
    title: 'Outils',
    nodes: ([
      // La médiathèque est une page du back-office, pas un contenu du fichier de configuration.
      { key: 'media', label: 'Médiathèque', icon: Images, to: '/admin/media' },
      hasForms.value && { key: 'forms', label: 'Messages reçus', icon: Inbox, to: '/admin/forms', count: unreadMessages.value },
      // Mesure d'audience (Cloudflare Web Analytics, Plausible) : pour l'administrateur et l'éditeur.
      hasModule(m => m.category === 'audience') && staff && { key: 'audience', label: 'Audience', icon: ChartLine, to: '/admin/audience' },
      // Module « Stripe » : les paiements, pour l'administrateur et l'éditeur.
      hasModule(m => m.id === 'stripe') && staff && { key: 'payments', label: 'Paiements', icon: CreditCard, to: '/admin/payments' },
      // Corbeille : pour qui peut supprimer quelque chose (il n'y verra que cela). L'administrateur la trouve dans « Administration ».
      !isAdmin && canOpenTrash(user.value) && { key: 'trash', label: 'Corbeille', icon: Trash2, to: '/admin/trash' },
    ] as (NavItem | false)[]).filter((i): i is NavItem => !!i),
  })

  const folders = [
    folder('seo', 'Référencement', SearchCheck, [
      // Vue d'ensemble des pages, pour qui peut modifier au moins un contenu qui a l'onglet Référencement.
      all.some(([, def]) => def.seo) && { key: 'seo', label: 'Pages et titres', icon: FileSearch, to: '/admin/seo' },
      // Redirections et pages introuvables : pour l'administrateur et l'éditeur.
      staff && { key: 'redirections', label: 'Redirections', icon: Signpost, to: '/admin/redirections' },
    ]),
    folder('settings', 'Réglages', Settings, isAdmin
      ? [
          { key: 'appearance', label: 'Apparence', icon: Palette, to: '/admin/appearance' },
          { key: 'availability', label: 'Disponibilité', icon: Construction, to: '/admin/availability' },
          { key: 'modules', label: 'Modules', icon: Puzzle, to: '/admin/modules' },
          { key: 'workflows', label: 'Workflows', icon: Workflow, to: '/admin/workflows' },
        ]
      : []),
    folder('admin', 'Administration', ShieldCheck, isAdmin
      ? [
          { key: 'users', label: 'Utilisateurs', icon: Users, to: '/admin/users' },
          { key: 'activity', label: 'Activité', icon: ScrollText, to: '/admin/activity' },
          { key: 'backups', label: 'Sauvegardes', icon: DatabaseBackup, to: '/admin/backups' },
          canOpenTrash(user.value) && { key: 'trash', label: 'Corbeille', icon: Trash2, to: '/admin/trash' },
          { key: 'migrations', label: 'Structure des contenus', icon: ArrowLeftRight, to: '/admin/migrations' },
        ]
      : []),
  ].filter(f => f.items.length)
  if (folders.length) sections.push({ nodes: folders })
  return sections
})

/** Entrées du menu à plat, avec le nom de leur section ou de leur dossier : pour la recherche (⌘K). */
const groups = computed(() => {
  const out = new Map<string, NavItem[]>()
  for (const section of nav.value) {
    for (const node of section.nodes) {
      const group = isFolder(node) ? node.label : section.title ?? ''
      out.set(group, [...(out.get(group) ?? []), ...(isFolder(node) ? node.items : [node])])
    }
  }
  return [...out]
})

const isActive = (item: NavItem) => route.params.type === item.key || route.path === item.to || route.path.startsWith(item.to + '/')

// Dossiers ouverts ou repliés à la main : retenus dans ce navigateur. Sans choix, l'état par défaut du dossier.
const NAV_KEY = 'cms-nav-folders'
const folderState = ref<Record<string, boolean>>({})
const isOpen = (f: NavFolder) => folderState.value[f.key] ?? f.open
// L'écran ouvert est toujours visible dans le menu : son dossier s'ouvre s'il était replié.
function openActiveFolder() {
  for (const section of nav.value) {
    for (const node of section.nodes) {
      if (isFolder(node) && !isOpen(node) && node.items.some(isActive)) folderState.value = { ...folderState.value, [node.key]: true }
    }
  }
}
watch([() => route.path, nav], openActiveFolder, { immediate: true })
onMounted(() => {
  try { folderState.value = JSON.parse(localStorage.getItem(NAV_KEY) ?? '{}') ?? {} }
  catch { /* stockage indisponible : états par défaut */ }
  openActiveFolder()
})
function onFolderToggle(f: NavFolder, event: Event) {
  const open = (event.target as HTMLDetailsElement).open
  if (open === isOpen(f)) return
  folderState.value = { ...folderState.value, [f.key]: open }
  try { localStorage.setItem(NAV_KEY, JSON.stringify(folderState.value)) }
  catch { /* stockage indisponible : l'état n'est pas retenu */ }
}

const initials = computed(() => (user.value?.name ?? '').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase())

async function logout() {
  await cmsApi('/api/auth/sign-out', { method: 'POST', body: {} })
  user.value = null
  await navigateTo('/admin/login')
}
</script>

<template>
  <div class="cms-admin drawer lg:drawer-open bg-base-200 min-h-screen text-base-content" data-theme="light" :style="useCmsAdminStyle().value">
    <input id="cms-nav" type="checkbox" class="drawer-toggle">

    <div class="drawer-content flex flex-col min-w-0">
      <header class="navbar bg-base-100 border-b border-base-300 sticky top-0 z-20 min-h-14 px-4 gap-2">
        <label for="cms-nav" class="btn btn-ghost btn-sm btn-square lg:hidden" aria-label="Ouvrir le menu"><Menu :size="18" /></label>
        <!-- Recherche et navigation rapide (⌘K) : le bouton et sa fenêtre. -->
        <CmsCommandPalette :schema="schema" :groups="groups" @logout="logout" />
        <div class="ml-auto">
          <template v-if="siteClosed">
            <NuxtLink v-if="user?.role === 'admin'" to="/admin/availability" data-cms-site-closed class="badge badge-warning gap-1 mr-1" title="Les visiteurs voient la page d'attente. Cliquer pour changer.">
              <Construction :size="14" />Site fermé<span class="hidden sm:inline"> · {{ MODE_LABELS[siteMode!] }}</span>
            </NuxtLink>
            <span v-else data-cms-site-closed class="badge badge-warning gap-1 mr-1" title="Les visiteurs voient la page d'attente.">
              <Construction :size="14" />Site fermé<span class="hidden sm:inline"> · {{ MODE_LABELS[siteMode!] }}</span>
            </span>
          </template>
          <CmsPreviewShare />
          <a :href="siteClosed ? '/?preview=1' : '/'" target="_blank" class="btn btn-ghost btn-sm"><ExternalLink :size="16" />{{ siteClosed ? 'Voir le site (aperçu)' : 'Voir le site' }}</a>
        </div>
      </header>
      <main class="p-4 lg:p-8 w-full mx-auto flex-1 max-w-[104rem]">
        <CmsMigrationNotice />
        <slot />
      </main>
    </div>

    <div class="drawer-side z-30">
      <label for="cms-nav" class="drawer-overlay" />
      <aside class="w-64 min-h-full bg-base-100 border-r border-base-300 flex flex-col">
        <div class="h-14 px-4 flex items-center gap-3 border-b border-base-300">
          <div class="w-8 h-8 rounded-field bg-primary text-primary-content grid place-items-center font-bold">
            {{ schema.site.name[0] }}
          </div>
          <div class="font-semibold text-sm truncate">{{ schema.site.name }}</div>
        </div>
        <ul class="menu w-full grow gap-0.5" data-cms-nav>
          <template v-for="(section, i) in nav" :key="section.title ?? `section-${i}`">
            <li v-if="section.title" class="menu-title mt-2 first:mt-0">{{ section.title }}</li>
            <li v-else class="mt-2 mb-1 mx-2 border-t border-base-300 pointer-events-none" aria-hidden="true" />
            <li v-for="node in section.nodes" :key="node.key">
              <details v-if="isFolder(node)" :open="isOpen(node)" :data-nav-folder="node.key" @toggle="onFolderToggle(node, $event)">
                <summary><component :is="node.icon" :size="16" class="shrink-0" />{{ node.label }}</summary>
                <ul>
                  <li v-for="item in node.items" :key="item.key">
                    <NuxtLink :to="item.to" :class="{ 'menu-active': isActive(item) }"><component :is="item.icon" :size="16" class="shrink-0" />{{ item.label }}<span v-if="item.count" class="badge badge-sm badge-info">{{ item.count }}</span></NuxtLink>
                  </li>
                </ul>
              </details>
              <NuxtLink v-else :to="node.to" :class="{ 'menu-active': isActive(node) }"><component :is="node.icon" :size="16" class="shrink-0" />{{ node.label }}<span v-if="node.count" class="badge badge-sm badge-info">{{ node.count }}</span></NuxtLink>
            </li>
          </template>
        </ul>
        <div class="p-3 border-t border-base-300 flex items-center gap-3">
          <div class="avatar avatar-placeholder">
            <div class="bg-neutral text-neutral-content w-8 rounded-full"><span class="text-xs">{{ initials }}</span></div>
          </div>
          <NuxtLink to="/admin/account" class="text-sm min-w-0 grow hover:underline" title="Mon compte">
            <div class="font-medium truncate">{{ user?.name }}</div>
            <div class="text-xs text-base-content/50">{{ user?.roleName ?? roleLabel(user?.role) }}</div>
          </NuxtLink>
          <button class="btn btn-ghost btn-sm btn-square" title="Se déconnecter" aria-label="Se déconnecter" @click="logout"><LogOut :size="16" /></button>
        </div>
        <div class="px-4 pb-2 -mt-1 text-[11px] text-base-content/40" title="Version du back-office">Version {{ cmsVersion }}<CmsUpdateNotice /></div>
      </aside>
    </div>

    <div class="toast toast-end z-50">
      <div v-for="t in toasts" :key="t.id" class="alert shadow-lg text-sm py-2" :class="t.kind === 'error' ? 'alert-error' : ''">{{ t.message }}</div>
    </div>
  </div>
</template>
