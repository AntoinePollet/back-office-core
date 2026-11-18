<script setup lang="ts">
import type { Component } from 'vue'
import { ArrowLeftRight, ExternalLink, FileText, Images, LayoutList, LogOut, Menu, Palette, Users, Workflow } from '@lucide/vue'
import configIcons from '#cms-icons'
import '../assets/css/admin.css'

const schema = await useCmsSchema()
const user = useCmsUser()
const route = useRoute()
const { toasts } = useCmsToast()

const groups = computed(() => {
  const out = new Map<string, { key: string; label: string; to: string; icon: Component }[]>()
  const all = [...Object.entries(schema.value.singletons ?? {}), ...Object.entries(schema.value.collections ?? {})]
  for (const [key, def] of all) {
    const group = def.group ?? (def.kind === 'singleton' ? 'Pages' : 'Collections')
    if (!out.has(group)) out.set(group, [])
    // Icône choisie dans cms.config.ts (nom Lucide), sinon une icône selon la nature du contenu.
    const icon = (def.icon && configIcons[def.icon]) || (def.kind === 'singleton' ? FileText : LayoutList)
    out.get(group)!.push({ key, label: def.label, icon, to: def.kind === 'singleton' ? `/admin/${key}/${key}` : `/admin/${key}` })
  }
  // La médiathèque est une page du back-office, pas un contenu du fichier de configuration.
  if (!out.has('Site')) out.set('Site', [])
  out.get('Site')!.push({ key: 'media', label: 'Médiathèque', icon: Images, to: '/admin/media' })
  if (user.value?.role === 'admin') {
    out.get('Site')!.push({ key: 'appearance', label: 'Apparence', icon: Palette, to: '/admin/appearance' })
    out.get('Site')!.push({ key: 'workflows', label: 'Workflows', icon: Workflow, to: '/admin/workflows' })
    out.get('Site')!.push({ key: 'users', label: 'Utilisateurs', icon: Users, to: '/admin/users' })
    out.get('Site')!.push({ key: 'migrations', label: 'Structure des contenus', icon: ArrowLeftRight, to: '/admin/migrations' })
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
              <NuxtLink :to="item.to" :class="{ 'menu-active': route.params.type === item.key || route.path === item.to || route.path.startsWith(item.to + '/') }"><component :is="item.icon" :size="16" class="shrink-0" />{{ item.label }}</NuxtLink>
            </li>
          </template>
        </ul>
        <div class="p-3 border-t border-base-300 flex items-center gap-3">
          <div class="avatar avatar-placeholder">
            <div class="bg-neutral text-neutral-content w-8 rounded-full"><span class="text-xs">{{ initials }}</span></div>
          </div>
          <NuxtLink to="/admin/account" class="text-sm min-w-0 grow hover:underline" title="Mon compte">
            <div class="font-medium truncate">{{ user?.name }}</div>
            <div class="text-xs text-base-content/50">{{ user?.role === 'admin' ? 'Administrateur' : 'Éditeur' }}</div>
          </NuxtLink>
          <button class="btn btn-ghost btn-sm btn-square" title="Se déconnecter" aria-label="Se déconnecter" @click="logout"><LogOut :size="16" /></button>
        </div>
      </aside>
    </div>

    <div class="toast toast-end z-50">
      <div v-for="t in toasts" :key="t.id" class="alert shadow-lg text-sm py-2" :class="t.kind === 'error' ? 'alert-error' : ''">{{ t.message }}</div>
    </div>
  </div>
</template>
