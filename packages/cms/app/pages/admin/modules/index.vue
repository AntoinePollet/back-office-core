<script setup lang="ts">
import { ChevronRight } from '@lucide/vue'
import { MODULE_CATEGORIES, type ModuleCategory } from '../../../../shared/modules'
import type { CmsModuleState } from '../../../composables/useCms'

definePageMeta({ layout: 'admin', middleware: ['cms-auth', 'cms-admin'] })

const toast = useCmsToast()
const modules = ref(await cmsApi<CmsModuleState[]>('/api/cms/modules'))

// Rangés par famille, dans l'ordre de MODULE_CATEGORIES ; dans une famille, les modules activés d'abord.
const groups = computed(() => (Object.keys(MODULE_CATEGORIES) as ModuleCategory[])
  .map(key => ({
    key, label: MODULE_CATEGORIES[key],
    items: modules.value.filter(m => (m.category in MODULE_CATEGORIES ? m.category : 'other') === key)
      .sort((a, b) => Number(b.enabled) - Number(a.enabled)),
  }))
  .filter(g => g.items.length))

const busy = ref<string | null>(null)
async function toggle(m: CmsModuleState, enabled: boolean, input: HTMLInputElement) {
  if (!enabled && !confirm(`Désactiver « ${m.label} » ? Il cesse de fonctionner sur le site tout de suite. Ses réglages sont gardés : vous pourrez le réactiver.`)) {
    input.checked = true
    return
  }
  busy.value = m.id
  try {
    const state = await cmsApi<CmsModuleState>(`/api/cms/modules/${m.id}/enabled`, { method: 'PUT', body: { enabled } })
    modules.value = modules.value.map(x => (x.id === m.id ? state : x))
    await refreshCmsSchema()
    const done = enabled ? `${m.label} activé` : `${m.label} désactivé`
    toast.success(cmsSiteUpdated(state) ? (enabled && !state.configured ? `${done} : il reste à le régler` : done) : `${done} ; le site peut mettre jusqu'à une heure à en tenir compte`)
  }
  catch (e) {
    input.checked = !enabled
    toast.error(cmsErrorMessage(e))
  }
  busy.value = null
}
</script>

<template>
  <section class="max-w-3xl mx-auto">
    <div class="mb-6">
      <h1 class="text-2xl font-bold">Modules</h1>
      <p class="text-sm text-base-content/60">Les fonctions qu'on peut ajouter à ce site. Activez celles dont vous avez besoin, puis réglez-les. Les clés d'API saisies ici sont enregistrées chiffrées.</p>
    </div>

    <div v-for="g in groups" :key="g.key" class="mb-6" :data-category="g.key">
      <h2 class="text-xs font-semibold uppercase tracking-wide text-base-content/50 mb-2">{{ g.label }}</h2>
      <div class="space-y-3">
        <div
          v-for="m in g.items" :key="m.id" :data-module="m.id"
          class="card bg-base-100 border p-4 flex-row items-center gap-4 transition-colors"
          :class="m.enabled ? 'border-base-300' : 'border-base-300/60 bg-base-100/60'"
        >
          <NuxtLink :to="`/admin/modules/${m.id}`" class="flex items-center gap-4 min-w-0 grow group" :class="{ 'opacity-70': !m.enabled }">
            <CmsModuleLogo :logo="m.logo" />
            <div class="min-w-0 grow">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-semibold group-hover:text-primary">{{ m.label }}</span>
                <template v-if="m.enabled">
                  <span v-if="!m.settings.length" class="badge badge-sm badge-soft badge-success">Actif</span>
                  <span v-else-if="m.configured" class="badge badge-sm badge-soft badge-success">Réglé</span>
                  <span v-else class="badge badge-sm badge-soft badge-warning">À régler</span>
                </template>
                <span v-else class="badge badge-sm badge-ghost">Désactivé</span>
              </div>
              <p class="text-sm text-base-content/60">{{ m.description }}</p>
              <p v-if="m.needsCode" class="text-xs text-base-content/60 mt-1">
                À ajouter par le développeur dans <code>cms.config.ts</code> : <code class="break-all">{{ m.needsCode }}</code>
              </p>
            </div>
            <ChevronRight :size="18" class="shrink-0 text-base-content/40 max-sm:hidden" />
          </NuxtLink>
          <label class="shrink-0 flex flex-col items-center gap-1 text-xs text-base-content/60" :class="m.canEnable ? 'cursor-pointer' : 'cursor-not-allowed'" :title="m.canEnable ? '' : 'Ce module doit d\'abord être déclaré dans cms.config.ts'">
            <input
              type="checkbox" class="toggle toggle-sm toggle-success" :checked="m.enabled" :disabled="!m.canEnable || busy === m.id"
              :aria-label="`${m.label} : ${m.enabled ? 'activé' : 'désactivé'}`"
              @change="toggle(m, ($event.target as HTMLInputElement).checked, $event.target as HTMLInputElement)"
            >
            {{ m.enabled ? 'Activé' : 'Désactivé' }}
          </label>
        </div>
      </div>
    </div>
  </section>
</template>
