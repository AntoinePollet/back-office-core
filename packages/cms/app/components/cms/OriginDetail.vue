<script setup lang="ts">
import { CHANNELS, PAID_CHANNELS, type StoredOrigin, channelOfRow } from '../../../shared/attribution'

/** Provenance d'un message ou d'un paiement, dans le panneau de détail. */
const props = defineProps<{ origin?: StoredOrigin | null }>()
const channel = computed(() => channelOfRow(props.origin))
const rows = computed(() => {
  const o = props.origin
  if (!o) return []
  return ([
    ['Campagne', o.campaign],
    ['Mot-clé', o.term],
    ['Variante de l\'annonce', o.content],
    ['Source', [o.source, o.medium].filter(Boolean).join(' / ')],
    ['Site précédent', o.referrer],
    ['Page d\'arrivée', o.landing],
    ['Arrivée', o.at ? new Date(o.at).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' }) : ''],
    ['Clic d\'annonce', o.click ? `${o.click} (identifiant reçu)` : ''],
  ] as [string, string | undefined][]).filter(([, v]) => v)
})
</script>

<template>
  <div class="rounded-box bg-base-200/60 p-3 space-y-2" data-origin-detail :data-channel="channel">
    <div class="flex items-center gap-2">
      <span class="text-base-content/60">Provenance</span>
      <span class="badge badge-sm" :class="PAID_CHANNELS.includes(channel) ? 'badge-accent' : 'badge-ghost'">{{ CHANNELS[channel] }}</span>
    </div>
    <dl v-if="rows.length" class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
      <template v-for="[label, value] in rows" :key="label">
        <dt class="text-base-content/60">{{ label }}</dt>
        <dd class="break-words">{{ value }}</dd>
      </template>
    </dl>
    <p v-else class="text-xs text-base-content/50">Aucun indice relevé : arrivée directe, ou visiteur revenu plus tard par un autre chemin.</p>
  </div>
</template>
