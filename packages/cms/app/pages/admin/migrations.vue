<script setup lang="ts">
import { CircleCheck, Clock, OctagonAlert, TriangleAlert } from '@lucide/vue'

definePageMeta({ layout: 'admin', middleware: ['cms-auth', 'cms-admin'] })

type Level = 'auto' | 'confirm' | 'blocked' | 'waiting'
type Item = { id: string; level: Level; title: string; text: string; warning?: string; choices: { id: string; label: string; help: string }[] }
type Report = { pending: Item[]; applied: string[]; log: { at: string; by: string | null; lines: string[] }[]; siteChanged: boolean }

const toast = useCmsToast()
const pendingCount = useCmsMigrationsPending()
const report = ref<Report>(await cmsApi<Report>('/api/cms/migrations'))
/** Choix faits sur les points bloqués : { identifiant: choix }. */
const choices = reactive<Record<string, string>>({})
const busy = ref(false)

const blocked = computed(() => report.value.pending.filter(i => i.level === 'blocked'))
const others = computed(() => report.value.pending.filter(i => i.level !== 'blocked'))
/** Ce que le bouton appliquera : tout ce qui n'est pas bloqué, plus les points bloqués pour lesquels un choix est coché. */
const selected = computed(() => report.value.pending.filter(i => i.level !== 'blocked' || choices[i.id]))
watchEffect(() => { pendingCount.value = report.value.pending.length })

async function apply() {
  const dataLoss = selected.value.some(i => i.warning)
  if (!confirm(`Appliquer ${selected.value.length > 1 ? `ces ${selected.value.length} changements` : 'ce changement'} aux contenus du site ?${dataLoss ? '\n\nLes valeurs qui ne peuvent pas suivre sont mises de côté en base : elles ne seront plus affichées.' : ''}`)) return
  busy.value = true
  try {
    const result = await cmsApi<Report>('/api/cms/migrations', { method: 'POST', body: { confirmed: selected.value.map(i => i.id), choices } })
    for (const id of Object.keys(choices)) delete choices[id]
    report.value = result
    toast.success(result.applied.length
      ? `${result.applied.length > 1 ? `${result.applied.length} changements appliqués` : 'Changement appliqué'}${result.siteChanged ? ', site mis à jour' : ''}`
      : 'Rien n\'a pu être appliqué')
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
  busy.value = false
}

const formatDate = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
</script>

<template>
  <section class="max-w-4xl mx-auto">
    <div class="mb-6">
      <h1 class="text-2xl font-bold">Structure des contenus</h1>
      <p class="text-sm text-base-content/60">
        Quand le site évolue (un champ renommé, une rubrique réorganisée), les contenus déjà saisis doivent suivre.
        La plupart des changements sont appliqués automatiquement ; ceux qui demandent votre accord apparaissent ici. Rien n'est jamais supprimé.
      </p>
    </div>

    <div v-if="!report.pending.length" role="status" class="alert alert-success alert-soft">
      <CircleCheck :size="18" />
      <span>Les contenus sont à jour avec la structure du site. Rien à valider.</span>
    </div>

    <template v-else>
      <div v-if="blocked.length" class="mb-6">
        <h2 class="font-semibold mb-2 flex items-center gap-2"><OctagonAlert :size="18" class="text-error" />Bloqué : une décision est nécessaire</h2>
        <div class="card bg-base-100 border border-base-300 divide-y divide-base-300">
          <div v-for="item in blocked" :key="item.id" class="p-4 space-y-2" :data-migration="item.id">
            <div class="font-medium">{{ item.title }}</div>
            <p class="text-sm">{{ item.text }}</p>
            <p v-if="item.warning" class="text-sm text-error">{{ item.warning }}</p>
            <label v-for="choice in item.choices" :key="choice.id" class="flex items-start gap-3 cursor-pointer rounded-field border border-base-300 p-3">
              <input type="checkbox" class="checkbox checkbox-sm mt-0.5" :checked="choices[item.id] === choice.id" @change="($event.target as HTMLInputElement).checked ? choices[item.id] = choice.id : delete choices[item.id]">
              <span class="text-sm"><span class="font-medium">{{ choice.label }}</span><br><span class="text-base-content/60">{{ choice.help }}</span></span>
            </label>
            <p v-if="!item.choices.length" class="text-sm text-base-content/60">Ce point ne peut pas être réglé d'ici : il demande une correction du site par la personne qui le développe, ou la suppression des contenus en trop.</p>
          </div>
        </div>
      </div>

      <div v-if="others.length" class="mb-6">
        <h2 class="font-semibold mb-2 flex items-center gap-2"><TriangleAlert :size="18" class="text-warning" />À valider</h2>
        <div class="card bg-base-100 border border-base-300 divide-y divide-base-300">
          <div v-for="item in others" :key="item.id" class="p-4 space-y-1" :data-migration="item.id">
            <div class="font-medium flex items-center gap-2">
              {{ item.title }}
              <span v-if="item.level === 'waiting'" class="badge badge-sm badge-ghost"><Clock :size="12" />en attente du point précédent</span>
            </div>
            <p class="text-sm">{{ item.text }}</p>
            <p v-if="item.warning" class="text-sm text-warning-content bg-warning/20 rounded-field px-2 py-1">{{ item.warning }}</p>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <button class="btn btn-primary" :disabled="busy || !selected.length" @click="apply">
          {{ selected.length > 1 ? `Appliquer les ${selected.length} changements` : 'Appliquer le changement' }}
        </button>
        <span v-if="blocked.some(i => !choices[i.id])" class="text-sm text-base-content/60">Les points bloqués sans choix coché ne seront pas appliqués.</span>
      </div>
    </template>

    <div v-if="report.log.length" class="mt-10">
      <h2 class="font-semibold mb-2">Derniers changements appliqués</h2>
      <div class="card bg-base-100 border border-base-300 divide-y divide-base-300">
        <div v-for="(entry, i) in report.log" :key="i" class="p-4">
          <div class="text-xs text-base-content/50 mb-1">{{ formatDate(entry.at) }} · {{ entry.by ? `validé par ${entry.by}` : 'automatique' }}</div>
          <ul class="text-sm list-disc pl-5 space-y-0.5">
            <li v-for="(line, j) in entry.lines" :key="j">{{ line }}</li>
          </ul>
        </div>
      </div>
    </div>
  </section>
</template>
