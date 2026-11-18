<script setup lang="ts">
const route = useRoute()
// Une ancienne adresse redirige d'elle-même vers la nouvelle.
const { data: service, error } = await useEntry('services', () => route.params.slug as string)
if (error.value || !service.value) throw createError({ statusCode: 404, statusMessage: 'Service introuvable', fatal: true })
useCmsSeo(service, { titleSuffix: 'Cabinet Durand' })
</script>

<template>
  <main v-if="service" class="max-w-3xl mx-auto p-6 space-y-4">
    <NuxtLink to="/" class="link text-sm">Retour à l'accueil</NuxtLink>
    <CmsImage :media="service.cover" sizes="(min-width: 48rem) 45rem, 100vw" loading="eager" class="w-full h-auto rounded-box" />
    <h1 class="text-4xl font-bold">{{ service.title }}</h1>
    <p class="opacity-70">{{ service.excerpt }}</p>
    <div class="space-y-3" v-html="service.body" />

    <!-- Réalisations : un répéteur dont chaque élément a sa galerie de photos légendées. -->
    <section v-if="service.cases.length" class="space-y-6 pt-4">
      <h2 class="text-2xl font-bold">Réalisations</h2>
      <article v-for="(c, i) in service.cases" :key="i" class="cms-case space-y-3">
        <h3 class="text-lg font-semibold">{{ c.title }}</h3>
        <p v-if="c.text" class="opacity-70">{{ c.text }}</p>
        <div v-if="c.photos.length" class="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <figure v-for="photo in c.photos" :key="photo.id" class="space-y-1">
            <CmsImage :media="photo" sizes="(min-width: 48rem) 15rem, 50vw" class="w-full aspect-[4/3] object-cover rounded-box" />
            <figcaption v-if="photo.caption" class="text-sm opacity-70">{{ photo.caption }}</figcaption>
          </figure>
        </div>
      </article>
    </section>
  </main>
</template>
