<script setup lang="ts">
import { Puzzle } from '@lucide/vue'
import type { CmsModuleState } from '../../composables/useCms'

/** Logo d'un module dans une vignette carrée. Sans logo : une pièce de puzzle. */
defineProps<{ logo: CmsModuleState['logo']; size?: number }>()
</script>

<template>
  <span class="shrink-0 grid place-items-center rounded-field bg-base-200 border border-base-300 text-base-content/70" :style="{ width: `${size ?? 44}px`, height: `${size ?? 44}px` }" aria-hidden="true">
    <svg
      v-if="logo" viewBox="0 0 24 24" :width="(size ?? 44) * 0.55" :height="(size ?? 44) * 0.55"
      :fill="logo.style === 'fill' ? logo.color : 'none'" :stroke="logo.style === 'stroke' ? logo.color : 'none'"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
    >
      <path v-for="(d, i) in logo.paths" :key="i" :d="d" />
    </svg>
    <Puzzle v-else :size="(size ?? 44) * 0.5" />
  </span>
</template>
