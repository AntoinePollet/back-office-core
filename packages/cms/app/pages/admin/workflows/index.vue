<script setup lang="ts">
import { Plus } from '@lucide/vue'

definePageMeta({ layout: 'admin', middleware: ['cms-auth', 'cms-admin'] })

type Step = { kind: 'email' | 'webhook'; status: 'success' | 'error' | 'skipped'; detail: string; ms: number }
type Run = { id: string; workflowId: string; workflowName: string; event: string; summary: string; status: Step['status']; test: boolean; steps: Step[]; startedAt: string; durationMs: number }
type Workflow = { id: string; name: string; enabled: boolean; trigger: { event: string; types: string[] }; actions: { kind: string }[]; lastRun: Run | null }
type Data = { workflows: Workflow[]; events: { name: string; label: string }[]; types: { key: string; label: string }[]; emailConfigured: boolean }

const toast = useCmsToast()
const route = useRoute()
const data = ref(await cmsApi<Data>('/api/cms/workflows'))
const runs = ref(await cmsApi<Run[]>('/api/cms/workflow-runs'))
const tab = ref<'workflows' | 'runs'>(route.query.tab === 'journal' ? 'runs' : 'workflows')
const open = ref<string | null>(null)

async function refresh() {
  [data.value, runs.value] = await Promise.all([cmsApi<Data>('/api/cms/workflows'), cmsApi<Run[]>('/api/cms/workflow-runs')])
}

const statusMeta = {
  success: { label: 'Réussi', cls: 'badge-success' },
  error: { label: 'Échec', cls: 'badge-error' },
  skipped: { label: 'Non exécuté', cls: 'badge-warning' },
}
const actionLabel = { email: 'E-mail', webhook: 'Appel d\'un service' } as Record<string, string>
const eventLabel = (name: string) => data.value.events.find(e => e.name === name)?.label ?? name
const typesLabel = (w: Workflow) => (w.trigger.types.length ? w.trigger.types.map(t => data.value.types.find(x => x.key === t)?.label ?? t).join(', ') : '')
const actionsLabel = (w: Workflow) => w.actions.map(a => actionLabel[a.kind] ?? a.kind).join(' puis ')
const formatDate = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })

async function toggle(w: Workflow) {
  try {
    await cmsApi(`/api/cms/workflows/${w.id}`, { method: 'PATCH', body: { enabled: !w.enabled } })
    toast.success(w.enabled ? `« ${w.name} » mis en pause` : `« ${w.name} » activé`)
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
  await refresh()
}

const templates = [
  { id: 'invite', title: 'Envoyer les invitations par e-mail', text: 'La personne invitée reçoit directement son lien de mot de passe.' },
  { id: 'review', title: 'Prévenir quand une publication est demandée', text: 'Un e-mail part quand un rédacteur signale que son brouillon est prêt.' },
  { id: 'publish', title: 'Prévenir quand un contenu est publié', text: 'Un e-mail part à chaque publication, avec le lien de la page.' },
]
</script>

<template>
  <section class="max-w-6xl mx-auto">
    <div class="flex flex-wrap items-end gap-3 mb-6">
      <div>
        <h1 class="text-2xl font-bold">Workflows</h1>
        <p class="text-sm text-base-content/60">Des actions déclenchées automatiquement quand quelque chose se passe dans le back-office.</p>
      </div>
      <NuxtLink to="/admin/workflows/new" class="btn btn-primary ml-auto"><Plus :size="18" />Créer un workflow</NuxtLink>
    </div>

    <div v-if="!data.emailConfigured" class="alert alert-warning alert-soft text-sm mb-4">
      L'envoi d'e-mails n'est pas configuré sur ce site : les actions « E-mail » sont inscrites au journal mais rien n'est envoyé.
    </div>

    <div role="tablist" class="tabs tabs-border mb-3">
      <a role="tab" class="tab" :class="{ 'tab-active': tab === 'workflows' }" @click="tab = 'workflows'">Workflows <span class="ml-1.5 opacity-60">{{ data.workflows.length }}</span></a>
      <a role="tab" class="tab" :class="{ 'tab-active': tab === 'runs' }" @click="tab = 'runs'; refresh()">Journal <span class="ml-1.5 opacity-60">{{ runs.length }}</span></a>
    </div>

    <!-- Workflows -->
    <template v-if="tab === 'workflows'">
      <div v-if="data.workflows.length" class="card bg-base-100 border border-base-300 overflow-x-auto">
        <table class="table">
          <thead><tr><th>Nom</th><th>Quand</th><th>Actions</th><th>Dernier déclenchement</th><th class="text-right">Actif</th></tr></thead>
          <tbody>
            <tr v-for="w in data.workflows" :key="w.id" class="hover:bg-base-200 cursor-pointer" @click="navigateTo(`/admin/workflows/${w.id}`)">
              <td class="font-medium">{{ w.name }}</td>
              <td class="text-sm">{{ eventLabel(w.trigger.event) }}<div v-if="typesLabel(w)" class="text-xs text-base-content/50">Seulement : {{ typesLabel(w) }}</div></td>
              <td class="text-sm">{{ actionsLabel(w) }}</td>
              <td class="text-sm">
                <template v-if="w.lastRun">
                  <span class="badge badge-sm badge-soft" :class="statusMeta[w.lastRun.status].cls">{{ statusMeta[w.lastRun.status].label }}</span>
                  <span class="text-base-content/60 ml-2 whitespace-nowrap">{{ formatDate(w.lastRun.startedAt) }}</span>
                </template>
                <span v-else class="text-base-content/50">Jamais</span>
              </td>
              <td class="text-right" @click.stop><input type="checkbox" class="toggle toggle-sm" :checked="w.enabled" :title="w.enabled ? 'Mettre en pause' : 'Activer'" @change="toggle(w)"></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="card bg-base-100 border border-base-300 p-6">
        <p class="text-sm text-base-content/60 mb-4">Aucun workflow pour l'instant. Partez d'un modèle ou créez le vôtre.</p>
        <div class="grid sm:grid-cols-3 gap-3">
          <NuxtLink v-for="t in templates" :key="t.id" :to="`/admin/workflows/new?modele=${t.id}`" class="border border-base-300 rounded-box p-4 hover:border-primary">
            <div class="font-medium">{{ t.title }}</div>
            <div class="text-sm text-base-content/60">{{ t.text }}</div>
          </NuxtLink>
        </div>
      </div>
    </template>

    <!-- Journal -->
    <template v-else>
      <div v-if="runs.length" class="card bg-base-100 border border-base-300 overflow-x-auto">
        <table class="table">
          <thead><tr><th>Date</th><th>Ce qui s'est passé</th><th>Workflow</th><th>Résultat</th><th class="text-right">Durée</th></tr></thead>
          <tbody>
            <template v-for="r in runs" :key="r.id">
              <tr class="hover:bg-base-200 cursor-pointer" @click="open = open === r.id ? null : r.id">
                <td class="text-sm whitespace-nowrap">{{ formatDate(r.startedAt) }}</td>
                <td class="text-sm">{{ r.summary }} <span v-if="r.test" class="badge badge-xs badge-ghost">test</span></td>
                <td class="text-sm">{{ r.workflowName }}</td>
                <td><span class="badge badge-sm badge-soft" :class="statusMeta[r.status].cls">{{ statusMeta[r.status].label }}</span></td>
                <td class="text-right text-sm text-base-content/60 whitespace-nowrap">{{ r.durationMs }} ms</td>
              </tr>
              <tr v-if="open === r.id">
                <td colspan="5" class="bg-base-200/60">
                  <ol class="space-y-1.5 text-sm py-1">
                    <li v-for="(s, i) in r.steps" :key="i" class="flex items-start gap-3">
                      <span class="text-base-content/40 w-4 text-right">{{ i + 1 }}</span>
                      <span class="w-36 shrink-0">{{ actionLabel[s.kind] }}</span>
                      <span class="badge badge-xs badge-soft mt-1 shrink-0" :class="statusMeta[s.status].cls">{{ statusMeta[s.status].label }}</span>
                      <span class="grow">{{ s.detail }}</span>
                      <span class="text-base-content/50 whitespace-nowrap">{{ s.ms }} ms</span>
                    </li>
                  </ol>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      <p v-else class="card bg-base-100 border border-base-300 p-6 text-sm text-base-content/60">Aucun déclenchement pour l'instant.</p>
      <p class="text-xs text-base-content/50 mt-2">Le journal conserve les 30 derniers jours et affiche les 100 déclenchements les plus récents.</p>
    </template>
  </section>
</template>
