<script setup lang="ts">
import '../../assets/css/admin.css'

definePageMeta({ layout: false })

const form = reactive({ email: '', password: '' })
const error = ref('')
const loading = ref(false)

async function submit() {
  loading.value = true
  error.value = ''
  try {
    await cmsApi('/api/auth/sign-in/email', { method: 'POST', body: form })
    useCmsUser().value = null
    await navigateTo('/admin')
  }
  catch (e: any) {
    error.value = e?.status === 401 ? 'E-mail ou mot de passe incorrect.' : cmsErrorMessage(e)
  }
  loading.value = false
}
</script>

<template>
  <div class="cms-admin min-h-screen bg-base-200 text-base-content grid place-items-center p-4" data-theme="light" :style="useCmsAdminStyle().value">
    <form class="card bg-base-100 border border-base-300 w-full max-w-sm p-6 space-y-4" @submit.prevent="submit">
      <h1 class="text-xl font-bold">Connexion</h1>
      <div v-if="error" class="alert alert-error alert-soft text-sm">{{ error }}</div>
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
  </div>
</template>
