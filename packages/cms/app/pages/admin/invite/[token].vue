<script setup lang="ts">
import '../../../assets/css/admin.css'

definePageMeta({ layout: false })

const token = useRoute().params.token as string
const invite = ref<{ name: string; email: string } | null>(null)
const invalid = ref('')
try {
  invite.value = await cmsApi<{ name: string; email: string }>(`/api/cms/invite/${token}`)
}
catch (e) {
  invalid.value = cmsErrorMessage(e, 'Ce lien n\'est plus valable.')
}

const form = reactive({ password: '', confirm: '' })
const error = ref('')
const loading = ref(false)

async function submit() {
  error.value = ''
  if (form.password !== form.confirm) { error.value = 'Les deux mots de passe ne sont pas identiques.'; return }
  loading.value = true
  try {
    const { email } = await cmsApi<{ email: string }>(`/api/cms/invite/${token}`, { method: 'POST', body: { password: form.password } })
    const signedIn = await cmsApi<{ twoFactorRedirect?: boolean }>('/api/auth/sign-in/email', { method: 'POST', body: { email, password: form.password } })
    useCmsUser().value = null
    // Un nouveau mot de passe ne dispense pas du second facteur : le code est demandé avant d'entrer.
    await navigateTo(signedIn?.twoFactorRedirect ? '/admin/login?etape=code' : '/admin')
  }
  catch (e) {
    error.value = cmsErrorMessage(e)
  }
  loading.value = false
}
</script>

<template>
  <div class="cms-admin min-h-screen bg-base-200 text-base-content grid place-items-center p-4" data-theme="light" :style="useCmsAdminStyle().value">
    <div v-if="invalid" class="card bg-base-100 border border-base-300 w-full max-w-sm p-6 space-y-3">
      <h1 class="text-xl font-bold">Lien non valable</h1>
      <p class="text-sm">{{ invalid }}</p>
      <NuxtLink to="/admin/forgot-password" class="btn btn-primary">Demander un nouveau lien</NuxtLink>
      <NuxtLink to="/admin/login" class="btn">Aller à la connexion</NuxtLink>
    </div>
    <form v-else-if="invite" class="card bg-base-100 border border-base-300 w-full max-w-sm p-6 space-y-4" @submit.prevent="submit">
      <div>
        <h1 class="text-xl font-bold">Bonjour {{ invite.name }}</h1>
        <p class="text-sm text-base-content/60">Choisissez le mot de passe du compte {{ invite.email }}.</p>
      </div>
      <div v-if="error" class="alert alert-error alert-soft text-sm">{{ error }}</div>
      <fieldset class="fieldset">
        <legend class="fieldset-legend">Mot de passe</legend>
        <input v-model="form.password" type="password" class="input w-full" autocomplete="new-password" minlength="10" required autofocus>
        <p class="label">10 caractères au minimum.</p>
      </fieldset>
      <fieldset class="fieldset">
        <legend class="fieldset-legend">Confirmation</legend>
        <input v-model="form.confirm" type="password" class="input w-full" autocomplete="new-password" required>
      </fieldset>
      <button class="btn btn-primary w-full" :disabled="loading">Enregistrer et se connecter</button>
    </form>
  </div>
</template>
