<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'cms-auth' })

const user = useCmsUser()
const toast = useCmsToast()
const form = reactive({ current: '', next: '', confirm: '' })
const error = ref('')
const loading = ref(false)

async function changePassword() {
  error.value = ''
  if (form.next !== form.confirm) { error.value = 'Les deux nouveaux mots de passe ne sont pas identiques.'; return }
  loading.value = true
  try {
    await cmsApi('/api/auth/change-password', { method: 'POST', body: { currentPassword: form.current, newPassword: form.next, revokeOtherSessions: true } })
    Object.assign(form, { current: '', next: '', confirm: '' })
    toast.success('Mot de passe modifié. Vos autres sessions ont été fermées.')
  }
  catch (e: any) {
    error.value = e?.status === 400 ? 'Mot de passe actuel incorrect, ou nouveau mot de passe trop court (10 caractères au minimum).' : cmsErrorMessage(e)
  }
  loading.value = false
}
</script>

<template>
  <section class="max-w-xl mx-auto">
    <h1 class="text-2xl font-bold mb-6">Mon compte</h1>

    <div class="card bg-base-100 border border-base-300 p-5 text-sm space-y-2 mb-4">
      <div class="flex justify-between"><span class="text-base-content/60">Nom</span><span>{{ user?.name }}</span></div>
      <div class="flex justify-between"><span class="text-base-content/60">E-mail</span><span>{{ user?.email }}</span></div>
      <div class="flex justify-between"><span class="text-base-content/60">Rôle</span><span>{{ user?.role === 'admin' ? 'Administrateur' : 'Éditeur' }}</span></div>
    </div>

    <form class="card bg-base-100 border border-base-300 p-5 space-y-3" @submit.prevent="changePassword">
      <div class="font-semibold">Changer de mot de passe</div>
      <div v-if="error" class="alert alert-error alert-soft text-sm">{{ error }}</div>
      <fieldset class="fieldset">
        <legend class="fieldset-legend">Mot de passe actuel</legend>
        <input v-model="form.current" type="password" class="input w-full" autocomplete="current-password" required>
      </fieldset>
      <fieldset class="fieldset">
        <legend class="fieldset-legend">Nouveau mot de passe</legend>
        <input v-model="form.next" type="password" class="input w-full" autocomplete="new-password" minlength="10" required>
        <p class="label">10 caractères au minimum.</p>
      </fieldset>
      <fieldset class="fieldset">
        <legend class="fieldset-legend">Confirmation</legend>
        <input v-model="form.confirm" type="password" class="input w-full" autocomplete="new-password" required>
      </fieldset>
      <div><button class="btn btn-primary" :disabled="loading">Modifier le mot de passe</button></div>
    </form>
  </section>
</template>
