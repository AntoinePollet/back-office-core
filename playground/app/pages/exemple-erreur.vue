<script setup lang="ts">
// Page d'exemple du module « Suivi des erreurs et surveillance » : son bouton provoque une erreur dans le navigateur.
useHead({ title: 'Exemple d\'erreur — Cabinet Durand' })
function casser() {
  // Une erreur comme en produit un script mal écrit : elle est relevée et regroupée dans « Surveillance ».
  ;(undefined as unknown as { envoyer: () => void }).envoyer()
}
</script>

<template>
  <main class="max-w-xl mx-auto p-6 space-y-4">
    <NuxtLink to="/" class="font-bold text-lg">Cabinet Durand</NuxtLink>
    <h1 class="text-3xl font-bold">Exemple d'erreur</h1>
    <p>Ce bouton provoque une erreur dans le navigateur, pour essayer le suivi des erreurs.</p>
    <button class="btn" data-casser @click="casser">Provoquer une erreur</button>
  </main>
</template>
