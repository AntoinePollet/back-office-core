<script setup lang="ts">
import { CalendarClock, EyeOff, TriangleAlert } from '@lucide/vue'
import { adminEntryPath } from '../../../shared/admin-paths'
import { type ScheduleInfo, formatScheduleDate, timeZoneLabel } from '../../../shared/schedule'

definePageMeta({ layout: 'admin', middleware: 'cms-auth' })

/** Tout ce qui est programmé sur le site : une ligne par contenu, action et heure (les langues y sont réunies). */
type Item = ScheduleInfo & { id: string; type: string; typeLabel: string; title: string; canManage: boolean }
type Line = Omit<Item, 'locale'> & { locales: string[] }

const data = ref(await cmsApi<{ items: Item[]; timeZone: string; trigger: 'ok' | 'missing' }>('/api/cms/schedules'))
useState<unknown[]>('cms-scheduled', () => []).value = data.value.items
const me = useCmsUser()
const schema = await useCmsSchema()
const multi = schema.value.site.locales.length > 1
const zone = computed(() => timeZoneLabel(data.value.timeZone))

const lines = computed(() => {
  const out = new Map<string, Line>()
  for (const { locale, ...item } of data.value.items) {
    const key = [item.id, item.action, item.at, item.failedAt ?? ''].join('|')
    const line = out.get(key) ?? { ...item, locales: [] }
    line.locales.push(locale)
    out.set(key, line)
  }
  return [...out.values()]
})
const failed = computed(() => lines.value.filter(l => l.failedAt))
const coming = computed(() => lines.value.filter(l => !l.failedAt))
const when = (at: string) => formatScheduleDate(at, data.value.timeZone)
</script>

<template>
  <section class="max-w-4xl mx-auto">
    <div class="mb-6">
      <h1 class="text-2xl font-bold">Programmé</h1>
      <p class="text-sm text-base-content/60">
        Les contenus qui seront mis en ligne ou retirés du site tout seuls. Les heures sont celles du site ({{ zone }}).
        Ouvrez un contenu pour modifier ou annuler sa programmation.
      </p>
    </div>

    <div v-if="data.trigger === 'missing' && coming.length && me?.role === 'admin'" class="alert alert-warning alert-soft text-sm mb-4" data-cms-schedule="trigger-missing">
      <TriangleAlert :size="18" />
      <span>La tâche planifiée du site n'est pas activée : chaque action sera faite à la première visite du site après l'heure prévue, pas forcément à l'heure exacte. La personne qui s'occupe du site peut l'activer (voir son README, « Publication programmée »).</span>
    </div>

    <p v-if="!lines.length" class="card bg-base-100 border border-base-300 p-6 text-sm text-base-content/60">
      Rien n'est programmé. Pour programmer une mise en ligne, ouvrez un contenu puis « Programmer… », à côté de « Publier ».
    </p>

    <template v-for="group in [{ title: 'En échec : à reprendre', items: failed }, { title: 'À venir', items: coming }]" :key="group.title">
      <div v-if="group.items.length" class="mb-6">
        <h2 class="text-sm font-semibold mb-2">{{ group.title }} <span class="opacity-60">{{ group.items.length }}</span></h2>
        <div class="card bg-base-100 border border-base-300 divide-y divide-base-300">
          <NuxtLink v-for="l in group.items" :key="`${l.id}-${l.action}-${l.at}`" :to="adminEntryPath(l.type, l.id)" class="flex items-start gap-3 p-4 hover:bg-base-200" data-cms-schedule="row">
            <component :is="l.failedAt ? TriangleAlert : l.action === 'publish' ? CalendarClock : EyeOff" :size="18" class="mt-0.5 shrink-0" :class="l.failedAt ? 'text-error' : 'text-base-content/50'" />
            <div class="min-w-0 grow">
              <div class="flex flex-wrap items-baseline gap-x-3">
                <span class="font-medium">{{ l.title || 'Sans titre' }}</span>
                <span class="text-xs text-base-content/50">{{ l.typeLabel }}</span>
                <span v-if="multi" class="flex gap-1"><span v-for="code in l.locales" :key="code" class="badge badge-xs badge-neutral uppercase">{{ code }}</span></span>
              </div>
              <div class="text-sm" :class="l.failedAt ? 'text-error' : 'text-base-content/80'">
                {{ l.action === 'publish' ? 'Mise en ligne' : 'Retrait du site' }} {{ when(l.at) }}
                <span class="text-base-content/60">· programmé par {{ l.byId === me?.id ? 'vous' : l.by }}</span>
              </div>
              <p v-if="l.failedAt" class="text-sm text-base-content/70 mt-1">N'a pas pu se faire : {{ l.error }}</p>
            </div>
          </NuxtLink>
        </div>
      </div>
    </template>
  </section>
</template>
