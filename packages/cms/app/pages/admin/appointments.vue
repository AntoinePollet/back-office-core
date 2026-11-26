<script setup lang="ts">
import { CalendarCheck, CalendarPlus, Copy, Download, Plus, Trash2, TriangleAlert, X } from '@lucide/vue'
import { APPOINTMENT_STATUS_LABELS, type AppointmentSettings, type AppointmentStatus, WEEKDAYS, WEEKDAY_LABELS, formatAppointment, formatDuration } from '../../../shared/appointments'

/**
 * Rendez-vous pris sur le site (module `appointments`) : l'agenda à venir, l'historique, et les réglages
 * (prestations, horaires, délais, fermetures). Les réglages sont réservés à l'administrateur.
 */
definePageMeta({ layout: 'admin', middleware: ['cms-auth', 'cms-editor'] })

type Appointment = {
  id: string; service: string; serviceLabel: string; start: string; end: string; duration: number; status: AppointmentStatus
  name: string; email: string; phone: string | null; note: string | null; locale: string; location: string | null
  paid: string; channel: string; refundDue: boolean; createdBy: string | null; cancelledBy: 'visitor' | 'staff' | 'expired' | null; createdAt: string
}
type Data = {
  upcoming: Appointment[]; past: Appointment[]; settings: AppointmentSettings; timeZone: string; today: string
  mail: { configured: boolean; module: { id: string; label: string } | null }
  deposit: { available: boolean; currency: string | null }
  feedUrl: string; max: number
}

const load = () => cmsApi<Data>('/api/cms/appointments')
const data = ref(await load().catch((e) => { throw createError({ statusCode: e?.statusCode ?? 500, message: cmsErrorMessage(e), fatal: true }) }))
const user = useCmsUser()
const isAdmin = computed(() => user.value?.role === 'admin')
const toast = useCmsToast()
const route = useRoute()

const tab = ref<'upcoming' | 'past' | 'settings'>('upcoming')
const tabs = computed(() => [
  { id: 'upcoming' as const, label: 'À venir', count: data.value.upcoming.length },
  { id: 'past' as const, label: 'Passés et annulés', count: data.value.past.length },
  ...(isAdmin.value ? [{ id: 'settings' as const, label: 'Réglages', count: null }] : []),
])
const when = (a: Appointment) => formatAppointment(a.start, data.value.timeZone)
const dayKey = (a: Appointment) => new Intl.DateTimeFormat('en-CA', { timeZone: data.value.timeZone }).format(new Date(a.start))
const dayTitle = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
const time = (a: Appointment) => new Date(a.start).toLocaleTimeString('fr-FR', { timeZone: data.value.timeZone, hour: '2-digit', minute: '2-digit' })
/** Les rendez-vous à venir, jour par jour. */
const agenda = computed(() => {
  const days = new Map<string, Appointment[]>()
  for (const a of data.value.upcoming) days.set(dayKey(a), [...(days.get(dayKey(a)) ?? []), a])
  return [...days].map(([key, items]) => ({ key, title: key === data.value.today ? `Aujourd'hui, ${dayTitle(key)}` : dayTitle(key), items }))
})
const statusClass: Record<AppointmentStatus, string> = { confirmed: 'badge-success', pending: 'badge-warning', cancelled: 'badge-neutral' }
const cancelledBy = { visitor: 'par la personne', staff: 'par le site', expired: 'acompte jamais réglé' }
// Un rendez-vous désigné dans l'adresse (lien d'un e-mail de workflow) est mis en évidence.
const focused = computed(() => (typeof route.query.rdv === 'string' ? route.query.rdv : null))
onMounted(() => { if (focused.value && data.value.past.some(a => a.id === focused.value)) tab.value = 'past' })

async function refresh() { data.value = await load() }
async function act(run: () => Promise<unknown>, done: string) {
  try {
    await run()
    await refresh()
    toast.success(done)
    return true
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
    return false
  }
}

// ───── Annuler (avec un mot pour la personne), effacer ─────
const cancelling = ref<Appointment | null>(null)
const cancelMessage = ref('')
const cancelDialog = ref<HTMLDialogElement>()
async function askCancel(a: Appointment) {
  cancelling.value = a
  cancelMessage.value = ''
  await nextTick()
  cancelDialog.value?.showModal()
}
async function confirmCancel() {
  const a = cancelling.value
  if (!a) return
  if (await act(() => cmsApi(`/api/cms/appointments/${a.id}/cancel`, { method: 'POST', body: { message: cancelMessage.value } }), 'Rendez-vous annulé')) cancelDialog.value?.close()
}
function erase(a: Appointment) {
  if (!confirm(`Effacer le rendez-vous de ${a.name} (${when(a)}) ? Son nom et ses coordonnées disparaissent du back-office.`)) return
  return act(() => cmsApi(`/api/cms/appointments/${a.id}`, { method: 'DELETE' }), 'Rendez-vous effacé')
}

// ───── Saisir un rendez-vous (pris par téléphone, par exemple) ─────
const adding = ref(false)
const addDialog = ref<HTMLDialogElement>()
const draft = reactive({ service: '', date: '', start: '', name: '', email: '', phone: '', note: '' })
const freeSlots = ref<{ at: string; time: string }[]>([])
const addError = ref<string | null>(null)
async function openAdd() {
  Object.assign(draft, { service: data.value.settings.services[0]?.id ?? '', date: data.value.today, start: '', name: '', email: '', phone: '', note: '' })
  addError.value = null
  await nextTick()
  addDialog.value?.showModal()
  loadFreeSlots()
}
async function loadFreeSlots() {
  draft.start = ''
  if (!draft.service || !draft.date) { freeSlots.value = []; return }
  freeSlots.value = (await cmsApi<{ slots: { at: string; time: string }[] }>('/api/cms/appointments/slots', { query: { service: draft.service, date: draft.date } }).catch(() => ({ slots: [] }))).slots
}
watch(() => [draft.service, draft.date], loadFreeSlots)
async function saveAdd() {
  if (adding.value) return
  if (!draft.start) { addError.value = 'Choisissez une heure.'; return }
  adding.value = true
  addError.value = null
  try {
    await cmsApi('/api/cms/appointments', { method: 'POST', body: { ...draft } })
    addDialog.value?.close()
    await refresh()
    toast.success('Rendez-vous enregistré')
  }
  catch (e) {
    addError.value = cmsErrorMessage(e, 'Le rendez-vous n\'a pas pu être enregistré.')
    if ((e as { statusCode?: number })?.statusCode === 409) loadFreeSlots()
  }
  finally {
    adding.value = false
  }
}

// ───── Réglages (administrateur) ─────
const form = ref<AppointmentSettings>(structuredClone(toRaw(data.value.settings)))
const saving = ref(false)
const settingsErrors = ref<string[]>([])
const dirty = computed(() => JSON.stringify(form.value) !== JSON.stringify(data.value.settings))
const addService = () => form.value.services.push({ id: '', label: '', duration: 30, description: '', deposit: 0 })
const addRange = (day: typeof WEEKDAYS[number]) => { const last = form.value.hours[day].at(-1); form.value.hours[day].push(last ? [last[1], last[1]] : ['09:00', '12:00']) }
const addClosure = () => form.value.closed.push({ from: data.value.today, to: data.value.today, label: '' })
async function saveSettings() {
  saving.value = true
  settingsErrors.value = []
  try {
    const saved = await cmsApi<AppointmentSettings>('/api/cms/appointments/settings', { method: 'PUT', body: form.value })
    await refresh()
    form.value = structuredClone(saved)
    toast.success('Réglages enregistrés')
  }
  catch (e: any) {
    settingsErrors.value = e?.data?.data?.errors ?? [cmsErrorMessage(e, 'Les réglages n\'ont pas pu être enregistrés.')]
  }
  finally {
    saving.value = false
  }
}
async function copyFeed() {
  try { await navigator.clipboard.writeText(data.value.feedUrl); toast.success('Adresse copiée') }
  catch { toast.error('Copie impossible : sélectionnez l\'adresse à la main.') }
}
</script>

<template>
  <section class="max-w-6xl mx-auto" data-appointments>
    <div class="flex flex-wrap items-center gap-3 mb-6">
      <div class="grow min-w-0">
        <h1 class="text-2xl font-bold">Rendez-vous</h1>
        <p class="text-sm text-base-content/60">Les rendez-vous pris sur le site, aux heures du site ({{ data.timeZone }}).</p>
      </div>
      <a class="btn btn-sm" href="/api/cms/appointments/export" download data-appointments-export><Download :size="16" />Exporter</a>
      <button class="btn btn-primary btn-sm" data-appointments-add @click="openAdd"><CalendarPlus :size="16" />Saisir un rendez-vous</button>
    </div>

    <div v-if="!data.mail.configured" class="alert alert-warning mb-4" role="alert" data-appointments-nomail>
      <TriangleAlert :size="18" />
      <span>
        Aucun envoi d'e-mails n'est réglé sur ce site : les rendez-vous sont enregistrés, mais ni la confirmation ni le rappel ne partent.
        <NuxtLink v-if="isAdmin" to="/admin/modules" class="link">Régler Brevo ou Resend</NuxtLink>
      </span>
    </div>
    <div v-if="!data.deposit.available && data.settings.services.some(s => s.deposit > 0)" class="alert alert-warning mb-4" role="alert" data-appointments-nodeposit>
      <TriangleAlert :size="18" />
      <span>Un acompte est réglé sur une prestation, mais le module Stripe n'est pas actif et réglé : les rendez-vous sont pris sans acompte.</span>
    </div>

    <div role="tablist" class="tabs tabs-box tabs-sm mb-3 w-fit">
      <a v-for="t in tabs" :key="t.id" role="tab" class="tab gap-1.5" :class="{ 'tab-active': tab === t.id }" :data-appointments-tab="t.id" @click="tab = t.id">
        {{ t.label }}<span v-if="t.count !== null" class="badge badge-xs badge-ghost">{{ t.count }}</span>
      </a>
    </div>

    <!-- À venir : jour par jour -->
    <template v-if="tab === 'upcoming'">
      <div v-if="!agenda.length" class="card bg-base-100 border border-base-300 p-10 text-center items-center gap-2" data-appointments-empty>
        <CalendarCheck :size="32" class="text-base-content/30" />
        <p class="font-medium">Aucun rendez-vous à venir.</p>
        <p class="text-sm text-base-content/60 max-w-md">Ils apparaîtront ici dès qu'un visiteur en prendra un sur le site.</p>
      </div>
      <div v-for="day in agenda" :key="day.key" class="card bg-base-100 border border-base-300 mb-3" :data-appointments-day="day.key">
        <h2 class="font-semibold px-4 py-3 border-b border-base-300 first-letter:uppercase">{{ day.title }}</h2>
        <ul class="divide-y divide-base-300">
          <li v-for="a in day.items" :key="a.id" class="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3" :class="{ 'bg-primary/5': focused === a.id }" data-appointment :data-status="a.status">
            <div class="w-16 shrink-0 font-semibold tabular-nums">{{ time(a) }}</div>
            <div class="grow min-w-0">
              <div class="font-medium break-words">{{ a.name }} <span class="font-normal text-base-content/60">· {{ a.serviceLabel }}, {{ formatDuration(a.duration) }}</span></div>
              <div class="text-sm text-base-content/70 break-all">
                <a :href="`mailto:${a.email}`" class="hover:underline">{{ a.email }}</a><template v-if="a.phone"> · <a :href="`tel:${a.phone}`" class="hover:underline">{{ a.phone }}</a></template>
              </div>
              <p v-if="a.note" class="text-sm text-base-content/70 whitespace-pre-line break-words mt-1">{{ a.note }}</p>
              <div class="flex flex-wrap gap-1.5 mt-1.5">
                <span v-if="a.status === 'pending'" class="badge badge-sm badge-soft badge-warning">{{ APPOINTMENT_STATUS_LABELS.pending }}</span>
                <span v-if="a.paid" class="badge badge-sm badge-soft badge-success">Acompte reçu : {{ a.paid }}</span>
                <span v-if="a.createdBy" class="badge badge-sm badge-ghost">Saisi dans le back-office</span>
                <span v-else-if="a.channel && a.channel !== 'Accès direct'" class="badge badge-sm badge-ghost">{{ a.channel }}</span>
              </div>
            </div>
            <button class="btn btn-ghost btn-sm" data-appointment-cancel @click="askCancel(a)"><X :size="15" />Annuler</button>
          </li>
        </ul>
      </div>
    </template>

    <!-- Passés et annulés -->
    <div v-else-if="tab === 'past'" class="card bg-base-100 border border-base-300 overflow-x-auto">
      <table v-if="data.past.length" class="table table-sm">
        <thead><tr><th>Date</th><th>Personne</th><th class="hidden md:table-cell">Prestation</th><th>État</th><th><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>
          <tr v-for="a in data.past" :key="a.id" :class="{ 'bg-primary/5': focused === a.id }" data-appointment :data-status="a.status">
            <td class="whitespace-nowrap">{{ when(a) }}</td>
            <td class="min-w-0">
              <div class="font-medium">{{ a.name }}</div>
              <div class="text-xs text-base-content/60 break-all">{{ a.email }}<template v-if="a.phone"> · {{ a.phone }}</template></div>
            </td>
            <td class="hidden md:table-cell text-base-content/70">{{ a.serviceLabel }}</td>
            <td>
              <span class="badge badge-sm badge-soft whitespace-nowrap" :class="a.status === 'confirmed' ? 'badge-ghost' : statusClass[a.status]">{{ a.status === 'confirmed' ? 'Passé' : APPOINTMENT_STATUS_LABELS[a.status] }}</span>
              <div v-if="a.cancelledBy" class="text-xs text-base-content/50 mt-0.5">{{ cancelledBy[a.cancelledBy] }}</div>
              <div v-if="a.refundDue" class="text-xs text-warning mt-0.5" data-appointment-refund>Acompte reçu ({{ a.paid }}) : à rembourser dans Stripe s'il y a lieu.</div>
            </td>
            <td class="text-right"><button class="btn btn-ghost btn-xs btn-square text-error" title="Effacer" aria-label="Effacer" @click="erase(a)"><Trash2 :size="15" /></button></td>
          </tr>
        </tbody>
      </table>
      <p v-else class="p-10 text-center text-sm text-base-content/50">Aucun rendez-vous passé ou annulé.</p>
    </div>

    <!-- Réglages -->
    <!-- Sans la validation du navigateur : le serveur contrôle tout et explique chaque refus, en une phrase. -->
    <form v-else class="space-y-4" novalidate data-appointments-settings @submit.prevent="saveSettings">
      <div class="card bg-base-100 border border-base-300 p-4 sm:p-5 space-y-3">
        <div class="flex items-center gap-2">
          <h2 class="font-semibold grow">Prestations</h2>
          <button type="button" class="btn btn-sm" data-settings-add-service @click="addService"><Plus :size="15" />Ajouter</button>
        </div>
        <p class="text-sm text-base-content/60">Ce que le visiteur choisit en premier. La durée fixe la longueur du créneau.</p>
        <div v-for="(s, i) in form.services" :key="i" class="grid gap-2 sm:grid-cols-[minmax(0,2fr)_7rem_8rem_auto] items-end border-t border-base-300 pt-3 first:border-0 first:pt-0" data-settings-service>
          <label class="fieldset py-0"><span class="fieldset-legend">Nom</span><input v-model="s.label" class="input input-sm w-full" placeholder="Première consultation" required maxlength="80"></label>
          <label class="fieldset py-0"><span class="fieldset-legend">Durée (min)</span><input v-model.number="s.duration" type="number" min="5" max="480" step="5" class="input input-sm w-full" required></label>
          <label class="fieldset py-0">
            <span class="fieldset-legend">Acompte{{ data.deposit.currency ? ` (${data.deposit.currency.toUpperCase()})` : '' }}</span>
            <input v-model.number="s.deposit" type="number" min="0" step="0.01" class="input input-sm w-full" :title="data.deposit.available ? '0 : pas d\'acompte' : 'Demande le module Stripe, actif et réglé'">
          </label>
          <button type="button" class="btn btn-ghost btn-sm btn-square text-error" :disabled="form.services.length < 2" title="Retirer cette prestation" aria-label="Retirer cette prestation" @click="form.services.splice(i, 1)"><Trash2 :size="15" /></button>
          <label class="fieldset py-0 sm:col-span-4"><span class="fieldset-legend">Une phrase pour le visiteur (facultative)</span><input v-model="s.description" class="input input-sm w-full" maxlength="300"></label>
        </div>
      </div>

      <div class="card bg-base-100 border border-base-300 p-4 sm:p-5 space-y-2">
        <h2 class="font-semibold">Horaires d'une semaine ordinaire</h2>
        <p class="text-sm text-base-content/60">Les plages pendant lesquelles un rendez-vous peut avoir lieu. Un jour sans plage est fermé.</p>
        <div v-for="day in WEEKDAYS" :key="day" class="flex flex-wrap items-center gap-2 border-t border-base-300 pt-2 first-of-type:border-0" :data-settings-day="day">
          <div class="w-24 font-medium">{{ WEEKDAY_LABELS[day] }}</div>
          <span v-if="!form.hours[day].length" class="text-sm text-base-content/50">Fermé</span>
          <span v-for="(range, i) in form.hours[day]" :key="i" class="inline-flex items-center gap-1">
            <input v-model="range[0]" type="time" step="300" class="input input-sm w-28" :aria-label="`${WEEKDAY_LABELS[day]}, début`" required>
            <span class="text-base-content/50">–</span>
            <input v-model="range[1]" type="time" step="300" class="input input-sm w-28" :aria-label="`${WEEKDAY_LABELS[day]}, fin`" required>
            <button type="button" class="btn btn-ghost btn-xs btn-square" title="Retirer cette plage" aria-label="Retirer cette plage" @click="form.hours[day].splice(i, 1)"><X :size="14" /></button>
          </span>
          <button v-if="form.hours[day].length < 4" type="button" class="btn btn-ghost btn-xs" @click="addRange(day)"><Plus :size="13" />Plage</button>
        </div>
      </div>

      <div class="card bg-base-100 border border-base-300 p-4 sm:p-5">
        <h2 class="font-semibold mb-3">Règles de réservation</h2>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label class="fieldset py-0"><span class="fieldset-legend">Un créneau proposé toutes les (min)</span><input v-model.number="form.step" type="number" min="5" max="240" step="5" class="input input-sm w-full" data-settings-step required></label>
          <label class="fieldset py-0"><span class="fieldset-legend">Battement après un rendez-vous (min)</span><input v-model.number="form.buffer" type="number" min="0" max="120" step="5" class="input input-sm w-full" required></label>
          <label class="fieldset py-0"><span class="fieldset-legend">Réserver au moins (heures à l'avance)</span><input v-model.number="form.minNoticeHours" type="number" min="0" max="720" class="input input-sm w-full" required></label>
          <label class="fieldset py-0"><span class="fieldset-legend">Réserver jusqu'à (jours à l'avance)</span><input v-model.number="form.maxAdvanceDays" type="number" min="1" max="365" class="input input-sm w-full" required></label>
          <label class="fieldset py-0"><span class="fieldset-legend">Annulation en ligne jusqu'à (heures avant)</span><input v-model.number="form.cancelNoticeHours" type="number" min="0" max="720" class="input input-sm w-full" required></label>
          <label class="fieldset py-0"><span class="fieldset-legend">Rappel par e-mail (heures avant, 0 : aucun)</span><input v-model.number="form.reminderHours" type="number" min="0" max="168" class="input input-sm w-full" required></label>
          <label class="fieldset py-0 sm:col-span-2 lg:col-span-3"><span class="fieldset-legend">Lieu du rendez-vous (rappelé dans l'e-mail et l'agenda)</span><input v-model="form.location" class="input input-sm w-full" maxlength="200" placeholder="12 rue des Lilas, 69003 Lyon — ou « par téléphone »"></label>
        </div>
      </div>

      <div class="card bg-base-100 border border-base-300 p-4 sm:p-5 space-y-2">
        <div class="flex items-center gap-2">
          <h2 class="font-semibold grow">Fermetures</h2>
          <button type="button" class="btn btn-sm" data-settings-add-closure @click="addClosure"><Plus :size="15" />Ajouter</button>
        </div>
        <p class="text-sm text-base-content/60">Congés et jours fériés : aucun créneau n'est proposé ces jours-là. Les rendez-vous déjà pris ne sont pas annulés.</p>
        <p v-if="!form.closed.length" class="text-sm text-base-content/50">Aucune fermeture prévue.</p>
        <div v-for="(c, i) in form.closed" :key="i" class="flex flex-wrap items-center gap-2" data-settings-closure>
          <span class="text-sm">Du</span><input v-model="c.from" type="date" class="input input-sm w-40" aria-label="Premier jour fermé" required>
          <span class="text-sm">au</span><input v-model="c.to" type="date" class="input input-sm w-40" aria-label="Dernier jour fermé" required>
          <input v-model="c.label" class="input input-sm grow min-w-32" placeholder="Congés d'été" aria-label="Motif" maxlength="80">
          <button type="button" class="btn btn-ghost btn-sm btn-square text-error" title="Retirer cette fermeture" aria-label="Retirer cette fermeture" @click="form.closed.splice(i, 1)"><Trash2 :size="15" /></button>
        </div>
      </div>

      <div v-if="settingsErrors.length" class="alert alert-error alert-soft items-start" role="alert" data-settings-errors>
        <ul class="list-disc pl-4 text-sm"><li v-for="e in settingsErrors" :key="e">{{ e }}</li></ul>
      </div>
      <div class="flex items-center gap-3">
        <button class="btn btn-primary" :disabled="saving || !dirty" data-settings-save>{{ saving ? 'Enregistrement…' : 'Enregistrer les réglages' }}</button>
        <span v-if="dirty" class="text-sm text-base-content/60">Modifications non enregistrées.</span>
      </div>

      <div class="card bg-base-100 border border-base-300 p-4 sm:p-5 space-y-2">
        <h2 class="font-semibold">Voir les rendez-vous dans son agenda</h2>
        <p class="text-sm text-base-content/60">Abonnez votre agenda (Google Agenda, Outlook, Apple) à cette adresse : les rendez-vous y apparaissent tout seuls. Elle donne accès aux noms et coordonnées : ne la partagez pas.</p>
        <div class="join w-full">
          <input :value="data.feedUrl" readonly class="input input-sm join-item grow font-mono text-xs" aria-label="Adresse de l'agenda" data-appointments-feed @focus="($event.target as HTMLInputElement).select()">
          <button type="button" class="btn btn-sm join-item" @click="copyFeed"><Copy :size="14" />Copier</button>
        </div>
      </div>
    </form>

    <p v-if="tab !== 'settings'" class="text-xs text-base-content/50 mt-3">
      Un rendez-vous terminé est effacé au bout de treize mois. Annuler prévient la personne par e-mail ; effacer retire ses coordonnées sans la prévenir.
    </p>

    <!-- Annuler un rendez-vous -->
    <dialog ref="cancelDialog" class="modal" data-appointments-cancel-dialog>
      <form v-if="cancelling" class="modal-box" @submit.prevent="confirmCancel">
        <h3 class="font-bold text-lg">Annuler ce rendez-vous ?</h3>
        <p class="py-3">{{ cancelling.name }}, {{ when(cancelling) }} ({{ cancelling.serviceLabel }}).</p>
        <label class="fieldset py-0">
          <span class="fieldset-legend">Un mot pour la personne (facultatif)</span>
          <textarea v-model="cancelMessage" class="textarea w-full" rows="3" maxlength="500" placeholder="Empêchement de dernière minute : reprenez un créneau quand vous voulez." />
        </label>
        <p class="text-sm text-base-content/60 mt-2">
          <template v-if="cancelling.status === 'pending'">L'acompte n'a pas été réglé : la personne n'est pas prévenue.</template>
          <template v-else-if="data.mail.configured">Elle est prévenue par e-mail, et le créneau redevient libre.</template>
          <template v-else>Aucun envoi d'e-mails n'est réglé : pensez à la prévenir vous-même.</template>
          <template v-if="cancelling.paid"> L'acompte reçu ({{ cancelling.paid }}) se rembourse dans Stripe.</template>
        </p>
        <div class="modal-action">
          <button type="button" class="btn" @click="cancelDialog?.close()">Garder le rendez-vous</button>
          <button class="btn btn-error" data-appointments-cancel-confirm>Annuler le rendez-vous</button>
        </div>
      </form>
      <form method="dialog" class="modal-backdrop"><button aria-label="Fermer">Fermer</button></form>
    </dialog>

    <!-- Saisir un rendez-vous -->
    <dialog ref="addDialog" class="modal" data-appointments-add-dialog>
      <form class="modal-box space-y-3" @submit.prevent="saveAdd">
        <h3 class="font-bold text-lg">Saisir un rendez-vous</h3>
        <p class="text-sm text-base-content/60">Pour un rendez-vous pris par téléphone ou sur place. Sans acompte, et sans les délais imposés aux visiteurs.</p>
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="fieldset py-0"><span class="fieldset-legend">Prestation</span>
            <select v-model="draft.service" class="select select-sm w-full" name="service"><option v-for="s in data.settings.services" :key="s.id" :value="s.id">{{ s.label }} ({{ formatDuration(s.duration) }})</option></select>
          </label>
          <label class="fieldset py-0"><span class="fieldset-legend">Jour</span><input v-model="draft.date" type="date" class="input input-sm w-full" name="date" required></label>
        </div>
        <div>
          <span class="fieldset-legend">Heure</span>
          <div v-if="freeSlots.length" class="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto" data-add-slots>
            <button v-for="s in freeSlots" :key="s.at" type="button" class="btn btn-xs" :class="draft.start === s.at ? 'btn-primary' : 'btn-outline'" :aria-pressed="draft.start === s.at" @click="draft.start = s.at">{{ s.time }}</button>
          </div>
          <p v-else class="text-sm text-base-content/60">Aucun moment libre ce jour-là dans les horaires réglés.</p>
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="fieldset py-0"><span class="fieldset-legend">Nom</span><input v-model="draft.name" class="input input-sm w-full" name="name" required maxlength="120"></label>
          <label class="fieldset py-0"><span class="fieldset-legend">E-mail</span><input v-model="draft.email" type="email" class="input input-sm w-full" name="email" required></label>
          <label class="fieldset py-0"><span class="fieldset-legend">Téléphone</span><input v-model="draft.phone" type="tel" class="input input-sm w-full" name="phone"></label>
          <label class="fieldset py-0"><span class="fieldset-legend">Note</span><input v-model="draft.note" class="input input-sm w-full" name="note" maxlength="1000"></label>
        </div>
        <p v-if="addError" class="text-sm text-error" role="alert" data-add-error>{{ addError }}</p>
        <div class="modal-action">
          <button type="button" class="btn" @click="addDialog?.close()">Fermer</button>
          <button class="btn btn-primary" :disabled="adding" data-add-save>Enregistrer</button>
        </div>
      </form>
      <form method="dialog" class="modal-backdrop"><button aria-label="Fermer">Fermer</button></form>
    </dialog>
  </section>
</template>
