<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'cms-auth' })

type Review = { id: string; type: string; typeLabel: string; title: string; by: string; note: string | null; at: string; mine: boolean; canHandle: boolean }

const reviews = ref(await cmsApi<Review[]>('/api/cms/reviews'))
const toHandle = computed(() => reviews.value.filter(r => r.canHandle))
const mine = computed(() => reviews.value.filter(r => r.mine && !r.canHandle))
</script>

<template>
  <section class="max-w-4xl mx-auto">
    <div class="mb-6">
      <h1 class="text-2xl font-bold">À valider</h1>
      <p class="text-sm text-base-content/60">Les brouillons dont la publication a été demandée. Ouvrez un contenu pour le relire, puis publiez-le : la demande se ferme toute seule.</p>
    </div>

    <p v-if="!reviews.length" class="card bg-base-100 border border-base-300 p-6 text-sm text-base-content/60">Aucune demande en attente.</p>

    <template v-for="group in [{ title: 'À relire et publier', items: toHandle }, { title: 'Vos demandes en attente', items: mine }]" :key="group.title">
      <div v-if="group.items.length" class="mb-6">
        <h2 class="text-sm font-semibold mb-2">{{ group.title }} <span class="opacity-60">{{ group.items.length }}</span></h2>
        <div class="card bg-base-100 border border-base-300 divide-y divide-base-300">
          <NuxtLink v-for="r in group.items" :key="r.id" :to="`/admin/${r.type}/${r.id}`" class="block p-4 hover:bg-base-200">
            <div class="flex flex-wrap items-baseline gap-x-3">
              <span class="font-medium">{{ r.title }}</span>
              <span class="text-xs text-base-content/50">{{ r.typeLabel }}</span>
              <span class="text-xs text-base-content/60 ml-auto">{{ r.mine ? 'vous' : r.by }}, {{ cmsFormatWhen(r.at) }}</span>
            </div>
            <p v-if="r.note" class="text-sm text-base-content/70 mt-1 whitespace-pre-line">« {{ r.note }} »</p>
          </NuxtLink>
        </div>
      </div>
    </template>
  </section>
</template>
