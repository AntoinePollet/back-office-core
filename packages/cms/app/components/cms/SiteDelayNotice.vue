<script setup lang="ts">
import { TriangleAlert } from '@lucide/vue'

/**
 * Avertissement affiché quand une modification est enregistrée mais que le site n'a pas pu être actualisé tout de suite.
 * Il reste visible d'une page à l'autre jusqu'à ce qu'on le ferme ou qu'une mise à jour du site réussisse.
 */
const delayed = useCmsSiteDelay()
</script>

<template>
  <div v-if="delayed" role="alert" class="alert alert-warning alert-soft text-sm mb-4 items-start" data-cms-site-delay>
    <TriangleAlert :size="18" class="shrink-0 mt-0.5" />
    <div>
      <div class="font-semibold">Le site n'a pas pu être actualisé tout de suite</div>
      <div>
        Votre modification est bien enregistrée, rien n'est perdu. En revanche, les visiteurs peuvent encore voir l'ancienne version
        du site pendant une heure au maximum. Vous n'avez rien d'autre à faire.
      </div>
    </div>
    <button type="button" class="btn btn-sm btn-ghost" @click="delayed = false">Compris</button>
  </div>
</template>
