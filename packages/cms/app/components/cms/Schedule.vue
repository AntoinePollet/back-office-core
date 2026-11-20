<script setup lang="ts">
import { CalendarClock, TriangleAlert } from '@lucide/vue'
import {
  DEFAULT_TIME_ZONE, SCHEDULE_STEP_MINUTES, type ScheduleAction, type ScheduleGroup, type ScheduleInfo,
  canSchedule, defaultScheduleInputs, formatScheduleDate, groupSchedules, scheduleProblem, scheduleSentence, timeZoneLabel, zonedInputs, zonedToInstant,
} from '../../../shared/schedule'

/**
 * Publication programmée dans le formulaire d'un contenu (règles : shared/schedule.ts).
 * Le composant est posé deux fois par `EntryEditor.vue` : `part="button"` à côté de « Publier » (le bouton
 * « Programmer… » et sa fenêtre), `part="notice"` sous l'en-tête (ce qui est programmé, à modifier ou annuler).
 */
const props = defineProps<{
  part: 'button' | 'notice'
  type: string
  /** Identifiant du contenu ; vide tant qu'il n'est pas enregistré. */
  id: string | null
  def: Record<string, any>
  locales: readonly string[]
  /** État de chaque langue dans le formulaire (son statut suffit ici). */
  states: Record<string, { status: string | null }>
  /** Des modifications ne sont pas enregistrées : c'est le brouillon enregistré qui sera mis en ligne. */
  dirty: boolean
  schedules: ScheduleInfo[]
}>()
const emit = defineEmits<{ 'update:schedules': [list: ScheduleInfo[]]; errors: [errors: Record<string, Record<string, string>>] }>()

const toast = useCmsToast()
const me = useCmsUser()
const access = useCmsAccess(props.type)
// Lu sans attente (le formulaire l'a déjà chargé) : un composant qui attend à sa création retarderait tout le formulaire.
const timeZone = useState<{ site?: { timeZone?: string } } | null>('cms-schema').value?.site?.timeZone ?? DEFAULT_TIME_ZONE
const zoneLabel = timeZoneLabel(timeZone)
const multi = props.locales.length > 1
const allowed = computed(() => canSchedule(props.def, access))
const localeName = (l: string) => new Intl.DisplayNames(['fr'], { type: 'language' }).of(l) ?? l

/** La fenêtre est ouverte par l'un ou l'autre des deux emplacements : son état est commun. */
const dialog = useState<{ action: ScheduleAction; date: string; time: string; locales: string[]; editing: boolean } | null>('cms-schedule-dialog', () => null)
const trigger = useState<'ok' | 'missing' | null>('cms-schedule-trigger', () => null)
const busy = ref(false)
/** Le menu compte ce qui est programmé sur le site : il est tenu à jour après chaque changement fait ici. */
const menu = useState<unknown[]>('cms-scheduled', () => [])
const refreshMenu = () => cmsApi<{ items: unknown[] }>('/api/cms/schedules').then((r) => { menu.value = r.items }, () => {})
onBeforeUnmount(() => { if (props.part === 'button') dialog.value = null })

const groups = computed(() => groupSchedules(props.schedules, props.locales))
/** Les langues ne sont nommées que si elles ne sont pas toutes concernées. */
const sentence = (g: ScheduleGroup) => scheduleSentence({ ...g, locales: multi && g.locales.length < filled.value.length ? g.locales : [] }, timeZone, { me: g.byId === me.value?.id })
const filled = computed(() => props.locales.filter(l => props.states[l]?.status))

// ───── Fenêtre ─────

const chosen = computed(() => (dialog.value ? zonedToInstant(dialog.value.date, dialog.value.time, timeZone) : null))
const chosenAt = computed(() => (chosen.value && 'at' in chosen.value ? chosen.value.at : null))
const status = (l: string) => (props.states[l]?.status ?? null) as 'draft' | 'published' | 'changed' | null
/** Pourquoi cette langue ne peut pas être programmée pour cette action, ou null. */
function problem(action: ScheduleAction, l: string, at: Date | null) {
  return scheduleProblem({
    action, status: status(l),
    // Sans heure valide encore saisie, on juge à très long terme : seules les règles de statut jouent.
    at: at ?? new Date(8.64e15),
    others: props.schedules.filter(s => s.locale === l && !s.failedAt && s.action !== action),
  })
}
const possible = (action: ScheduleAction) => props.locales.some(l => !problem(action, l, null))
const timeError = computed(() => {
  if (!dialog.value || !chosen.value) return null
  if ('error' in chosen.value) return chosen.value.error
  return chosen.value.at.getTime() <= Date.now() ? 'Cette heure est déjà passée.' : null
})
/** L'heure du site n'est pas celle de cet ordinateur : on dit aussi ce que cela donne ici. */
const hereToo = computed(() => {
  if (!chosenAt.value) return null
  const here = Intl.DateTimeFormat().resolvedOptions().timeZone
  const a = zonedInputs(chosenAt.value, timeZone), b = zonedInputs(chosenAt.value, here)
  return a.date === b.date && a.time === b.time ? null : formatScheduleDate(chosenAt.value, here)
})

function open(group?: ScheduleGroup) {
  const action: ScheduleAction = group?.action ?? (possible('publish') ? 'publish' : 'unpublish')
  // Une programmation en échec se reprogramme à partir de demain, pas de sa date passée.
  const when = group && !group.failedAt ? zonedInputs(group.at, timeZone) : defaultScheduleInputs(timeZone)
  dialog.value = { action, ...when, locales: group?.locales ?? props.locales.filter(l => !problem(action, l, null)), editing: !!group && !group.failedAt }
  if (!trigger.value) cmsApi<{ trigger: 'ok' | 'missing' }>('/api/cms/schedules').then((r) => { trigger.value = r.trigger }).catch(() => {})
}
function pickAction(action: ScheduleAction) {
  if (!dialog.value) return
  dialog.value.action = action
  dialog.value.locales = props.locales.filter(l => !problem(action, l, null))
}

async function submit() {
  const d = dialog.value
  if (!d || timeError.value) return
  if (!d.locales.length) return toast.error('Choisissez au moins une langue.')
  busy.value = true
  try {
    const res = await cmsApi<{ schedules: ScheduleInfo[]; trigger: 'ok' | 'missing' }>(`/api/cms/entries/${props.type}/${props.id}/schedule`, {
      method: 'PUT', body: { action: d.action, date: d.date, time: d.time, ...(multi ? { locales: d.locales } : {}) },
    })
    trigger.value = res.trigger
    emit('update:schedules', res.schedules)
    emit('errors', {})
    refreshMenu()
    const at = chosenAt.value
    dialog.value = null
    toast.success(`${d.action === 'publish' ? 'Mise en ligne programmée' : 'Retrait programmé'}${at ? ` ${formatScheduleDate(at, timeZone)} (${zoneLabel})` : ''}`)
  }
  catch (e: any) {
    // Champs à corriger : ils sont montrés dans le formulaire, comme pour une publication refusée.
    const found = e?.data?.data?.errors
    if (found) { emit('errors', found); dialog.value = null }
    toast.error(cmsErrorMessage(e))
  }
  busy.value = false
}

async function cancel(group: ScheduleGroup) {
  const what = group.action === 'publish' ? 'la mise en ligne programmée' : 'le retrait programmé'
  if (!group.failedAt && !confirm(`Annuler ${what} ${formatScheduleDate(group.at, timeZone)} ? Rien ne changera sur le site à cette date.`)) return
  try {
    const res = await cmsApi<{ schedules: ScheduleInfo[] }>(`/api/cms/entries/${props.type}/${props.id}/schedule?action=${group.action}&locales=${group.locales.join(',')}`, { method: 'DELETE' })
    emit('update:schedules', res.schedules)
    refreshMenu()
    toast.success(group.failedAt ? 'Programmation écartée' : 'Programmation annulée')
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
}
</script>

<template>
  <template v-if="part === 'button'">
    <button
      v-if="allowed && id" type="button" class="btn btn-sm" data-cms-schedule="open" aria-label="Programmer…" :disabled="dirty || (!possible('publish') && !possible('unpublish'))"
      :title="dirty ? 'Enregistrez d\'abord vos modifications' : 'Mettre en ligne ou retirer du site à une date et une heure'" @click="open()"
    >
      <CalendarClock :size="16" /><span class="hidden sm:inline">Programmer…</span>
    </button>

    <!-- Hors de l'en-tête : son flou d'arrière-plan enfermerait la fenêtre dans le bandeau. -->
    <Teleport to="body">
      <div v-if="dialog" class="modal modal-open" data-cms-schedule="dialog">
        <form class="modal-box space-y-4" @submit.prevent="submit">
          <h3 class="font-bold text-lg">{{ dialog.editing ? 'Modifier la programmation' : 'Programmer' }}</h3>

          <div v-if="!dialog.editing" class="space-y-2">
            <label class="flex items-start gap-3 cursor-pointer" :class="{ 'opacity-50': !possible('publish') }">
              <input type="radio" class="radio radio-sm mt-0.5" name="cms-schedule-action" :checked="dialog.action === 'publish'" :disabled="!possible('publish')" @change="pickAction('publish')">
              <span class="text-sm"><span class="font-medium">Mettre en ligne</span><br><span class="text-base-content/60">{{ possible('publish') ? 'Le brouillon sera publié à ce moment-là.' : 'Tout est déjà en ligne : il n\'y a rien à mettre en ligne.' }}</span></span>
            </label>
            <label class="flex items-start gap-3 cursor-pointer" :class="{ 'opacity-50': !possible('unpublish') }">
              <input type="radio" class="radio radio-sm mt-0.5" name="cms-schedule-action" :checked="dialog.action === 'unpublish'" :disabled="!possible('unpublish')" @change="pickAction('unpublish')">
              <span class="text-sm"><span class="font-medium">Retirer du site</span><br><span class="text-base-content/60">{{ possible('unpublish') ? 'Le contenu ne sera plus visible ; il reste ici, en brouillon.' : 'Ce contenu n\'est pas en ligne : programmez d\'abord sa mise en ligne.' }}</span></span>
            </label>
          </div>
          <p v-else class="text-sm font-medium">{{ dialog.action === 'publish' ? 'Mise en ligne' : 'Retrait du site' }}</p>

          <div class="grid grid-cols-2 gap-3">
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Date</legend>
              <input v-model="dialog.date" type="date" class="input w-full" required data-cms-schedule="date">
            </fieldset>
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Heure</legend>
              <input v-model="dialog.time" type="time" class="input w-full" :step="SCHEDULE_STEP_MINUTES * 60" required data-cms-schedule="time">
            </fieldset>
          </div>
          <p v-if="timeError" class="text-sm text-error" data-cms-schedule="time-error">{{ timeError }}</p>
          <p v-else class="text-xs text-base-content/70" data-cms-schedule="zone">
            C'est l'heure du site : <strong>{{ zoneLabel }}</strong>.
            <template v-if="hereToo">Pour vous, ce sera {{ hereToo }}.</template>
            <template v-if="trigger === 'missing'"><br>Sur ce site, la tâche planifiée n'est pas activée : ce sera fait à la première visite du site après cette heure. Parlez-en à la personne qui s'occupe du site.</template>
            <template v-else-if="trigger === 'ok'"><br>Ce sera fait à l'heure dite, à {{ SCHEDULE_STEP_MINUTES }} minutes près.</template>
          </p>

          <fieldset v-if="multi" class="fieldset">
            <legend class="fieldset-legend">Langues</legend>
            <label v-for="l in locales" :key="l" class="flex items-center gap-3 py-0.5" :class="problem(dialog.action, l, chosenAt) ? 'opacity-50' : 'cursor-pointer'" :title="problem(dialog.action, l, chosenAt) ?? ''">
              <input v-model="dialog.locales" type="checkbox" class="checkbox checkbox-sm" :value="l" :disabled="!!problem(dialog.action, l, chosenAt)">
              <span class="text-sm capitalize">{{ localeName(l) }}</span>
              <span v-if="problem(dialog.action, l, chosenAt)" class="text-xs normal-case">{{ status(l) ? (dialog.action === 'publish' ? 'déjà en ligne' : 'pas en ligne') : 'pas encore traduit' }}</span>
            </label>
          </fieldset>

          <p v-if="dialog.action === 'publish'" class="text-xs text-base-content/70">
            C'est le brouillon <strong>tel qu'il sera à ce moment-là</strong> qui sera mis en ligne : vous pouvez continuer à le corriger d'ici là.
            S'il n'est plus complet le jour venu, rien n'est publié et l'échec est signalé ici.
          </p>
          <div class="modal-action">
            <button type="button" class="btn" @click="dialog = null">Fermer</button>
            <button class="btn btn-primary" :disabled="busy || !!timeError || (multi && !dialog.locales.length)" data-cms-schedule="submit">{{ dialog.editing ? 'Enregistrer' : 'Programmer' }}</button>
          </div>
        </form>
        <div class="modal-backdrop" @click="dialog = null" />
      </div>
    </Teleport>
  </template>

  <div v-else-if="groups.length" class="space-y-2 mb-4" data-cms-schedule="notice">
    <div v-for="g in groups" :key="`${g.action}-${g.at}-${g.locales.join()}`" class="alert alert-soft alert-vertical sm:alert-horizontal text-sm items-start text-left justify-items-start" :class="g.failedAt ? 'alert-error' : 'alert-info'">
      <component :is="g.failedAt ? TriangleAlert : CalendarClock" :size="18" class="mt-0.5 shrink-0" />
      <div class="min-w-0">
        <div class="font-medium">{{ sentence(g) }}</div>
        <div v-if="!g.failedAt && g.action === 'publish'" class="text-xs opacity-80">
          {{ access.publish ? 'Le brouillon sera mis en ligne tel qu\'il sera à ce moment-là : vous pouvez continuer à le modifier.' : 'Le brouillon partira en ligne tel qu\'il est : seule une personne qui peut publier peut encore le modifier.' }}
        </div>
      </div>
      <div v-if="allowed" class="flex gap-2 shrink-0">
        <button type="button" class="btn btn-xs" :disabled="dirty" :title="dirty ? 'Enregistrez d\'abord vos modifications' : ''" @click="open(g)">{{ g.failedAt ? 'Reprogrammer' : 'Modifier' }}</button>
        <button type="button" class="btn btn-xs btn-ghost" @click="cancel(g)">{{ g.failedAt ? 'Écarter' : 'Annuler' }}</button>
      </div>
    </div>
  </div>
</template>
