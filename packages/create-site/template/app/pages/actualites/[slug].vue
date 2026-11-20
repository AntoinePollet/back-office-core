<script setup lang="ts">
const route = useRoute()
// Une ancienne adresse redirige d'elle-même vers la nouvelle.
const { data: article, error } = await useEntry('articles', () => route.params.slug as string)
if (error.value || !article.value) throw createError({ statusCode: 404, statusMessage: 'Actualité introuvable', fatal: true })
useCmsSeo(article)

const formatDate = (date: string) => new Date(date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
</script>

<template>
  <article v-if="article" class="space-y-4">
    <NuxtLink to="/actualites" class="link text-sm">Toutes les actualités</NuxtLink>
    <CmsImage :media="article.cover" sizes="(min-width: 56rem) 53rem, 100vw" loading="eager" class="w-full h-auto rounded-box" />
    <h1 class="text-4xl font-bold">{{ article.title }}</h1>
    <p v-if="article.date" class="text-sm opacity-60">{{ formatDate(article.date) }}</p>
    <p v-if="article.excerpt" class="text-lg opacity-70">{{ article.excerpt }}</p>
    <!-- Le texte mis en forme est nettoyé par le back-office à l'enregistrement : il peut être affiché tel quel. -->
    <div class="rich-text" v-html="article.body" />
  </article>
</template>
