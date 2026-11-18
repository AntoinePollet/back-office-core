<script setup lang="ts">
import { ArrowLeft, KeyRound } from '@lucide/vue'
import type { CmsModuleState } from '../../../composables/useCms'

type Setting = CmsModuleState['settings'][number]

definePageMeta({ layout: 'admin', middleware: ['cms-auth', 'cms-admin'] })

const route = useRoute()
const toast = useCmsToast()
const url = `/api/cms/modules/${route.params.id}`
const state = ref(await cmsApi<CmsModuleState>(url))

// Réglages non secrets : valeur en cours. Clés d'API : seulement ce qui vient d'être saisi (on ne connaît pas l'ancienne).
const values = reactive<Record<string, string>>({})
const secrets = reactive<Record<string, string>>({})
const replacing = reactive<Record<string, boolean>>({})
function reset() {
  for (const s of state.value.settings) {
    if (s.type === 'text') values[s.key] = s.value ?? ''
    else { secrets[s.key] = ''; replacing[s.key] = false }
  }
}
reset()
const dirty = computed(() => state.value.settings.some(s => (s.type === 'text' ? values[s.key] !== (s.value ?? '') : !!secrets[s.key]?.trim())))
const saving = ref(false)
const testResult = ref<{ ok: boolean; message: string } | null>(null)

async function put(body: Record<string, unknown>, done: string) {
  saving.value = true
  try {
    state.value = await cmsApi<CmsModuleState>(url, { method: 'PUT', body })
    reset()
    testResult.value = null
    // Un module qui change les pages du site (balise, clé publique) vide le cache : on prévient si cela a échoué.
    toast.success(cmsSiteUpdated(state.value) ? done : `${done} ; le site peut mettre jusqu'à une heure à en tenir compte`)
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
const save = () => put({
  values: { ...values },
  // Une clé laissée vide n'est pas envoyée : celle qui est enregistrée est conservée.
  secrets: Object.fromEntries(Object.entries(secrets).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()])),
}, 'Réglages enregistrés')

async function removeSecret(s: Setting) {
  if (!confirm(`Retirer « ${s.label} » ? ${s.env ? 'Le réglage de l\'hébergement, s\'il existe, sera utilisé à la place.' : 'Le module ne fonctionnera plus tant qu\'une nouvelle clé n\'est pas saisie.'}`)) return
  await put({ secrets: { [s.key]: null } }, 'Clé retirée')
}

const testing = ref(false)
async function test() {
  if (dirty.value && !(await save())) return
  testing.value = true
  try {
    testResult.value = await cmsApi<{ ok: boolean; message: string }>(`${url}/test`, { method: 'POST' })
  }
  catch (e) {
    testResult.value = { ok: false, message: cmsErrorMessage(e) }
  }
  finally {
    testing.value = false
  }
}

onBeforeRouteLeave(() => !dirty.value || confirm('Des modifications ne sont pas enregistrées. Quitter quand même ?'))
</script>

<template>
  <section class="max-w-3xl mx-auto">
    <div class="flex flex-wrap items-center gap-3 mb-5">
      <NuxtLink to="/admin/modules" class="btn btn-ghost btn-sm btn-square" title="Retour aux modules" aria-label="Retour aux modules"><ArrowLeft :size="18" /></NuxtLink>
      <CmsModuleLogo :logo="state.logo" :size="40" />
      <div class="min-w-0">
        <div class="text-xs text-base-content/50">Modules</div>
        <h1 class="text-lg font-bold truncate">{{ state.label }}</h1>
      </div>
      <div v-if="state.settings.length" class="ml-auto flex items-center gap-2">
        <button v-if="state.canTest" class="btn btn-sm" :disabled="saving || testing || (!state.configured && !dirty)" @click="test">{{ testing ? 'Vérification…' : 'Vérifier la connexion' }}</button>
        <button class="btn btn-sm btn-primary" :disabled="saving || !dirty" @click="save">Enregistrer</button>
      </div>
    </div>

    <p class="text-sm text-base-content/70 mb-4">{{ state.description }}</p>

    <div v-if="state.settings.length && !state.configured" class="alert alert-warning alert-soft text-sm mb-4">
      À régler pour que le module fonctionne : {{ state.missing.join(', ') }}.
    </div>
    <div v-if="testResult" class="alert alert-soft text-sm mb-4" :class="testResult.ok ? 'alert-success' : 'alert-error'" role="status">{{ testResult.message }}</div>

    <div v-if="state.settings.length" class="card bg-base-100 border border-base-300 p-5 space-y-4">
      <fieldset v-for="s in state.settings" :key="s.key" class="fieldset">
        <legend class="fieldset-legend">{{ s.label }}<span v-if="s.required" class="text-error">*</span></legend>

        <template v-if="s.type === 'secret'">
          <div v-if="s.saved && !replacing[s.key]" class="flex flex-wrap items-center gap-2">
            <span class="inline-flex items-center gap-2 text-sm" :class="s.unreadable ? 'text-error' : ''">
              <KeyRound :size="16" class="shrink-0" />
              <template v-if="s.unreadable">Clé illisible : saisissez-la à nouveau.</template>
              <template v-else>Clé enregistrée <code v-if="s.hint && s.hint !== '…'" class="text-xs">{{ s.hint }}</code></template>
            </span>
            <button class="btn btn-xs ml-auto" @click="replacing[s.key] = true">Remplacer</button>
            <button class="btn btn-xs btn-ghost text-error" :disabled="saving" @click="removeSecret(s)">Retirer</button>
          </div>
          <template v-else>
            <input v-model="secrets[s.key]" type="password" class="input w-full font-mono" autocomplete="off" spellcheck="false" :placeholder="s.saved ? 'Nouvelle clé' : 'Collez la clé ici'" :aria-label="s.label">
            <p v-if="s.fromEnv" class="label">Rien n'est saisi ici : la clé réglée dans l'hébergement ({{ s.env?.name }}) est utilisée.</p>
          </template>
        </template>

        <template v-else>
          <input v-model="values[s.key]" class="input w-full" :placeholder="s.placeholder" :aria-label="s.label">
          <p v-if="s.fromEnv && !values[s.key]" class="label">Rien n'est saisi ici : la valeur réglée dans l'hébergement ({{ s.env?.name }}) est utilisée.</p>
        </template>

        <p v-if="s.help" class="label">{{ s.help }}</p>
      </fieldset>
      <p class="text-xs text-base-content/50">Une clé enregistrée ne peut plus être relue, ni ici ni ailleurs : on peut seulement la remplacer ou la retirer.</p>
    </div>
    <div v-else class="card bg-base-100 border border-base-300 p-5 text-sm text-base-content/60">Ce module n'a pas de réglage : il fonctionne dès qu'il est activé.</div>

    <NuxtLink v-if="state.adminPage" :to="state.adminPage.to" class="btn btn-sm mt-4">{{ state.adminPage.label }}</NuxtLink>
  </section>
</template>
