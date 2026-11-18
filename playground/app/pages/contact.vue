<script setup lang="ts">
// Page d'exemple du module « Formulaires » : le formulaire « contact » est déclaré dans cms.config.ts.
const form = useCmsForm('contact', { subject: 'devis', consent: false })
useHead({ title: 'Contact — Cabinet Durand' })
</script>

<template>
  <main class="max-w-xl mx-auto p-6 space-y-6">
    <nav class="flex items-center gap-4 text-sm">
      <NuxtLink to="/" class="font-bold text-lg">Cabinet Durand</NuxtLink>
    </nav>
    <h1 class="text-3xl font-bold">Nous écrire</h1>

    <div v-if="form.sent.value" class="alert alert-success" role="status">Merci, votre message est bien parti. Nous vous répondrons rapidement.</div>

    <form v-else class="space-y-3" novalidate @submit.prevent="form.submit()">
      <fieldset class="fieldset">
        <legend class="fieldset-legend">Nom</legend>
        <input v-model="form.values.name" name="name" class="input w-full" :class="{ 'input-error': form.errors.value.name }">
        <p v-if="form.errors.value.name" class="label text-error">{{ form.errors.value.name }}</p>
      </fieldset>
      <fieldset class="fieldset">
        <legend class="fieldset-legend">E-mail</legend>
        <input v-model="form.values.email" name="email" type="email" class="input w-full" :class="{ 'input-error': form.errors.value.email }">
        <p v-if="form.errors.value.email" class="label text-error">{{ form.errors.value.email }}</p>
      </fieldset>
      <fieldset class="fieldset">
        <legend class="fieldset-legend">Sujet</legend>
        <select v-model="form.values.subject" name="subject" class="select w-full">
          <option value="devis">Demande de devis</option>
          <option value="autre">Autre question</option>
        </select>
      </fieldset>
      <fieldset class="fieldset">
        <legend class="fieldset-legend">Message</legend>
        <textarea v-model="form.values.message" name="message" rows="5" class="textarea w-full" :class="{ 'textarea-error': form.errors.value.message }" />
        <p v-if="form.errors.value.message" class="label text-error">{{ form.errors.value.message }}</p>
      </fieldset>
      <label class="flex items-start gap-2 text-sm cursor-pointer">
        <input v-model="form.values.consent" name="consent" type="checkbox" class="checkbox checkbox-sm mt-0.5">
        <span>J'accepte que mes données soient utilisées pour me répondre.</span>
      </label>
      <p v-if="form.errors.value.consent" class="text-sm text-error">{{ form.errors.value.consent }}</p>
      <!-- Champ piège : invisible pour une personne, rempli seulement par les robots. -->
      <input v-model="form.trap.value" name="website" class="hidden" tabindex="-1" autocomplete="off" aria-hidden="true">

      <!-- Anti-robots (module « turnstile ») : n'affiche rien tant qu'il n'est pas réglé dans le back-office. -->
      <CmsTurnstile />

      <p v-if="form.error.value" class="text-sm text-error" role="alert">{{ form.error.value }}</p>
      <button class="btn btn-primary" :disabled="form.pending.value">{{ form.pending.value ? 'Envoi…' : 'Envoyer' }}</button>
    </form>
  </main>
</template>
