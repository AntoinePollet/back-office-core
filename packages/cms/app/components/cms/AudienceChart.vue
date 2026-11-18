<script setup lang="ts">
import type { AudienceDay } from '../../../shared/analytics'

/**
 * Courbe de fréquentation par jour (écran « Audience ») : pages vues et visites sur un même axe, en SVG fait main.
 * Le SVG est dessiné à la largeur réelle de son conteneur : le texte n'est jamais déformé.
 * Survol (ou toucher) d'un jour : ligne de repère et bulle avec les deux chiffres.
 */
const props = defineProps<{ days: AudienceDay[] }>()

const HEIGHT = 220
const PAD = { top: 12, right: 12, bottom: 28, left: 40 }

const box = ref<HTMLElement | null>(null)
const width = ref(640)
let observer: ResizeObserver | null = null
onMounted(() => {
  observer = new ResizeObserver(([entry]) => { if (entry) width.value = Math.max(260, Math.round(entry.contentRect.width)) })
  if (box.value) observer.observe(box.value)
})
onBeforeUnmount(() => observer?.disconnect())

/** Graduations « rondes » (1, 2 ou 5 × 10ⁿ) de 0 au-dessus du maximum. */
const ticks = computed(() => {
  const max = Math.max(1, ...props.days.map(d => Math.max(d.pageViews, d.visits)))
  const raw = max / 4
  const power = 10 ** Math.floor(Math.log10(raw))
  const step = Math.max(1, [1, 2, 5, 10].map(m => m * power).find(s => s >= raw) ?? power * 10)
  const top = Math.ceil(max / step) * step
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step)
})
const top = computed(() => ticks.value.at(-1) || 1)

const plotW = computed(() => width.value - PAD.left - PAD.right)
const plotH = HEIGHT - PAD.top - PAD.bottom
const x = (i: number) => PAD.left + (props.days.length > 1 ? (i / (props.days.length - 1)) * plotW.value : plotW.value / 2)
const y = (v: number) => PAD.top + plotH - (v / top.value) * plotH

const line = (key: 'visits' | 'pageViews') => props.days.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join('')
const viewsPath = computed(() => line('pageViews'))
const visitsPath = computed(() => line('visits'))
const area = computed(() => `${viewsPath.value}L${x(props.days.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`)

const format = (n: number) => n.toLocaleString('fr-FR')
const dayLabel = (date: string, long = false) => new Date(`${date}T00:00:00Z`).toLocaleDateString('fr-FR', long
  ? { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }
  : props.days.length <= 7 ? { weekday: 'short', day: 'numeric', timeZone: 'UTC' } : { day: 'numeric', month: 'short', timeZone: 'UTC' })
/** Un libellé de jour sur deux, trois… selon la place, toujours le dernier. */
const labelEvery = computed(() => Math.max(1, Math.ceil(props.days.length / Math.max(2, Math.floor(plotW.value / 64)))))
const showLabel = (i: number) => (props.days.length - 1 - i) % labelEvery.value === 0

const hover = ref<number | null>(null)
function pick(event: PointerEvent) {
  const rect = (event.currentTarget as SVGElement).getBoundingClientRect()
  const px = event.clientX - rect.left
  const step = props.days.length > 1 ? plotW.value / (props.days.length - 1) : plotW.value
  hover.value = Math.min(props.days.length - 1, Math.max(0, Math.round((px - PAD.left) / step)))
}
const tip = computed(() => {
  if (hover.value === null) return null
  const d = props.days[hover.value]!
  const left = x(hover.value)
  return { d, left, alignRight: left > width.value - 170 }
})
</script>

<template>
  <div>
    <!-- Légende : deux séries, chacune reconnaissable sans la couleur (trait plein, pointillés). -->
    <div class="flex flex-wrap gap-4 text-xs text-base-content/70 mb-2" aria-hidden="true">
      <span class="inline-flex items-center gap-1.5"><svg width="18" height="8"><line x1="1" y1="4" x2="17" y2="4" stroke="var(--color-primary)" stroke-width="2" stroke-linecap="round" /></svg>Pages vues</span>
      <span class="inline-flex items-center gap-1.5"><svg width="18" height="8"><line x1="1" y1="4" x2="17" y2="4" stroke="currentColor" stroke-width="2" stroke-dasharray="4 3" stroke-linecap="round" /></svg>Visites</span>
    </div>

    <div ref="box" class="relative w-full select-none">
      <svg
        :width="width" :height="HEIGHT" :viewBox="`0 0 ${width} ${HEIGHT}`" class="block touch-pan-y" role="img"
        :aria-label="`Pages vues et visites par jour, du ${dayLabel(days[0]!.date, true)} au ${dayLabel(days.at(-1)!.date, true)}`"
        @pointermove="pick" @pointerdown="pick" @pointerleave="hover = null"
      >
        <!-- Grille horizontale et graduations, discrètes. -->
        <g class="text-base-content/45" font-size="11">
          <template v-for="t in ticks" :key="t">
            <line :x1="PAD.left" :x2="width - PAD.right" :y1="y(t)" :y2="y(t)" stroke="currentColor" :stroke-opacity="t === 0 ? 0.5 : 0.15" />
            <text :x="PAD.left - 8" :y="y(t) + 4" text-anchor="end" fill="currentColor">{{ format(t) }}</text>
          </template>
          <template v-for="(d, i) in days" :key="d.date">
            <text v-if="showLabel(i)" :x="x(i)" :y="HEIGHT - 8" :text-anchor="i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle'" fill="currentColor">{{ dayLabel(d.date) }}</text>
          </template>
        </g>

        <path :d="area" fill="var(--color-primary)" fill-opacity="0.08" />
        <path :d="viewsPath" fill="none" stroke="var(--color-primary)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
        <path :d="visitsPath" fill="none" stroke="currentColor" class="text-base-content/60" stroke-width="2" stroke-dasharray="5 4" stroke-linejoin="round" stroke-linecap="round" />

        <g v-if="tip">
          <line :x1="tip.left" :x2="tip.left" :y1="PAD.top" :y2="y(0)" stroke="currentColor" class="text-base-content/30" />
          <circle :cx="tip.left" :cy="y(tip.d.pageViews)" r="4.5" fill="var(--color-primary)" stroke="var(--color-base-100)" stroke-width="2" />
          <circle :cx="tip.left" :cy="y(tip.d.visits)" r="4.5" fill="var(--color-base-100)" stroke="currentColor" class="text-base-content/70" stroke-width="2" />
        </g>
      </svg>

      <div
        v-if="tip" class="absolute top-1 pointer-events-none bg-base-100 border border-base-300 rounded-box shadow-sm px-3 py-2 text-xs whitespace-nowrap"
        :style="tip.alignRight ? { right: `${width - tip.left + 10}px` } : { left: `${tip.left + 10}px` }"
      >
        <div class="font-medium mb-1 first-letter:uppercase">{{ dayLabel(tip.d.date, true) }}</div>
        <div class="flex justify-between gap-4"><span class="text-base-content/60">Pages vues</span><span class="font-semibold tabular-nums">{{ format(tip.d.pageViews) }}</span></div>
        <div class="flex justify-between gap-4"><span class="text-base-content/60">Visites</span><span class="font-semibold tabular-nums">{{ format(tip.d.visits) }}</span></div>
      </div>
    </div>

    <!-- Les mêmes chiffres en tableau, pour qui ne voit pas la courbe ou veut les recopier. -->
    <details class="mt-2 text-sm">
      <summary class="cursor-pointer text-base-content/60 text-xs">Voir les chiffres jour par jour</summary>
      <div class="overflow-x-auto mt-2">
        <table class="table table-xs">
          <thead><tr><th>Jour</th><th class="text-right">Pages vues</th><th class="text-right">Visites</th></tr></thead>
          <tbody>
            <tr v-for="d in [...days].reverse()" :key="d.date">
              <td class="first-letter:uppercase">{{ dayLabel(d.date, true) }}</td>
              <td class="text-right tabular-nums">{{ format(d.pageViews) }}</td>
              <td class="text-right tabular-nums">{{ format(d.visits) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  </div>
</template>
