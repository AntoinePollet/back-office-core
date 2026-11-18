<script setup lang="ts">
import { ArrowLeft, ChevronDown, ChevronUp, Mail, Trash2, Webhook } from '@lucide/vue'

definePageMeta({ layout: 'admin', middleware: ['cms-auth', 'cms-admin'] })

type Action = { kind: 'email'; to: string; subject: string; body: string } | { kind: 'webhook'; url: string }
type Variable = { key: string; label: string }
type Data = {
  workflows: { id: string; name: string; enabled: boolean; trigger: { event: string; types: string[] }; actions: Action[] }[]
  events: { name: string; label: string; scope: 'entry' | 'invite' }[]
  variables: { common: Variable[]; entry: Variable[]; invite: Variable[] }
  types: { key: string; label: string }[]
  emailConfigured: boolean
}

const route = useRoute()
const toast = useCmsToast()
const user = useCmsUser()
const data = await cmsApi<Data>('/api/cms/workflows')
const isNew = route.params.id === 'new'

const presets: Record<string, { name: string; trigger: { event: string; types: string[] }; actions: Action[] }> = {
  invite: {
    name: 'Envoyer les invitations par e-mail',
    trigger: { event: 'user.invited', types: [] },
    actions: [{ kind: 'email', to: '{{ invite.email }}', subject: 'Votre accès au back-office de {{ site.name }}', body: 'Bonjour {{ invite.name }},\n\nVoici le lien pour choisir votre mot de passe :\n{{ invite.link }}\n\nIl fonctionne une seule fois et reste valable 7 jours.' }],
  },
  publish: {
    name: 'Prévenir quand un contenu est publié',
    trigger: { event: 'entry.published', types: [] },
    actions: [{ kind: 'email', to: user.value?.email ?? '', subject: '{{ event.label }}', body: '{{ event.label }} par {{ user.email }}.\n\nVoir la page : {{ entry.url }}\nModifier : {{ entry.adminUrl }}' }],
  },
}

const existing = isNew ? null : data.workflows.find(w => w.id === route.params.id)
if (!isNew && !existing) throw createError({ statusCode: 404, message: 'Workflow introuvable.', fatal: true })
const start = existing ?? presets[route.query.modele as string] ?? { name: '', trigger: { event: 'entry.published', types: [] }, actions: [] }

const form = reactive({
  id: existing?.id ?? null as string | null,
  name: start.name,
  enabled: existing?.enabled ?? true,
  trigger: { event: start.trigger.event, types: [...start.trigger.types] },
  actions: JSON.parse(JSON.stringify(start.actions)) as Action[],
})
const saving = ref(false)
const dirty = ref(isNew && !!route.query.modele)
watch(form, () => { dirty.value = true }, { deep: true })

const scope = computed(() => data.events.find(e => e.name === form.trigger.event)?.scope ?? 'entry')
const variables = computed(() => [...data.variables[scope.value], ...data.variables.common])
watch(scope, (s) => { if (s !== 'entry') form.trigger.types = [] })
const toggleType = (key: string) => { form.trigger.types = form.trigger.types.includes(key) ? form.trigger.types.filter(t => t !== key) : [...form.trigger.types, key] }

function addAction(kind: Action['kind']) {
  form.actions.push(kind === 'email' ? { kind, to: '', subject: '', body: '' } : { kind, url: '' })
}
function moveAction(i: number, delta: number) {
  form.actions.splice(i + delta, 0, form.actions.splice(i, 1)[0]!)
}

// Insertion d'une variable dans le dernier champ où se trouvait le curseur.
const focused = ref<{ index: number; field: string; el: HTMLInputElement | HTMLTextAreaElement } | null>(null)
const remember = (index: number, field: string, e: FocusEvent) => { focused.value = { index, field, el: e.target as HTMLInputElement } }
function insert(variable: string) {
  const target = focused.value
  const text = `{{ ${variable} }}`
  if (!target || !form.actions[target.index]) { navigator.clipboard.writeText(text).then(() => toast.success(`${text} copié`)); return }
  const action = form.actions[target.index] as Record<string, string>
  const at = target.el.selectionStart ?? action[target.field]!.length
  action[target.field] = action[target.field]!.slice(0, at) + text + action[target.field]!.slice(target.el.selectionEnd ?? at)
  nextTick(() => { target.el.focus(); target.el.setSelectionRange(at + text.length, at + text.length) })
}

async function save() {
  saving.value = true
  try {
    const body = { name: form.name, enabled: form.enabled, trigger: form.trigger, actions: form.actions }
    const saved = await cmsApi<{ id: string }>(form.id ? `/api/cms/workflows/${form.id}` : '/api/cms/workflows', { method: form.id ? 'PUT' : 'POST', body })
    const created = !form.id
    form.id = saved.id
    nextTick(() => { dirty.value = false })
    toast.success('Workflow enregistré')
    if (created) await navigateTo(`/admin/workflows/${saved.id}`, { replace: true })
    return true
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
    return false
  }
  finally {
    saving.value = false
  }
}

const testResult = ref<{ status: string; steps: { kind: string; status: 'success' | 'error' | 'skipped'; detail: string }[] } | null>(null)
async function test() {
  if (dirty.value && !(await save())) return
  if (form.actions.some(a => a.kind === 'email') && data.emailConfigured && !confirm('Le test envoie réellement les e-mails et appelle réellement les services. Continuer ?')) return
  try {
    testResult.value = await cmsApi(`/api/cms/workflows/${form.id}/test`, { method: 'POST' })
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
}

async function remove() {
  if (!confirm(`Supprimer le workflow « ${form.name} » ? Son historique reste dans le journal.`)) return
  await cmsApi(`/api/cms/workflows/${form.id}`, { method: 'DELETE' })
  dirty.value = false
  toast.success('Workflow supprimé')
  await navigateTo('/admin/workflows')
}

onBeforeRouteLeave(() => !dirty.value || confirm('Des modifications ne sont pas enregistrées. Quitter quand même ?'))
const statusMeta = { success: { label: 'Réussi', cls: 'badge-success' }, error: { label: 'Échec', cls: 'badge-error' }, skipped: { label: 'Non exécuté', cls: 'badge-warning' } }
</script>

<template>
  <section class="max-w-6xl mx-auto">
    <div class="sticky top-14 z-10 -mx-4 lg:-mx-8 px-4 lg:px-8 py-3 bg-base-200/90 backdrop-blur flex flex-wrap items-center gap-3 mb-4">
      <NuxtLink to="/admin/workflows" class="btn btn-ghost btn-sm btn-square" title="Retour à la liste" aria-label="Retour à la liste"><ArrowLeft :size="18" /></NuxtLink>
      <div class="min-w-0">
        <div class="text-xs text-base-content/50">Workflows</div>
        <h1 class="text-lg font-bold truncate">{{ form.name || 'Nouveau workflow' }}</h1>
      </div>
      <div class="ml-auto flex items-center gap-2">
        <label class="flex items-center gap-2 text-sm cursor-pointer mr-2"><input v-model="form.enabled" type="checkbox" class="toggle toggle-sm">{{ form.enabled ? 'Actif' : 'En pause' }}</label>
        <button class="btn btn-sm" :disabled="saving || !form.actions.length" @click="test">Tester</button>
        <button class="btn btn-sm btn-primary" :disabled="saving || !dirty" @click="save">Enregistrer</button>
      </div>
    </div>

    <div class="grid lg:grid-cols-[1fr_18rem] gap-6 items-start">
      <div class="space-y-4 min-w-0">
        <div class="card bg-base-100 border border-base-300 p-5 space-y-4">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Nom</legend>
            <input v-model="form.name" class="input w-full" placeholder="Ex. : Prévenir l'équipe à chaque publication">
          </fieldset>
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Quand</legend>
            <select v-model="form.trigger.event" class="select w-full">
              <option v-for="e in data.events" :key="e.name" :value="e.name">{{ e.label }}</option>
            </select>
          </fieldset>
          <fieldset v-if="scope === 'entry'" class="fieldset">
            <legend class="fieldset-legend">Pour quels contenus</legend>
            <div class="flex flex-wrap gap-x-5 gap-y-2">
              <label v-for="t in data.types" :key="t.key" class="flex items-center gap-2 cursor-pointer text-sm">
                <input type="checkbox" class="checkbox checkbox-sm" :checked="form.trigger.types.includes(t.key)" @change="toggleType(t.key)">{{ t.label }}
              </label>
            </div>
            <p class="label">{{ form.trigger.types.length ? '' : 'Aucune case cochée : le workflow se déclenche pour tous les contenus.' }}</p>
          </fieldset>
        </div>

        <div v-for="(action, i) in form.actions" :key="i" class="card bg-base-100 border border-base-300 p-5 space-y-3">
          <div class="flex items-center gap-2">
            <span class="badge badge-neutral badge-sm">{{ i + 1 }}</span>
            <span class="font-semibold">{{ action.kind === 'email' ? 'Envoyer un e-mail' : 'Appeler un service externe' }}</span>
            <div class="ml-auto flex gap-1">
              <button class="btn btn-ghost btn-xs" :disabled="i === 0" title="Monter" aria-label="Monter" @click="moveAction(i, -1)"><ChevronUp :size="14" /></button>
              <button class="btn btn-ghost btn-xs" :disabled="i === form.actions.length - 1" title="Descendre" aria-label="Descendre" @click="moveAction(i, 1)"><ChevronDown :size="14" /></button>
              <button class="btn btn-ghost btn-xs text-error" title="Supprimer l'action" aria-label="Supprimer l'action" @click="form.actions.splice(i, 1)"><Trash2 :size="14" /></button>
            </div>
          </div>

          <template v-if="action.kind === 'email'">
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Destinataires</legend>
              <input v-model="action.to" class="input w-full" placeholder="adresse@exemple.fr, autre@exemple.fr" @focus="remember(i, 'to', $event)">
              <p class="label">Plusieurs adresses séparées par des virgules. Une variable est possible.</p>
            </fieldset>
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Objet</legend>
              <input v-model="action.subject" class="input w-full" @focus="remember(i, 'subject', $event)">
            </fieldset>
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Message</legend>
              <textarea v-model="action.body" class="textarea w-full" rows="6" @focus="remember(i, 'body', $event)" />
            </fieldset>
          </template>
          <fieldset v-else class="fieldset">
            <legend class="fieldset-legend">Adresse à appeler</legend>
            <input v-model="action.url" class="input w-full" placeholder="https://…">
            <p class="label">Le back-office y envoie les informations de l'événement (requête POST, format JSON).</p>
          </fieldset>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <span class="text-sm text-base-content/60">{{ form.actions.length ? 'Puis :' : 'Ajouter une action :' }}</span>
          <button class="btn btn-sm" @click="addAction('email')"><Mail :size="16" />Envoyer un e-mail</button>
          <button class="btn btn-sm" @click="addAction('webhook')"><Webhook :size="16" />Appeler un service externe</button>
        </div>
        <p v-if="form.actions.length > 1" class="text-xs text-base-content/50">Les actions s'exécutent dans l'ordre. Si l'une échoue, les suivantes sont quand même exécutées.</p>
      </div>

      <aside class="space-y-4 lg:sticky lg:top-32">
        <div class="card bg-base-100 border border-base-300 p-4 text-sm space-y-2">
          <div class="font-semibold">Variables</div>
          <p class="text-xs text-base-content/60">Cliquez dans un champ d'e-mail puis sur une variable pour l'insérer. Elle sera remplacée par sa valeur au déclenchement.</p>
          <button v-for="v in variables" :key="v.key" type="button" class="block w-full text-left rounded px-1.5 py-1 hover:bg-base-200 cursor-pointer" @mousedown.prevent="insert(v.key)">
            <code class="text-xs">{{ '{' + '{ ' + v.key + ' }' + '}' }}</code>
            <div class="text-xs text-base-content/60">{{ v.label }}</div>
          </button>
        </div>
        <button v-if="form.id" class="btn btn-sm btn-ghost btn-block text-error" @click="remove">Supprimer le workflow</button>
      </aside>
    </div>

    <div v-if="testResult" class="modal modal-open">
      <div class="modal-box space-y-3">
        <h3 class="font-bold text-lg">Résultat du test</h3>
        <p class="text-sm text-base-content/60">Exécuté avec des données d'exemple. Le détail est aussi dans le journal.</p>
        <ol class="space-y-2 text-sm">
          <li v-for="(s, i) in testResult.steps" :key="i" class="flex items-start gap-2">
            <span class="badge badge-xs badge-soft mt-1 shrink-0" :class="statusMeta[s.status].cls">{{ statusMeta[s.status].label }}</span>
            <span>{{ s.detail }}</span>
          </li>
        </ol>
        <div class="modal-action"><button class="btn" @click="testResult = null">Fermer</button></div>
      </div>
      <div class="modal-backdrop" @click="testResult = null" />
    </div>
  </section>
</template>
