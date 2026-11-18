<script setup lang="ts">
// Page d'exemple du module « Stripe » : la collection « products » est déclarée vendable dans cms.config.ts.
// Le bouton n'envoie que le produit et la quantité : le prix payé est celui du back-office.
const { data: products } = await useCollection('products')
const { checkout, pending, error } = useCmsCheckout()
const quantities = reactive<Record<string, number>>({})
watchEffect(() => { for (const p of products.value ?? []) quantities[p.id] ??= 1 })
const euros = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
useHead({ title: 'Boutique — Cabinet Durand' })
</script>

<template>
  <main class="max-w-4xl mx-auto p-6 space-y-6">
    <nav class="flex items-center gap-4 text-sm">
      <NuxtLink to="/" class="font-bold text-lg">Cabinet Durand</NuxtLink>
    </nav>
    <h1 class="text-3xl font-bold">Boutique</h1>
    <p v-if="error" class="alert alert-error" role="alert">{{ error }}</p>
    <p v-if="!products?.length" class="text-base-content/60">Aucun produit pour le moment.</p>

    <div class="grid sm:grid-cols-2 gap-4 items-start">
      <article v-for="p in products" :key="p.id" class="card bg-base-100 border border-base-300" :data-product="p.title">
        <figure v-if="p.image"><img :src="cmsImageUrl(p.image, 600)" :alt="p.image.alt" class="w-full aspect-[3/2] object-cover"></figure>
        <div class="card-body">
          <h2 class="card-title">{{ p.title }}</h2>
          <p v-if="p.description" class="text-sm text-base-content/70">{{ p.description }}</p>
          <p v-if="p.price !== null" class="text-xl font-semibold">{{ euros(p.price) }}</p>
          <div v-if="p.price !== null && p.onSale" class="card-actions items-center">
            <label class="text-sm">Quantité
              <select v-model.number="quantities[p.id]" class="select select-sm w-20 ml-1" :aria-label="`Quantité : ${p.title}`">
                <option v-for="n in 5" :key="n" :value="n">{{ n }}</option>
              </select>
            </label>
            <button class="btn btn-primary ml-auto" :disabled="pending" @click="checkout('products', p.id, { quantity: quantities[p.id] })">
              {{ pending ? 'Redirection…' : 'Acheter' }}
            </button>
          </div>
          <p v-else class="text-sm text-base-content/60">Indisponible pour le moment.</p>
        </div>
      </article>
    </div>
  </main>
</template>
