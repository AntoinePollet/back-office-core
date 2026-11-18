<script setup lang="ts">
import { TriangleAlert } from '@lucide/vue'

/**
 * Avertissement affiché dans tout le back-office tant que des changements de structure attendent un administrateur
 * (voir la page « Structure des contenus »).
 */
const user = useCmsUser()
const route = useRoute()
const pending = useCmsMigrationsPending()

onMounted(async () => {
  try {
    pending.value = (await cmsApi<{ pending: number }>('/api/cms/migrations/status')).pending
  }
  catch {
    // Sans réponse, pas d'avertissement : la page reste utilisable.
  }
})
</script>

<template>
  <div v-if="pending > 0 && route.path !== '/admin/migrations'" role="alert" class="alert alert-warning alert-soft mb-6 text-sm">
    <TriangleAlert :size="18" class="shrink-0" />
    <div>
      <div class="font-medium">La structure du site a été modifiée et {{ pending > 1 ? `${pending} changements attendent` : 'un changement attend' }} une validation.</div>
      <div>
        En attendant, certains contenus peuvent apparaître vides ou incomplets.
        <template v-if="user?.role !== 'admin'">Prévenez un administrateur.</template>
      </div>
    </div>
    <NuxtLink v-if="user?.role === 'admin'" to="/admin/migrations" class="btn btn-sm btn-warning">Voir les changements</NuxtLink>
  </div>
</template>
