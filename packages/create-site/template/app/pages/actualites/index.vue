<script setup lang="ts">
// Liste des actualités publiées, dans l'ordre réglé dans cms.config.ts (les plus récentes d'abord).
const { siteName } = useAppConfig()
const { data: articles } = await useCollection('articles')
useSeoMeta({ title: `Actualités — ${siteName}` })

const formatDate = (date: string) => new Date(date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-4xl font-bold">Actualités</h1>
    <p v-if="!articles?.length" class="opacity-70">Aucune actualité publiée pour le moment.</p>
    <div class="space-y-4">
      <NuxtLink v-for="article in articles" :key="article.id" :to="article.path ?? '/actualites'" class="card card-side card-border bg-base-100 hover:bg-base-200">
        <figure v-if="article.cover" class="w-40 shrink-0">
          <CmsImage :media="article.cover" sizes="10rem" :max-width="320" class="w-full h-full object-cover" />
        </figure>
        <div class="card-body">
          <h2 class="card-title">{{ article.title }}</h2>
          <p v-if="article.date" class="text-xs opacity-60">{{ formatDate(article.date) }}</p>
          <p v-if="article.excerpt" class="text-sm opacity-70">{{ article.excerpt }}</p>
        </div>
      </NuxtLink>
    </div>
  </div>
</template>
