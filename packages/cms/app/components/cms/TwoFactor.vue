<script setup lang="ts">
import { Check, Copy, Download, ShieldCheck, ShieldOff } from '@lucide/vue'
import { qrSvg } from '../../../shared/qr'
import { backupCodesText, formatTotpSecret, normalizeTotpCode, parseOtpauth } from '../../../shared/two-factor'

/**
 * Double authentification du compte connecté : activation (code QR, premier code, codes de secours),
 * nouveaux codes de secours, désactivation. Utilisé dans « Mon compte » et sur l'écran d'activation obligatoire.
 */
defineProps<{ /** Le site l'exige : pas de retour en arrière, pas de désactivation proposée. */ forced?: boolean }>()
const emit = defineEmits<{ /** Activation terminée, codes de secours rangés. */ done: [] }>()

const user = useCmsUser()
const enabled = computed(() => !!user.value?.twoFactor?.enabled)

/** Où en est la personne. `password` : mot de passe demandé avant une action sensible (`intent`). */
const view = ref<'idle' | 'password' | 'scan' | 'codes'>('idle')
const intent = ref<'enable' | 'codes' | 'disable'>('enable')
const password = ref('')
const code = ref('')
const error = ref('')
const loading = ref(false)

/** Adresse `otpauth://` de la clé en cours d'activation : dessinée en code QR ici même, jamais envoyée ailleurs. */
const totpUri = ref('')
const qr = computed(() => totpUri.value ? qrSvg(totpUri.value) : null)
const secret = computed(() => parseOtpauth(totpUri.value)?.secret ?? '')
/** Codes de secours à montrer une seule fois. */
const backupCodes = ref<string[]>([])
/** Vrai quand les codes affichés viennent d'une activation (et non d'un simple renouvellement). */
const justEnabled = ref(false)
const copied = ref('')

function ask(what: typeof intent.value) {
  intent.value = what
  password.value = ''
  error.value = ''
  view.value = 'password'
}
function cancel() {
  view.value = 'idle'
  error.value = ''
  password.value = ''
  code.value = ''
  totpUri.value = ''
}

const refreshUser = async () => { user.value = await cmsApi<NonNullable<typeof user.value>>('/api/cms/me') }

async function confirmPassword() {
  loading.value = true
  error.value = ''
  try {
    if (intent.value === 'enable') {
      const res = await cmsApi<{ totpURI: string; backupCodes: string[] }>('/api/auth/two-factor/enable', { method: 'POST', body: { password: password.value } })
      totpUri.value = res.totpURI
      backupCodes.value = res.backupCodes
      code.value = ''
      view.value = 'scan'
    }
    else if (intent.value === 'codes') {
      const res = await cmsApi<{ backupCodes: string[] }>('/api/auth/two-factor/generate-backup-codes', { method: 'POST', body: { password: password.value } })
      backupCodes.value = res.backupCodes
      justEnabled.value = false
      view.value = 'codes'
    }
    else {
      await cmsApi('/api/auth/two-factor/disable', { method: 'POST', body: { password: password.value } })
      await refreshUser()
      view.value = 'idle'
    }
    password.value = ''
  }
  catch (e) {
    error.value = cmsErrorMessage(e)
  }
  loading.value = false
}

async function confirmCode() {
  const value = normalizeTotpCode(code.value)
  if (!value) { error.value = 'Saisissez les 6 chiffres affichés par l\'application.'; return }
  loading.value = true
  error.value = ''
  try {
    await cmsApi('/api/auth/two-factor/verify-totp', { method: 'POST', body: { code: value } })
    await refreshUser()
    totpUri.value = ''
    code.value = ''
    justEnabled.value = true
    view.value = 'codes'
  }
  catch (e) {
    error.value = cmsErrorMessage(e)
  }
  loading.value = false
}

function finish() {
  backupCodes.value = []
  view.value = 'idle'
  if (justEnabled.value) emit('done')
}

async function copy(what: 'secret' | 'codes') {
  try {
    await navigator.clipboard.writeText(what === 'secret' ? secret.value : backupCodes.value.join('\n'))
    copied.value = what
    setTimeout(() => { copied.value = '' }, 2500)
  }
  catch {
    error.value = 'Copie impossible : sélectionnez le texte à la main.'
  }
}

function download() {
  const text = backupCodesText(location.host, user.value?.email ?? '', backupCodes.value)
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  link.download = `codes-de-secours-${location.hostname}.txt`
  link.click()
  URL.revokeObjectURL(link.href)
}

const passwordTitle = computed(() => ({
  enable: 'Pour commencer, confirmez votre mot de passe',
  codes: 'Pour créer de nouveaux codes, confirmez votre mot de passe',
  disable: 'Pour désactiver, confirmez votre mot de passe',
})[intent.value])
</script>

<template>
  <div class="card bg-base-100 border border-base-300 p-5 space-y-3" data-two-factor>
    <div class="flex items-center gap-2">
      <div class="font-semibold">Double authentification</div>
      <span class="badge badge-sm badge-soft ml-auto" :class="enabled ? 'badge-success' : 'badge-ghost'" data-two-factor-state>{{ enabled ? 'Activée' : 'Non activée' }}</span>
    </div>

    <!-- État du compte -->
    <template v-if="view === 'idle'">
      <template v-if="enabled">
        <p class="text-sm flex gap-2"><ShieldCheck :size="18" class="shrink-0 text-success mt-0.5" />À chaque connexion, un code à 6 chiffres de votre application d'authentification est demandé après votre mot de passe.</p>
        <div class="flex flex-wrap gap-2">
          <button class="btn btn-sm" @click="ask('codes')">Créer de nouveaux codes de secours</button>
          <button class="btn btn-sm btn-ghost text-error" @click="ask('disable')"><ShieldOff :size="16" />Désactiver</button>
        </div>
        <p class="text-xs text-base-content/60">Nouveau téléphone ? Désactivez puis réactivez la double authentification pour y installer une nouvelle clé.</p>
      </template>
      <template v-else>
        <p class="text-sm">
          En plus de votre mot de passe, un code à 6 chiffres vous sera demandé à chaque connexion. Il est donné par une
          application d'authentification installée sur votre téléphone (Google Authenticator, Microsoft Authenticator, 2FAS, Aegis…).
          Même si quelqu'un découvre votre mot de passe, il ne pourra pas entrer.
        </p>
        <div><button class="btn btn-primary" @click="ask('enable')">Activer la double authentification</button></div>
      </template>
    </template>

    <!-- Mot de passe avant une action sensible -->
    <form v-else-if="view === 'password'" class="space-y-3" @submit.prevent="confirmPassword">
      <div v-if="error" class="alert alert-error alert-soft text-sm" role="alert">{{ error }}</div>
      <p v-if="intent === 'disable'" class="text-sm">
        Votre compte ne sera plus protégé que par son mot de passe. Vos codes de secours et vos appareils de confiance seront oubliés.
        <template v-if="forced || user?.twoFactor?.setupRequired"> Ce site exige la double authentification : vous devrez la réactiver aussitôt.</template>
      </p>
      <p v-if="intent === 'codes'" class="text-sm">Les codes de secours actuels ne fonctionneront plus : seuls les nouveaux seront valables.</p>
      <fieldset class="fieldset">
        <legend class="fieldset-legend">{{ passwordTitle }}</legend>
        <input v-model="password" type="password" class="input w-full" autocomplete="current-password" required autofocus data-two-factor-password>
      </fieldset>
      <div class="flex flex-wrap gap-2">
        <button class="btn" :class="intent === 'disable' ? 'btn-error' : 'btn-primary'" :disabled="loading">{{ intent === 'disable' ? 'Désactiver' : 'Continuer' }}</button>
        <button type="button" class="btn btn-ghost" @click="cancel">Annuler</button>
      </div>
    </form>

    <!-- Activation : code QR, clé, premier code -->
    <form v-else-if="view === 'scan'" class="space-y-4" @submit.prevent="confirmCode">
      <div>
        <div class="text-sm font-medium mb-2">1. Scannez ce code avec votre application d'authentification</div>
        <div class="flex flex-wrap gap-4 items-start">
          <svg v-if="qr" :viewBox="qr.viewBox" class="w-48 h-48 shrink-0 rounded-box border border-base-300 bg-white" role="img" aria-label="Code QR à scanner avec l'application d'authentification" shape-rendering="crispEdges" data-two-factor-qr>
            <rect width="100%" height="100%" fill="#fff" />
            <path :d="qr.path" fill="#000" />
          </svg>
          <div class="text-sm min-w-0 flex-1 basis-56 space-y-2">
            <p>Dans l'application, choisissez « Ajouter un compte » puis « Scanner un code QR ».</p>
            <p class="text-base-content/60">Impossible de scanner ? Choisissez « Saisir une clé » et recopiez celle-ci :</p>
            <div class="font-mono text-sm break-all bg-base-200 rounded-field px-3 py-2 select-all" data-two-factor-secret>{{ formatTotpSecret(secret) }}</div>
            <button type="button" class="btn btn-xs" @click="copy('secret')"><component :is="copied === 'secret' ? Check : Copy" :size="14" />{{ copied === 'secret' ? 'Clé copiée' : 'Copier la clé' }}</button>
          </div>
        </div>
      </div>
      <div v-if="error" class="alert alert-error alert-soft text-sm" role="alert">{{ error }}</div>
      <fieldset class="fieldset">
        <legend class="fieldset-legend">2. Saisissez le code à 6 chiffres affiché par l'application</legend>
        <input
          v-model="code" class="input w-full max-w-48 text-center text-xl font-mono tracking-[0.3em]" inputmode="numeric" autocomplete="one-time-code"
          pattern="[0-9 ]*" maxlength="7" placeholder="000000" required aria-label="Code à 6 chiffres" data-two-factor-code
        >
        <p class="label whitespace-normal">La double authentification n'est activée qu'une fois ce code vérifié.</p>
      </fieldset>
      <div class="flex flex-wrap gap-2">
        <button class="btn btn-primary" :disabled="loading">Vérifier et activer</button>
        <button type="button" class="btn btn-ghost" @click="cancel">Annuler</button>
      </div>
    </form>

    <!-- Codes de secours : montrés une seule fois -->
    <div v-else class="space-y-3">
      <div v-if="justEnabled" class="alert alert-success alert-soft text-sm"><ShieldCheck :size="18" />La double authentification est activée.</div>
      <div class="text-sm font-medium">Vos codes de secours</div>
      <p class="text-sm">
        Si vous n'avez plus votre téléphone, chacun de ces codes remplace <strong>une fois</strong> le code de l'application.
        Rangez-les en lieu sûr (gestionnaire de mots de passe, feuille imprimée) : <strong>ils ne seront plus affichés</strong>.
      </p>
      <ul class="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-sm bg-base-200 rounded-box p-3" data-two-factor-backup-codes>
        <li v-for="c in backupCodes" :key="c" class="select-all">{{ c }}</li>
      </ul>
      <div v-if="error" class="alert alert-error alert-soft text-sm" role="alert">{{ error }}</div>
      <div class="flex flex-wrap gap-2">
        <button class="btn btn-sm" @click="copy('codes')"><component :is="copied === 'codes' ? Check : Copy" :size="14" />{{ copied === 'codes' ? 'Codes copiés' : 'Copier' }}</button>
        <button class="btn btn-sm" @click="download"><Download :size="14" />Télécharger</button>
        <button class="btn btn-sm btn-primary ml-auto" @click="finish">J'ai rangé mes codes</button>
      </div>
    </div>
  </div>
</template>
