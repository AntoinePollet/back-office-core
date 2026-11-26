<script setup lang="ts">
import { Activity, Bug, Check, CircleCheck, RefreshCw, RotateCcw, Settings, Trash2, TriangleAlert } from '@lucide/vue'
import { type ErrorSource, type Incident, formatDowntime } from '../../../shared/monitoring'

/**
 * Surveillance (module `monitoring`) : les erreurs relevées sur le site, regroupées, et les vérifications faites
 * toutes les cinq minutes. Réservé à l'administrateur.
 */
definePageMeta({ layout: 'admin', middleware: ['cms-auth', 'cms-admin'] })

type SiteError = {
  id: string; source: ErrorSource; type: string; message: string; stack: string; path: string; method: string; status: number | null; browser: string; release: string
  count: number; firstAt: string; lastAt: string; resolvedAt: string | null
}
type Data = {
  errors: SiteError[]; open: number
  uptime: { day: string | null; week: string | null; checks: number; last: { at: string; ok: boolean; status: number | null; ms: number; detail: string } | null; averageMs: number | null }
  day: { at: string; ok: boolean; ms: number }[]
  incidents: Incident[]
  down: { since: number; detail: string; alerted: boolean } | null
  settings: { url: string; recipients: string[]; mail: boolean; sentry: boolean; heartbeat: boolean }
}

const load = () => cmsApi<Data>('/api/cms/monitoring')
const data = ref(await load().catch((e) => { throw createError({ statusCode: e?.statusCode ?? 500, message: cmsErrorMessage(e), fatal: true }) }))
const toast = useCmsToast()
const tab = ref<'open' | 'resolved'>('open')
const shown = computed(() => data.value.errors.filter(e => (tab.value === 'open' ? !e.resolvedAt : !!e.resolvedAt)))
const opened = ref<string | null>(null)
const when = (at: string | number) => new Date(at).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })
const slowest = computed(() => Math.max(1, ...data.value.day.map(c => c.ms)))

async function act(run: () => Promise<unknown>, done: string) {
  try { await run(); data.value = await load(); toast.success(done) }
  catch (e) { toast.error(cmsErrorMessage(e)) }
}
const resolve = (e: SiteError, resolved: boolean) => act(() => cmsApi(`/api/cms/monitoring/errors/${e.id}`, { method: 'PATCH', body: { resolved } }), resolved ? 'Erreur marquée comme corrigée' : 'Erreur rouverte')
function erase(e: SiteError) {
  if (!confirm(`Effacer cette erreur de la liste ?\n\n${e.type} : ${e.message}\n\nSi elle se reproduit, elle reviendra comme une erreur nouvelle.`)) return
  return act(() => cmsApi(`/api/cms/monitoring/errors/${e.id}`, { method: 'DELETE' }), 'Erreur effacée')
}
const checking = ref(false)
async function checkNow() {
  checking.value = true
  await act(() => cmsApi('/api/cms/monitoring/check', { method: 'POST' }), 'Vérification faite')
  checking.value = false
}
</script>

<template>
  <section class="max-w-6xl mx-auto space-y-6" data-monitoring>
    <div class="flex flex-wrap items-center gap-3">
      <div class="grow min-w-0">
        <h1 class="text-2xl font-bold">Surveillance</h1>
        <p class="text-sm text-base-content/60">Les erreurs relevées sur le site, et la vérification qu'il répond, faite toutes les cinq minutes.</p>
      </div>
      <button class="btn btn-sm" :disabled="checking" data-monitoring-check @click="checkNow"><RefreshCw :size="15" :class="{ 'animate-spin': checking }" />Vérifier maintenant</button>
      <NuxtLink to="/admin/modules/monitoring" class="btn btn-sm"><Settings :size="15" />Réglages</NuxtLink>
    </div>

    <div v-if="data.down" class="alert alert-error" role="alert" data-monitoring-down>
      <TriangleAlert :size="18" />
      <span>
        Le site ne répond plus correctement depuis le {{ when(data.down.since) }} : {{ data.down.detail }}
        <template v-if="!data.down.alerted"> Une seule vérification a échoué pour l'instant : l'alerte part à la deuxième.</template>
      </span>
    </div>
    <div v-if="!data.settings.recipients.length || !data.settings.mail" class="alert alert-warning alert-soft" role="alert" data-monitoring-noalert>
      <TriangleAlert :size="18" />
      <span>
        <template v-if="!data.settings.recipients.length">Aucun destinataire n'est réglé : </template><template v-else>Aucun envoi d'e-mails n'est réglé sur ce site (module Brevo ou Resend) : </template>
        personne ne sera prévenu par e-mail si le site tombe. <NuxtLink :to="data.settings.recipients.length ? '/admin/modules' : '/admin/modules/monitoring'" class="link">Le régler</NuxtLink>
      </span>
    </div>

    <!-- Le site répond-il ? -->
    <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] items-start">
      <div class="card bg-base-100 border border-base-300 p-4 sm:p-5" data-monitoring-uptime>
        <div class="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <div><div class="text-sm text-base-content/60">Dernières 24 heures</div><div class="text-3xl font-bold tabular-nums" data-uptime="day">{{ data.uptime.day ?? '—' }}</div></div>
          <div><div class="text-sm text-base-content/60">Sept derniers jours</div><div class="text-3xl font-bold tabular-nums" data-uptime="week">{{ data.uptime.week ?? '—' }}</div></div>
          <div v-if="data.uptime.averageMs !== null"><div class="text-sm text-base-content/60">Temps de réponse moyen</div><div class="text-3xl font-bold tabular-nums">{{ data.uptime.averageMs }} <span class="text-base font-normal">ms</span></div></div>
        </div>
        <div v-if="data.day.length" class="flex items-end gap-px h-16 mt-4" role="img" aria-label="Temps de réponse des dernières 24 heures" data-monitoring-day>
          <span v-for="c in data.day" :key="c.at" class="grow min-w-px rounded-sm" :class="c.ok ? 'bg-success/60' : 'bg-error'" :style="{ height: c.ok ? `${Math.max(8, Math.round(100 * c.ms / slowest))}%` : '100%' }" :title="`${when(c.at)} : ${c.ok ? `${c.ms} ms` : 'échec'}`" />
        </div>
        <p v-else class="text-sm text-base-content/60 mt-3" data-monitoring-nochecks>Aucune vérification pour l'instant : la première arrive dans les cinq minutes (elle demande la tâche planifiée du site).</p>
        <p class="text-xs text-base-content/50 mt-3 break-all">
          <template v-if="data.settings.url">Adresse surveillée : {{ data.settings.url }}.</template><template v-else>Aucune adresse à surveiller (« site.url » est vide) : seule la base est vérifiée.</template>
          <template v-if="data.uptime.last"> Dernière vérification : {{ when(data.uptime.last.at) }}.</template>
        </p>
      </div>
      <div class="card bg-base-100 border border-base-300 p-4 text-sm space-y-2">
        <h2 class="font-semibold">Ce qui est surveillé</h2>
        <p>Toutes les cinq minutes, le site demande sa propre page et interroge sa base. Deux échecs de suite : un e-mail part. Un autre au retour.</p>
        <ul class="space-y-1">
          <li class="flex gap-2"><component :is="data.settings.recipients.length && data.settings.mail ? CircleCheck : TriangleAlert" :size="16" class="shrink-0 mt-0.5" :class="data.settings.recipients.length && data.settings.mail ? 'text-success' : 'text-warning'" /><span>Alertes par e-mail : {{ data.settings.recipients.length ? data.settings.recipients.join(', ') : 'personne' }}</span></li>
          <li class="flex gap-2"><component :is="data.settings.heartbeat ? CircleCheck : TriangleAlert" :size="16" class="shrink-0 mt-0.5" :class="data.settings.heartbeat ? 'text-success' : 'text-base-content/40'" /><span>Service extérieur : {{ data.settings.heartbeat ? 'prévenu à chaque vérification réussie' : 'aucun. Si tout l\'hébergement tombe, le site ne peut pas le constater lui-même.' }}</span></li>
          <li class="flex gap-2"><component :is="data.settings.sentry ? CircleCheck : Activity" :size="16" class="shrink-0 mt-0.5" :class="data.settings.sentry ? 'text-success' : 'text-base-content/40'" /><span>Sentry : {{ data.settings.sentry ? 'les erreurs lui sont transmises' : 'non réglé' }}</span></li>
        </ul>
      </div>
    </div>

    <div v-if="data.incidents.length" class="card bg-base-100 border border-base-300" data-monitoring-incidents>
      <h2 class="font-semibold p-4 border-b border-base-300">Pannes des sept derniers jours</h2>
      <ul class="divide-y divide-base-300 text-sm">
        <li v-for="i in data.incidents" :key="i.from" class="px-4 py-3 flex flex-wrap gap-x-4 gap-y-1" data-incident>
          <span class="font-medium whitespace-nowrap">{{ when(i.from) }}</span>
          <span class="grow min-w-0 break-words text-base-content/70">{{ i.detail }}</span>
          <span class="whitespace-nowrap" :class="i.to ? 'text-base-content/60' : 'text-error font-medium'">{{ i.to ? `${formatDowntime(i.to - i.from)} environ` : 'en cours' }}</span>
        </li>
      </ul>
    </div>

    <!-- Erreurs -->
    <div>
      <div role="tablist" class="tabs tabs-box tabs-sm mb-3 w-fit">
        <a role="tab" class="tab gap-1.5" :class="{ 'tab-active': tab === 'open' }" data-errors-tab="open" @click="tab = 'open'">Erreurs à regarder<span class="badge badge-xs badge-ghost">{{ data.open }}</span></a>
        <a role="tab" class="tab gap-1.5" :class="{ 'tab-active': tab === 'resolved' }" data-errors-tab="resolved" @click="tab = 'resolved'">Corrigées<span class="badge badge-xs badge-ghost">{{ data.errors.length - data.open }}</span></a>
      </div>
      <div class="card bg-base-100 border border-base-300">
        <ul v-if="shown.length" class="divide-y divide-base-300">
          <li v-for="e in shown" :key="e.id" class="p-4" data-error :data-source="e.source">
            <div class="flex flex-wrap items-start gap-x-3 gap-y-2">
              <button type="button" class="grow min-w-0 text-left cursor-pointer" :aria-expanded="opened === e.id" @click="opened = opened === e.id ? null : e.id">
                <span class="block font-medium break-words"><span class="font-mono text-sm">{{ e.type }}</span> : {{ e.message }}</span>
                <span class="block text-sm text-base-content/60 break-all">
                  {{ e.source === 'server' ? 'Serveur' : 'Navigateur' }} · {{ e.method }} {{ e.path }}<template v-if="e.status"> · {{ e.status }}</template><template v-if="e.browser"> · {{ e.browser }}</template>
                </span>
                <span class="block text-xs text-base-content/50">Dernière fois : {{ when(e.lastAt) }} · première : {{ when(e.firstAt) }} · version {{ e.release }}</span>
              </button>
              <span class="badge badge-sm whitespace-nowrap" :class="e.count > 1 ? 'badge-warning badge-soft' : 'badge-ghost'" data-error-count>{{ e.count }} fois</span>
              <span class="flex gap-1">
                <button v-if="!e.resolvedAt" class="btn btn-ghost btn-xs" data-error-resolve @click="resolve(e, true)"><Check :size="14" />Corrigée</button>
                <button v-else class="btn btn-ghost btn-xs" @click="resolve(e, false)"><RotateCcw :size="14" />Rouvrir</button>
                <button class="btn btn-ghost btn-xs btn-square text-error" title="Effacer" aria-label="Effacer" @click="erase(e)"><Trash2 :size="14" /></button>
              </span>
            </div>
            <pre v-if="opened === e.id" class="mt-3 p-3 bg-base-200 rounded-field text-xs overflow-x-auto whitespace-pre-wrap break-all" data-error-stack>{{ e.stack || 'Pas de pile d\'appels.' }}</pre>
          </li>
        </ul>
        <p v-else class="p-10 text-center text-sm text-base-content/60 flex flex-col items-center gap-2" data-errors-empty>
          <component :is="tab === 'open' ? CircleCheck : Bug" :size="28" :class="tab === 'open' ? 'text-success' : 'text-base-content/30'" />
          {{ tab === 'open' ? 'Aucune erreur à regarder.' : 'Aucune erreur marquée comme corrigée.' }}
        </p>
      </div>
      <p class="text-xs text-base-content/50 mt-3">
        Une ligne par erreur distincte : ses répétitions font monter le compteur. Une erreur marquée « corrigée » se rouvre si elle se reproduit ;
        une erreur qui ne s'est pas reproduite depuis 90 jours est effacée. Ni adresse IP ni paramètres d'adresse ne sont gardés.
      </p>
    </div>
  </section>
</template>
