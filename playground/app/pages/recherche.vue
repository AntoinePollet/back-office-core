<script setup lang="ts">
// Page d'exemple de la recherche du site : `/recherche?q=droit`. Les contenus cherchés sont ceux qui ont une page.
const route = useRoute()
const q = ref(String(route.query.q ?? ''))
const { data: results, status } = useCmsSearch(q)
// L'adresse suit la recherche : la page se partage et se recharge avec ses résultats.
watch(q, value => navigateTo({ query: value ? { q: value } : {} }, { replace: true }))
useHead({ title: 'Recherche — Cabinet Durand' })
</script>

<template>
  <main class="max-w-xl mx-auto p-6 space-y-6">
    <nav class="flex items-center gap-4 text-sm">
      <NuxtLink to="/" class="font-bold text-lg">Cabinet Durand</NuxtLink>
    </nav>
    <h1 class="text-3xl font-bold">Recherche</h1>
    <input v-model="q" type="search" name="q" class="input w-full" placeholder="Un service, un sujet…" aria-label="Rechercher sur le site" autofocus>

    <p v-if="status === 'pending'" class="text-sm opacity-60">Recherche…</p>
    <p v-else-if="q.trim().length >= 2 && !results?.items.length" class="text-sm opacity-60" data-search-empty>Aucune page ne correspond à « {{ q }} ».</p>
    <template v-else-if="results?.items.length">
      <p class="text-sm opacity-60" data-search-total>{{ results.total }} résultat{{ results.total > 1 ? 's' : '' }}</p>
      <ul class="space-y-4">
        <li v-for="r in results.items" :key="`${r.type}:${r.id}`" data-search-result>
          <NuxtLink :to="r.path" class="font-semibold link link-hover">{{ r.title }}</NuxtLink>
          <span class="badge badge-sm badge-ghost ml-2">{{ r.typeLabel }}</span>
          <p class="text-sm opacity-80">
            <template v-for="(part, i) in r.excerpt" :key="i"><mark v-if="part.match">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template>
          </p>
        </li>
      </ul>
    </template>
  </main>
</template>
