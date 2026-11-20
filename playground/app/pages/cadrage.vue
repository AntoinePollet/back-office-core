<script setup lang="ts">
// Page d'exemple du recadrage : les photos de la galerie de l'accueil, dans plusieurs proportions.
// `ratio` (ou `:width` et `:height`) fait recadrer l'image par le serveur, autour du point d'intérêt réglé dans la
// médiathèque ; sans `ratio`, c'est le navigateur qui recadre (`object-cover`), autour du même point.
const { data: home } = await useSingleton('home')
useHead({ title: 'Cadrage des images — Cabinet Durand' })
</script>

<template>
  <main class="max-w-3xl mx-auto p-6 space-y-8">
    <nav class="flex items-center gap-4 text-sm">
      <NuxtLink to="/" class="font-bold text-lg">Cabinet Durand</NuxtLink>
    </nav>
    <h1 class="text-3xl font-bold">Cadrage des images</h1>
    <p v-if="!home?.gallery?.length" class="opacity-70">Aucune photo dans la galerie de l'accueil.</p>

    <article v-for="photo in home?.gallery ?? []" :key="photo.id" class="space-y-3" :data-photo="photo.name">
      <h2 class="text-lg font-semibold">{{ photo.caption || photo.name }}</h2>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 items-start">
        <figure class="space-y-1">
          <CmsImage :media="photo" ratio="1/1" sizes="(min-width: 40rem) 11rem, 50vw" class="w-full rounded-box" data-shot="carre" />
          <figcaption class="text-sm opacity-70">Carré, recadré par le serveur</figcaption>
        </figure>
        <figure class="space-y-1">
          <CmsImage :media="photo" ratio="16/9" sizes="(min-width: 40rem) 11rem, 50vw" class="w-full rounded-box" data-shot="paysage" />
          <figcaption class="text-sm opacity-70">Paysage 16/9</figcaption>
        </figure>
        <figure class="space-y-1">
          <CmsImage :media="photo" :width="150" :height="200" class="rounded-box" data-shot="portrait" />
          <figcaption class="text-sm opacity-70">Portrait 150 × 200</figcaption>
        </figure>
        <figure class="space-y-1">
          <CmsImage :media="photo" sizes="(min-width: 40rem) 11rem, 50vw" class="w-full aspect-[4/3] object-cover rounded-box" data-shot="css" />
          <figcaption class="text-sm opacity-70">Recadré par le navigateur</figcaption>
        </figure>
      </div>
      <CmsImage :media="photo" ratio="3/1" sizes="(min-width: 48rem) 45rem, 100vw" class="w-full rounded-box" data-shot="bandeau" />
    </article>
  </main>
</template>
