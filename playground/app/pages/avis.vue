<script setup lang="ts">
// Page d'exemple du module « Avis Google » : à activer et régler dans le back-office, écran « Modules ».
const route = useRoute()
const locale = computed(() => (route.query.lang === 'en' ? 'en' : 'fr'))
useHead({ title: 'Avis de nos clients — Cabinet Durand' })
</script>

<template>
  <main class="max-w-3xl mx-auto p-6 space-y-6">
    <nav class="flex items-center gap-4 text-sm">
      <NuxtLink to="/" class="font-bold text-lg">Cabinet Durand</NuxtLink>
    </nav>
    <h1 class="text-3xl font-bold">Avis de nos clients</h1>
    <!-- La note seule, comme on la placerait dans un pied de page. -->
    <div data-avis-resume><CmsGoogleReviews summary :locale="locale" /></div>
    <!-- Les avis d'au moins quatre étoiles. -->
    <div data-avis-liste><CmsGoogleReviews :min-rating="4" :locale="locale" /></div>
  </main>
</template>
