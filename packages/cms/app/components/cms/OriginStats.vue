<script setup lang="ts">
import { Megaphone, X } from '@lucide/vue'
import { CHANNELS, type Channel, ORIGIN_PERIODS, type OriginPeriod, type StoredOrigin, channelOfRow, filterByOrigin, originStats } from '../../../shared/attribution'

/**
 * « D'où viennent les messages / les paiements » : comptes par canal (Google Ads, e-mail, moteur de recherche…) sur
 * une période, avec le détail par campagne des canaux payants. Un clic sur un canal filtre la liste de l'écran.
 * La période et le canal choisis sont ceux de la liste (`v-model:days`, `v-model:channel`).
 */
const props = defineProps<{
  rows: { origin?: StoredOrigin | null; createdAt: string }[]
  /** Nom des lignes, au singulier et au pluriel : « message », « messages ». */
  noun: [string, string]
  /** Montant d'une ligne (paiements), pour un total par canal ; sans elle, seuls les nombres sont montrés. */
  amount?: (row: any) => number
  formatAmount?: (total: number) => string
}>()
const days = defineModel<OriginPeriod>('days', { required: true })
const channel = defineModel<Channel | null>('channel', { required: true })

const inPeriod = computed(() => filterByOrigin(props.rows, days.value, null))
const stats = computed(() => originStats(inPeriod.value))
const total = computed(() => inPeriod.value.length)
const paid = computed(() => stats.value.filter(s => s.paid).reduce((n, s) => n + s.count, 0))
const sumOf = (c: Channel) => (props.amount ? inPeriod.value.filter(r => channelOfRow(r.origin) === c).reduce((n, r) => n + props.amount!(r), 0) : 0)
const word = (n: number) => `${n} ${n > 1 ? props.noun[1] : props.noun[0]}`
const percent = (n: number) => (total.value ? Math.round((100 * n) / total.value) : 0)
const toggle = (c: Channel) => { channel.value = channel.value === c ? null : c }
</script>

<template>
  <div class="card bg-base-100 border border-base-300 p-4 text-sm space-y-3" data-origin-stats>
    <div class="flex flex-wrap items-center gap-2">
      <h2 class="font-semibold grow">D'où viennent les {{ noun[1] }}</h2>
      <div role="tablist" class="tabs tabs-box tabs-xs" aria-label="Période">
        <a
          v-for="p in ORIGIN_PERIODS" :key="String(p.days)" role="tab" class="tab" :class="{ 'tab-active': days === p.days }"
          :aria-selected="days === p.days" :data-origin-period="p.days ?? 'all'" @click="days = p.days"
        >{{ p.label }}</a>
      </div>
    </div>

    <p v-if="!total" class="text-base-content/50">Aucun {{ noun[0] }} sur cette période.</p>
    <template v-else>
      <p class="flex items-center gap-2" data-origin-paid>
        <Megaphone :size="16" class="shrink-0 text-accent" />
        <span><strong>{{ word(paid) }}</strong> sur {{ total }} grâce à une publicité ({{ percent(paid) }} %).</span>
      </p>
      <ul class="space-y-1">
        <li v-for="s in stats" :key="s.channel" :data-origin-channel="s.channel">
          <button
            type="button" class="w-full grid grid-cols-[minmax(0,12rem)_1fr_auto] items-center gap-3 rounded-field px-2 py-1 text-left hover:bg-base-200 cursor-pointer"
            :class="{ 'bg-base-200 ring-1 ring-primary': channel === s.channel }" :aria-pressed="channel === s.channel"
            :title="channel === s.channel ? 'Montrer tous les canaux' : `Montrer seulement : ${s.label}`" @click="toggle(s.channel)"
          >
            <span class="truncate" :class="{ 'font-medium': s.paid }">{{ s.label }}</span>
            <span class="h-2 rounded-full bg-base-200 overflow-hidden" aria-hidden="true">
              <span class="block h-full rounded-full" :class="s.paid ? 'bg-accent' : 'bg-base-content/30'" :style="{ width: `${percent(s.count)}%` }" />
            </span>
            <span class="tabular-nums text-right whitespace-nowrap" data-origin-count>
              {{ s.count }}<span v-if="amount && formatAmount" class="text-base-content/60"> · {{ formatAmount(sumOf(s.channel)) }}</span>
            </span>
          </button>
          <ul v-if="s.paid && s.campaigns.length" class="pl-6 pr-2 text-xs text-base-content/70 space-y-0.5 pb-1">
            <li v-for="c in s.campaigns" :key="c.name" class="flex justify-between gap-3" :data-origin-campaign="c.name">
              <span class="truncate">Campagne « {{ c.name }} »</span><span class="tabular-nums">{{ c.count }}</span>
            </li>
          </ul>
        </li>
      </ul>
      <div v-if="channel" class="flex items-center gap-2 text-xs">
        <span class="badge badge-sm badge-primary badge-soft">Seulement : {{ CHANNELS[channel] }}</span>
        <button type="button" class="btn btn-ghost btn-xs" data-origin-clear @click="channel = null"><X :size="12" />Tous les canaux</button>
      </div>
    </template>
    <p class="text-xs text-base-content/50">
      Relevé par le site à l'arrivée du visiteur (lien d'annonce, paramètres utm_, site précédent). Sans indice, ou s'il
      revient plus tard par un autre chemin, il compte en « Accès direct ».
    </p>
  </div>
</template>
