<script setup lang="ts">
// Page d'exemple du module « Lettre d'information » : à activer dans le back-office, écran « Modules ».
const newsletter = useCmsNewsletter()
// Flux RSS de la collection « services » (feed dans cms.config.ts) : annoncé dans l'en-tête, et proposé en lien.
const feed = useCmsFeed('services', { title: 'Cabinet Durand : nos services' })
useHead({ title: 'Lettre d\'information — Cabinet Durand' })
</script>

<template>
  <main class="max-w-xl mx-auto p-6 space-y-6">
    <nav class="flex items-center gap-4 text-sm">
      <NuxtLink to="/" class="font-bold text-lg">Cabinet Durand</NuxtLink>
    </nav>
    <h1 class="text-3xl font-bold">Lettre d'information</h1>
    <p>Une lettre par mois : l'actualité du droit des affaires, expliquée simplement. Vous préférez un lecteur de flux ? <a :href="feed" class="link" data-feed-link>Flux RSS</a>.</p>

    <div v-if="newsletter.sent.value" class="alert alert-success" role="status" data-newsletter-sent>
      Merci ! Un e-mail vient de vous être envoyé : cliquez sur son lien pour confirmer votre inscription.
    </div>
    <form v-else class="space-y-3" novalidate @submit.prevent="newsletter.submit()">
      <fieldset class="fieldset">
        <legend class="fieldset-legend">Votre adresse e-mail</legend>
        <input v-model="newsletter.email.value" name="email" type="email" class="input w-full" autocomplete="email">
      </fieldset>
      <!-- Champ piège : invisible pour une personne, rempli seulement par les robots. -->
      <input v-model="newsletter.trap.value" name="website" class="hidden" tabindex="-1" autocomplete="off" aria-hidden="true">
      <CmsTurnstile />
      <p v-if="newsletter.error.value" class="text-sm text-error" role="alert">{{ newsletter.error.value }}</p>
      <button class="btn btn-primary" :disabled="newsletter.pending.value">{{ newsletter.pending.value ? 'Envoi…' : 'S\'inscrire' }}</button>
      <p class="text-xs opacity-70">Votre adresse ne sert qu'à vous envoyer cette lettre. Chaque lettre contient un lien de désinscription.</p>
    </form>
  </main>
</template>
