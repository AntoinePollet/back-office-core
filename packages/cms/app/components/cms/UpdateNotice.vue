<script setup lang="ts">
import type { UpdateStatus } from '../../../shared/updates'

/**
 * Mention discrète, à côté du numéro de version en bas du menu : « — la 0.5.1 est disponible », avec un lien vers
 * les notes de version. Pour les administrateurs seulement. La question est posée au serveur une fois la page
 * affichée, sans rien attendre : sans réponse, il n'y a simplement pas de mention.
 */
const user = useCmsUser()
const status = useState<UpdateStatus | null>('cms-update', () => null)

onMounted(async () => {
  if (user.value?.role !== 'admin' || status.value) return
  status.value = await cmsApi<UpdateStatus>('/api/cms/update').catch(() => null)
})
</script>

<template>
  <template v-if="user?.role === 'admin' && status?.latest && status.url">
    — <a :href="status.url" target="_blank" rel="noopener" class="link link-hover text-base-content/60" title="Voir les notes de version">la {{ status.latest }} est disponible</a>
  </template>
</template>
