<script setup lang="ts">
import { normalizeBackupCode, normalizeTotpCode } from '../../../shared/two-factor'
import '../../assets/css/admin.css'

definePageMeta({ layout: false })

const route = useRoute()
const form = reactive({ email: '', password: '' })
const error = ref('')
const loading = ref(false)

/**
 * Seconde étape, pour un compte protégé par la double authentification : le code de l'application, ou un code de secours.
 * `?etape=code` : le mot de passe vient d'être donné ailleurs (lien de nouveau mot de passe), on arrive droit au code.
 */
const step = ref<'password' | 'code'>(route.query.etape === 'code' ? 'code' : 'password')
const useBackup = ref(false)
const code = ref('')
const trustDevice = ref(false)
const codeInput = ref<HTMLInputElement | null>(null)
const focusCode = () => nextTick(() => codeInput.value?.focus())
onMounted(() => { if (step.value === 'code') focusCode() })

async function enter() {
  useCmsUser().value = null
  await navigateTo('/admin')
}

async function submit() {
  loading.value = true
  error.value = ''
  try {
    const res = await cmsApi<{ twoFactorRedirect?: boolean }>('/api/auth/sign-in/email', { method: 'POST', body: form })
    if (res?.twoFactorRedirect) {
      form.password = ''
      code.value = ''
      useBackup.value = false
      step.value = 'code'
      focusCode()
    }
    else await enter()
  }
  catch (e: any) {
    error.value = e?.status === 401 ? 'E-mail ou mot de passe incorrect.' : cmsErrorMessage(e)
  }
  loading.value = false
}

function backToPassword(message = '') {
  step.value = 'password'
  code.value = ''
  error.value = message
}

async function submitCode() {
  if (loading.value) return
  const value = useBackup.value ? normalizeBackupCode(code.value) : normalizeTotpCode(code.value)
  if (!value) {
    error.value = useBackup.value ? 'Un code de secours ressemble à « aB3dE-fG7hI ».' : 'Saisissez les 6 chiffres affichés par votre application.'
    return
  }
  loading.value = true
  error.value = ''
  try {
    await cmsApi(`/api/auth/two-factor/${useBackup.value ? 'verify-backup-code' : 'verify-totp'}`, { method: 'POST', body: { code: value, trustDevice: trustDevice.value } })
    await enter()
  }
  catch (e: any) {
    const reason = e?.data?.code
    // La vérification est terminée (délai dépassé, trop d'essais) : il faut redonner son mot de passe.
    if (reason === 'INVALID_TWO_FACTOR_COOKIE' || reason === 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE') backToPassword(cmsErrorMessage(e))
    else {
      error.value = cmsErrorMessage(e)
      code.value = ''
      focusCode()
    }
  }
  loading.value = false
}

// Les 6 chiffres saisis (ou collés) : inutile de chercher le bouton.
watch(code, (value) => { if (!useBackup.value && /^\d{6}$/.test(value.replace(/\s+/g, ''))) submitCode() })

function toggleBackup() {
  useBackup.value = !useBackup.value
  code.value = ''
  error.value = ''
  focusCode()
}
</script>

<template>
  <div class="cms-admin min-h-screen bg-base-200 text-base-content grid place-items-center p-4" data-theme="light" :style="useCmsAdminStyle().value">
    <form v-if="step === 'password'" class="card bg-base-100 border border-base-300 w-full max-w-sm p-6 space-y-4" @submit.prevent="submit">
      <h1 class="text-xl font-bold">Connexion</h1>
      <div v-if="error" class="alert alert-error alert-soft text-sm" role="alert">{{ error }}</div>
      <fieldset class="fieldset">
        <legend class="fieldset-legend">E-mail</legend>
        <input v-model="form.email" type="email" class="input w-full" autocomplete="username" required autofocus>
      </fieldset>
      <fieldset class="fieldset">
        <legend class="fieldset-legend">Mot de passe</legend>
        <input v-model="form.password" type="password" class="input w-full" autocomplete="current-password" required>
      </fieldset>
      <button class="btn btn-primary w-full" :disabled="loading">Se connecter</button>
      <p class="text-center text-sm"><NuxtLink to="/admin/forgot-password" class="link link-hover">Mot de passe oublié ?</NuxtLink></p>
    </form>

    <form v-else class="card bg-base-100 border border-base-300 w-full max-w-sm p-6 space-y-4" data-login-code @submit.prevent="submitCode">
      <div>
        <h1 class="text-xl font-bold">Vérification en deux étapes</h1>
        <p class="text-sm text-base-content/70 mt-1">
          {{ useBackup ? 'Saisissez l\'un de vos codes de secours. Chaque code ne fonctionne qu\'une fois.' : 'Ouvrez votre application d\'authentification et saisissez le code à 6 chiffres affiché pour ce site.' }}
        </p>
      </div>
      <div v-if="error" class="alert alert-error alert-soft text-sm" role="alert">{{ error }}</div>
      <fieldset class="fieldset">
        <legend class="fieldset-legend">{{ useBackup ? 'Code de secours' : 'Code à 6 chiffres' }}</legend>
        <input
          v-if="useBackup" ref="codeInput" v-model="code" class="input w-full text-center text-lg font-mono" autocomplete="off" autocapitalize="off" autocorrect="off"
          spellcheck="false" maxlength="14" placeholder="xxxxx-xxxxx" required
        >
        <input
          v-else ref="codeInput" v-model="code" class="input w-full text-center text-2xl font-mono tracking-[0.3em]" inputmode="numeric" autocomplete="one-time-code"
          pattern="[0-9 ]*" maxlength="7" placeholder="000000" required
        >
      </fieldset>
      <label class="flex items-start gap-2 cursor-pointer text-sm">
        <input v-model="trustDevice" type="checkbox" class="checkbox checkbox-sm mt-0.5">
        <span>Se souvenir de cet appareil pendant 30 jours<span class="block text-xs text-base-content/60">À ne cocher que sur un appareil qui est le vôtre.</span></span>
      </label>
      <button class="btn btn-primary w-full" :disabled="loading">Vérifier</button>
      <div class="flex flex-wrap justify-between gap-2 text-sm">
        <button type="button" class="link link-hover" @click="toggleBackup">{{ useBackup ? 'Utiliser l\'application' : 'Utiliser un code de secours' }}</button>
        <button type="button" class="link link-hover" @click="backToPassword()">Retour</button>
      </div>
      <p class="text-xs text-base-content/60">Plus de téléphone ni de codes de secours ? Un administrateur du site peut réinitialiser votre double authentification.</p>
    </form>
  </div>
</template>
