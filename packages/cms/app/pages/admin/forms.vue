<script setup lang="ts">
import { Download, Mail, Trash2 } from '@lucide/vue'
import { CHANNELS, type Channel, type OriginPeriod, PAID_CHANNELS, type StoredOrigin, channelOfRow, filterByOrigin } from '../../../shared/attribution'
import { type FormDefinition, formDefinitions, formatFormValue } from '../../../shared/modules'

definePageMeta({ layout: 'admin', middleware: 'cms-auth' })

type Submission = { id: string; form: string; values: Record<string, unknown>; origin: StoredOrigin | null; read: boolean; createdAt: string }

const schema = await useCmsSchema()
const route = useRoute()
const toast = useCmsToast()
const forms = formDefinitions(schema.value) as Record<string, FormDefinition>
const formIds = Object.keys(forms)

const data = ref(await cmsApi<{ submissions: Submission[]; retentionDays: number }>('/api/cms/forms').catch((e) => { throw createError({ statusCode: e?.statusCode ?? 500, message: cmsErrorMessage(e), fatal: true }) }))
const tab = ref(formIds[0]!)
const ofForm = computed(() => data.value.submissions.filter(s => s.form === tab.value))
// Provenance : période et canal choisis dans le tableau « D'où viennent les messages », appliqués à la liste.
const days = ref<OriginPeriod>(null)
const channel = ref<Channel | null>(null)
const list = computed(() => filterByOrigin(ofForm.value, days.value, channel.value))
const paidBadge = (s: Submission) => { const c = channelOfRow(s.origin); return PAID_CHANNELS.includes(c) ? CHANNELS[c] : null }
const unreadIn = (id: string) => data.value.submissions.filter(s => s.form === id && !s.read).length
const selected = ref<Submission | null>(null)

const fieldsOf = (s: Submission) => Object.entries(forms[s.form]?.fields ?? {})
/** Les deux premiers champs remplis, pour reconnaître un message dans la liste. */
const preview = (s: Submission) => fieldsOf(s).map(([key, field]) => formatFormValue(field, s.values[key])).filter(Boolean).slice(0, 2)
const replyAddress = (s: Submission) => {
  const found = fieldsOf(s).find(([key, field]) => field.format === 'email' && s.values[key])
  return found ? String(s.values[found[0]]) : null
}

async function open(s: Submission) {
  selected.value = s
  if (s.read) return
  await setRead(s, true)
}
async function setRead(s: Submission, read: boolean) {
  try {
    await cmsApi(`/api/cms/forms/submissions/${s.id}`, { method: 'PATCH', body: { read } })
    s.read = read
    await refreshCmsUnreadMessages()
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
}
async function remove(s: Submission) {
  if (!confirm('Supprimer définitivement ce message ?')) return
  try {
    await cmsApi(`/api/cms/forms/submissions/${s.id}`, { method: 'DELETE' })
    data.value.submissions = data.value.submissions.filter(x => x.id !== s.id)
    await refreshCmsUnreadMessages()
    selected.value = null
    toast.success('Message supprimé')
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
}

/** Fichier lisible par un tableur : une ligne par message de l'onglet affiché. */
function exportCsv() {
  const fields = Object.entries(forms[tab.value]!.fields)
  // Un texte qui commence par = + - ou @ serait pris pour une formule par le tableur : il est neutralisé par une apostrophe.
  const cell = (text: string) => `"${(/^[=+\-@\t\r]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`
  const rows = [
    ['Date', ...fields.map(([, f]) => f.label), 'Provenance', 'Campagne', 'Mot-clé', 'Source'],
    ...list.value.map(s => [
      new Date(s.createdAt).toLocaleString('fr-FR'), ...fields.map(([key, f]) => formatFormValue(f, s.values[key])),
      CHANNELS[channelOfRow(s.origin)], s.origin?.campaign ?? '', s.origin?.term ?? '', [s.origin?.source ?? s.origin?.referrer, s.origin?.medium].filter(Boolean).join(' / '),
    ]),
  ]
  const blob = new Blob(['﻿' + rows.map(r => r.map(cell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `${tab.value}-messages.csv`
  link.click()
  URL.revokeObjectURL(link.href)
}

// Lien reçu par e-mail (« voir le message ») : ouvre directement le message.
onMounted(() => {
  const wanted = data.value.submissions.find(s => s.id === route.query.message)
  if (wanted) { tab.value = wanted.form; open(wanted) }
})
</script>

<template>
  <section class="max-w-6xl mx-auto">
    <div class="flex flex-wrap items-center gap-3 mb-6">
      <div>
        <h1 class="text-2xl font-bold">Messages reçus</h1>
        <p class="text-sm text-base-content/60">Ce que les visiteurs envoient par les formulaires du site. Un message est conservé {{ data.retentionDays }} jours.</p>
      </div>
      <button class="btn btn-sm ml-auto" :disabled="!list.length" @click="exportCsv"><Download :size="16" />Exporter</button>
    </div>

    <div v-if="formIds.length > 1" role="tablist" class="tabs tabs-border mb-3">
      <a v-for="id in formIds" :key="id" role="tab" class="tab" :class="{ 'tab-active': tab === id }" @click="tab = id; selected = null; channel = null">
        {{ forms[id]!.label }}<span v-if="unreadIn(id)" class="badge badge-sm badge-info ml-2">{{ unreadIn(id) }}</span>
      </a>
    </div>

    <CmsOriginStats v-if="ofForm.length" v-model:days="days" v-model:channel="channel" :rows="ofForm" :noun="['message', 'messages']" class="mb-4" />

    <p v-if="ofForm.length && (days !== null || channel)" class="text-xs text-base-content/60 mb-2" data-origin-filtered>
      {{ list.length }} message{{ list.length > 1 ? 's' : '' }} sur {{ ofForm.length }} : seulement la période et le canal choisis ci-dessus (l'export aussi).
    </p>

    <div class="grid lg:grid-cols-[1fr_24rem] gap-6 items-start">
      <div class="card bg-base-100 border border-base-300 overflow-hidden">
        <div v-if="!list.length" class="p-10 text-center text-sm text-base-content/50">{{ ofForm.length ? 'Aucun message pour cette période ou ce canal.' : 'Aucun message pour l\'instant.' }}</div>
        <ul v-else class="divide-y divide-base-300">
          <li v-for="s in list" :key="s.id">
            <button type="button" class="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-base-200 cursor-pointer" :class="{ 'bg-base-200': selected?.id === s.id }" @click="open(s)">
              <span class="w-2 h-2 rounded-full shrink-0" :class="s.read ? 'bg-transparent' : 'bg-info'" :title="s.read ? '' : 'Non lu'" />
              <span class="min-w-0 grow">
                <span class="block truncate" :class="{ 'font-semibold': !s.read }">{{ preview(s)[0] ?? 'Message' }}</span>
                <span class="block truncate text-sm text-base-content/60">{{ preview(s)[1] }}</span>
              </span>
              <span v-if="paidBadge(s)" class="badge badge-sm badge-accent badge-soft shrink-0" data-origin-badge>{{ paidBadge(s) }}</span>
              <span class="shrink-0 text-xs text-base-content/50">{{ cmsFormatWhen(s.createdAt) }}</span>
            </button>
          </li>
        </ul>
      </div>

      <aside class="card bg-base-100 border border-base-300 p-4 text-sm lg:sticky lg:top-20">
        <div v-if="!selected" class="text-base-content/50 py-10 text-center">Sélectionnez un message pour le lire.</div>
        <div v-else class="space-y-3">
          <div class="text-xs text-base-content/50">{{ forms[selected.form]?.label }} · {{ new Date(selected.createdAt).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' }) }}</div>
          <dl class="space-y-3">
            <div v-for="[key, field] in fieldsOf(selected)" :key="key">
              <dt class="text-base-content/60">{{ field.label }}</dt>
              <dd class="whitespace-pre-wrap break-words">{{ formatFormValue(field, selected.values[key]) || '—' }}</dd>
            </div>
          </dl>
          <CmsOriginDetail :origin="selected.origin" />
          <div class="flex flex-wrap gap-2 pt-1">
            <a v-if="replyAddress(selected)" class="btn btn-sm btn-primary grow" :href="`mailto:${replyAddress(selected)}`"><Mail :size="16" />Répondre</a>
            <button class="btn btn-sm" @click="setRead(selected, false); selected = null">Marquer non lu</button>
            <button class="btn btn-sm btn-error btn-soft" title="Supprimer" aria-label="Supprimer" @click="remove(selected)"><Trash2 :size="16" /></button>
          </div>
        </div>
      </aside>
    </div>
  </section>
</template>
