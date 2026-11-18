<script setup lang="ts">
import { ChevronRight } from '@lucide/vue'
import type { CmsModuleState } from '../../../composables/useCms'

definePageMeta({ layout: 'admin', middleware: ['cms-auth', 'cms-admin'] })

const modules = await cmsApi<CmsModuleState[]>('/api/cms/modules')
</script>

<template>
  <section class="max-w-3xl mx-auto">
    <div class="mb-6">
      <h1 class="text-2xl font-bold">Modules</h1>
      <p class="text-sm text-base-content/60">Les fonctions ajoutées à ce site et leurs réglages. Les clés d'API saisies ici sont enregistrées chiffrées.</p>
    </div>

    <div v-if="!modules.length" class="card bg-base-100 border border-base-300 p-8 text-center text-sm text-base-content/60">
      Aucun module n'est activé sur ce site.
    </div>
    <div v-else class="space-y-3">
      <NuxtLink v-for="m in modules" :key="m.id" :to="`/admin/modules/${m.id}`" class="card bg-base-100 border border-base-300 p-4 flex-row items-center gap-4 hover:border-primary transition-colors">
        <CmsModuleLogo :logo="m.logo" />
        <div class="min-w-0 grow">
          <div class="flex items-center gap-2">
            <span class="font-semibold">{{ m.label }}</span>
            <span v-if="!m.settings.length" class="badge badge-sm badge-soft badge-success">Actif</span>
            <span v-else-if="m.configured" class="badge badge-sm badge-soft badge-success">Réglé</span>
            <span v-else class="badge badge-sm badge-soft badge-warning">À régler</span>
          </div>
          <p class="text-sm text-base-content/60">{{ m.description }}</p>
        </div>
        <ChevronRight :size="18" class="shrink-0 text-base-content/40" />
      </NuxtLink>
    </div>
  </section>
</template>
