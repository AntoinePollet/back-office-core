<script setup lang="ts">
import '../../assets/css/admin.css'

definePageMeta({ layout: false })

const { needed } = await cmsApi<{ needed: boolean }>('/api/cms/setup')
if (!needed) await navigateTo('/admin/login', { replace: true })

const form = reactive({ name: '', email: '', password: '' })
const error = ref('')
const loading = ref(false)

async function submit() {
  loading.value = true
  error.value = ''
  try {
    await cmsApi('/api/cms/setup', { method: 'POST', body: form })
    await cmsApi('/api/auth/sign-in/email', { method: 'POST', body: { email: form.email, password: form.password } })
    await navigateTo('/admin')
  }
  catch (e) {
    error.value = cmsErrorMessage(e)
  }
  loading.value = false
}
</script>

<template>
  <div class="cms-admin min-h-screen bg-base-200 text-base-content grid place-items-center p-4" data-theme="light" :style="useCmsAdminStyle().value">
    <form class="card bg-base-100 border border-base-300 w-full max-w-sm p-6 space-y-4" @submit.prevent="submit">
      <div>
        <h1 class="text-xl font-bold">Premier compte</h1>
        <p class="text-sm text-base-content/60">Ce compte sera l'administrateur du back-office.</p>
      </div>
      <div v-if="error" class="alert alert-error alert-soft text-sm">{{ error }}</div>
      <fieldset class="fieldset">
        <legend class="fieldset-legend">Nom</legend>
        <input v-model="form.name" class="input w-full" autocomplete="name" required autofocus>
      </fieldset>
      <fieldset class="fieldset">
        <legend class="fieldset-legend">E-mail</legend>
        <input v-model="form.email" type="email" class="input w-full" autocomplete="username" required>
      </fieldset>
      <fieldset class="fieldset">
        <legend class="fieldset-legend">Mot de passe</legend>
        <input v-model="form.password" type="password" class="input w-full" autocomplete="new-password" minlength="10" required>
        <p class="label">10 caractères au minimum.</p>
      </fieldset>
      <button class="btn btn-primary w-full" :disabled="loading">Créer le compte</button>
    </form>
  </div>
</template>
