<script setup lang="ts">
import type { Component } from 'vue'
import { ArrowLeftRight, ChartLine, CreditCard, ExternalLink, FileText, Images, Inbox, LayoutList, LogOut, Menu, Palette, Puzzle, ScrollText, Trash2, Users, Workflow, ClipboardCheck } from '@lucide/vue'
import configIcons from '#cms-icons'
import { roleLabel } from '../../shared/access'
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
// Module « Formulaires » : messages reçus non lus, pour qui peut les lire (administrateur, éditeur).
const hasForms = computed(() => !!schema.value.modules?.some(m => m.id === 'forms') && ['admin', 'editor'].includes(user.value?.role ?? ''))
const unreadMessages = useCmsUnreadMessages()
watch(() => route.fullPath, () => { if (hasForms.value) refreshCmsUnreadMessages() }, { immediate: true })
const { toasts } = useCmsToast()

const groups = computed(() => {
  const out = new Map<string, { key: string; label: string; to: string; icon: Component; count?: number }[]>()
  // Demandes de publication : l'entrée n'apparaît que s'il y en a, pour ne pas encombrer le menu.
  if (reviews.value.length) out.set('À faire', [{ key: 'reviews', label: 'À valider', icon: ClipboardCheck, to: '/admin/reviews', count: reviews.value.length }])
  const all = [...Object.entries(schema.value.singletons ?? {}), ...Object.entries(schema.value.collections ?? {})]
  for (const [key, def] of all) {
    const group = def.group ?? (def.kind === 'singleton' ? 'Pages' : 'Collections')
    if (!out.has(group)) out.set(group, [])
    // Icône choisie dans cms.config.ts (nom Lucide), sinon une icône selon la nature du contenu.
    const icon = (def.icon && configIcons[def.icon]) || (def.kind === 'singleton' ? FileText : LayoutList)
    out.get(group)!.push({ key, label: def.label, icon, to: def.kind === 'singleton' ? adminEntryPath(key, key) : `/admin/${key}` })
  }
  // La médiathèque est une page du back-office, pas un contenu du fichier de configuration.
  if (!out.has('Site')) out.set('Site', [])
  out.get('Site')!.push({ key: 'media', label: 'Médiathèque', icon: Images, to: '/admin/media' })
  // Corbeille : pour qui peut supprimer quelque chose (il n'y verra que cela).
  if (canOpenTrash(user.value)) out.get('Site')!.push({ key: 'trash', label: 'Corbeille', icon: Trash2, to: '/admin/trash' })
  if (hasForms.value) out.get('Site')!.push({ key: 'forms', label: 'Messages reçus', icon: Inbox, to: '/admin/forms', count: unreadMessages.value })
  // Module « Stripe » : les paiements, pour l'administrateur et l'éditeur.
  if (schema.value.modules?.some(m => m.id === 'stripe') && ['admin', 'editor'].includes(user.value?.role ?? '')) out.get('Site')!.push({ key: 'payments', label: 'Paiements', icon: CreditCard, to: '/admin/payments' })
  // Module « Mesure d'audience » : la fréquentation du site, pour l'administrateur et l'éditeur.
  if (schema.value.modules?.some(m => m.id === 'analytics') && ['admin', 'editor'].includes(user.value?.role ?? '')) out.get('Site')!.push({ key: 'audience', label: 'Audience', icon: ChartLine, to: '/admin/audience' })
  if (user.value?.role === 'admin') {
    out.get('Site')!.push({ key: 'appearance', label: 'Apparence', icon: Palette, to: '/admin/appearance' })
    out.get('Site')!.push({ key: 'workflows', label: 'Workflows', icon: Workflow, to: '/admin/workflows' })
    out.get('Site')!.push({ key: 'users', label: 'Utilisateurs', icon: Users, to: '/admin/users' })
    if (schema.value.modules?.length) out.get('Site')!.push({ key: 'modules', label: 'Modules', icon: Puzzle, to: '/admin/modules' })
    out.get('Site')!.push({ key: 'migrations', label: 'Structure des contenus', icon: ArrowLeftRight, to: '/admin/migrations' })
    out.get('Site')!.push({ key: 'activity', label: 'Activité', icon: ScrollText, to: '/admin/activity' })
  }
  return [...out]
})

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
          <CmsPreviewShare />
          <a href="/" target="_blank" class="btn btn-ghost btn-sm"><ExternalLink :size="16" />Voir le site</a>
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
        <ul class="menu w-full grow gap-0.5">
          <template v-for="[group, items] in groups" :key="group">
            <li class="menu-title mt-2 first:mt-0">{{ group }}</li>
            <li v-for="item in items" :key="item.key">
              <NuxtLink :to="item.to" :class="{ 'menu-active': route.params.type === item.key || route.path === item.to || route.path.startsWith(item.to + '/') }"><component :is="item.icon" :size="16" class="shrink-0" />{{ item.label }}<span v-if="item.count" class="badge badge-sm badge-info">{{ item.count }}</span></NuxtLink>
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
        <div class="px-4 pb-2 -mt-1 text-[11px] text-base-content/40" title="Version du back-office">Version {{ cmsVersion }}</div>
      </aside>
    </div>

    <div class="toast toast-end z-50">
      <div v-for="t in toasts" :key="t.id" class="alert shadow-lg text-sm py-2" :class="t.kind === 'error' ? 'alert-error' : ''">{{ t.message }}</div>
    </div>
  </div>
</template>
