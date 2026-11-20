<script setup lang="ts">
// Version anglaise d'un service : la même lecture, dans l'autre langue du site (`locale`).
const route = useRoute()
const { data: service, error } = await useEntry('services', () => route.params.slug as string, { locale: 'en' })
if (error.value || !service.value) throw createError({ statusCode: 404, statusMessage: 'Service not found', fatal: true })
useCmsSeo(service, { titleSuffix: 'Cabinet Durand' })
</script>

<template>
  <main v-if="service" class="max-w-3xl mx-auto p-6 space-y-4">
    <CmsImage :media="service.cover" sizes="(min-width: 48rem) 45rem, 100vw" loading="eager" class="w-full h-auto rounded-box" />
    <h1 class="text-4xl font-bold">{{ service.title }}</h1>
    <p class="opacity-70">{{ service.excerpt }}</p>
    <div class="space-y-3" v-html="service.body" />
  </main>
</template>
