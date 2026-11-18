<script setup lang="ts">
import '../../assets/css/admin.css'

definePageMeta({ layout: false })

// L'envoi d'e-mails est un réglage du site : on le sait avant toute saisie, sans rien révéler sur les comptes.
const { available } = await cmsApi<{ available: boolean }>('/api/cms/password-reset').catch(() => ({ available: true }))

const email = ref('')
const error = ref('')
const loading = ref(false)
/** Adresse pour laquelle la demande vient d'être envoyée. */
const sentTo = ref('')

async function submit() {
  loading.value = true
  error.value = ''
  try {
    await cmsApi('/api/cms/password-reset', { method: 'POST', body: { email: email.value } })
    sentTo.value = email.value.trim()
  }
  catch (e) {
    error.value = cmsErrorMessage(e)
  }
  loading.value = false
}
</script>

<template>
  <div class="cms-admin min-h-screen bg-base-200 text-base-content grid place-items-center p-4" data-theme="light" :style="useCmsAdminStyle().value">
    <div v-if="!available" class="card bg-base-100 border border-base-300 w-full max-w-sm p-6 space-y-4">
      <h1 class="text-xl font-bold">Mot de passe oublié</h1>
      <p class="text-sm">Ce site n'envoie pas d'e-mails : le lien pour choisir un nouveau mot de passe ne peut pas vous être envoyé automatiquement.</p>
      <p class="text-sm"><strong>Adressez-vous à un administrateur du site</strong> : il peut vous créer un lien depuis l'écran « Utilisateurs » et vous le transmettre.</p>
      <NuxtLink to="/admin/login" class="btn w-full">Retour à la connexion</NuxtLink>
    </div>

    <div v-else-if="sentTo" class="card bg-base-100 border border-base-300 w-full max-w-sm p-6 space-y-4" role="status">
      <h1 class="text-xl font-bold">Vérifiez vos e-mails</h1>
      <p class="text-sm">Si un compte existe pour <strong class="break-all">{{ sentTo }}</strong>, un e-mail vient de lui être envoyé avec un lien pour choisir un nouveau mot de passe.</p>
      <p class="text-sm text-base-content/60">Le lien est valable une heure. Rien reçu après quelques minutes ? Regardez dans les courriers indésirables, vérifiez l'adresse saisie, ou adressez-vous à un administrateur du site.</p>
      <NuxtLink to="/admin/login" class="btn w-full">Retour à la connexion</NuxtLink>
    </div>

    <form v-else class="card bg-base-100 border border-base-300 w-full max-w-sm p-6 space-y-4" @submit.prevent="submit">
      <div>
        <h1 class="text-xl font-bold">Mot de passe oublié</h1>
        <p class="text-sm text-base-content/60">Indiquez l'adresse e-mail de votre compte : vous recevrez un lien pour choisir un nouveau mot de passe.</p>
      </div>
      <div v-if="error" class="alert alert-error alert-soft text-sm" role="alert">{{ error }}</div>
      <fieldset class="fieldset">
        <legend class="fieldset-legend">E-mail</legend>
        <input v-model="email" type="email" class="input w-full" autocomplete="username" required autofocus>
      </fieldset>
      <button class="btn btn-primary w-full" :disabled="loading">Recevoir le lien</button>
      <p class="text-center text-sm"><NuxtLink to="/admin/login" class="link link-hover">Retour à la connexion</NuxtLink></p>
    </form>
  </div>
</template>
