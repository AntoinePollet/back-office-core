<script setup lang="ts">
// Page où Stripe renvoie l'acheteur (successPath). Elle ne dit « confirmé » que si Stripe l'a annoncé au site (webhook).
const { result, loading, sessionId } = useCmsCheckoutResult()
useHead({ title: 'Merci — Cabinet Durand', meta: [{ name: 'robots', content: 'noindex' }] })
</script>

<template>
  <main class="max-w-xl mx-auto p-6 space-y-6">
    <nav class="flex items-center gap-4 text-sm">
      <NuxtLink to="/" class="font-bold text-lg">Cabinet Durand</NuxtLink>
    </nav>
    <h1 class="text-3xl font-bold">Merci !</h1>
    <p v-if="loading" class="text-base-content/60">Un instant…</p>
    <div v-else-if="result?.status === 'paid'" class="alert alert-success" role="status">
      Votre paiement de {{ result.amount }} pour « {{ result.product }} » est confirmé. Vous recevrez un reçu par e-mail.
    </div>
    <div v-else-if="result?.status === 'failed'" class="alert alert-error" role="status">
      Le paiement n'a pas abouti. Vous pouvez réessayer depuis la boutique.
    </div>
    <div v-else-if="sessionId" class="alert alert-info" role="status">
      Votre paiement est en cours de confirmation. Vous recevrez un reçu par e-mail dès qu'il sera validé.
    </div>
    <p v-else class="text-base-content/60">Rien à confirmer ici.</p>
    <NuxtLink to="/boutique" class="btn">Retour à la boutique</NuxtLink>
  </main>
</template>
