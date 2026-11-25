<script setup lang="ts">
import type { Component } from 'vue'
import { GripVertical, Star } from '@lucide/vue'

/**
 * Une entrée du menu du back-office : le lien, son libellé (coupé avec « … » s'il est trop long, en entier au survol),
 * son compteur, et l'étoile qui l'ajoute aux favoris ou l'en retire.
 * `sortable` : entrée de la section Favoris, qu'on déplace à la souris (poignée) ou au clavier (Alt + ↑ / ↓).
 */
const props = defineProps<{
  item: { key: string; label: string; to: string; icon: Component; count?: number }
  active: boolean
  favorite: boolean
  sortable?: boolean
}>()
const emit = defineEmits<{ favorite: []; move: [delta: -1 | 1] }>()

function onKeydown(event: KeyboardEvent) {
  if (!props.sortable || !event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
  event.preventDefault()
  emit('move', event.key === 'ArrowUp' ? -1 : 1)
}
</script>

<template>
  <li class="group/nav relative" :data-nav-item="item.to">
    <NuxtLink
      :to="item.to" class="cms-nav-link" :class="{ 'menu-active': active, 'pl-1': sortable }" :title="item.label"
      :aria-keyshortcuts="sortable ? 'Alt+ArrowUp Alt+ArrowDown' : undefined" @keydown="onKeydown"
    >
      <GripVertical v-if="sortable" :size="14" class="shrink-0 text-base-content/30 cursor-grab" aria-hidden="true" data-nav-grip />
      <component :is="item.icon" :size="16" class="shrink-0" />
      <span class="truncate min-w-0 grow">{{ item.label }}</span>
      <span v-if="item.count" class="badge badge-sm badge-info shrink-0">{{ item.count }}</span>
    </NuxtLink>
    <button
      type="button" class="cms-nav-star btn btn-ghost btn-xs btn-square" :class="{ 'is-favorite': favorite }"
      :aria-pressed="favorite" :aria-label="favorite ? `Retirer « ${item.label} » des favoris` : `Ajouter « ${item.label} » aux favoris`"
      :title="favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'" data-nav-star data-cms-busy-off @click.prevent.stop="emit('favorite')"
    >
      <Star :size="14" :fill="favorite ? 'currentColor' : 'none'" />
    </button>
  </li>
</template>
