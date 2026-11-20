<script setup lang="ts">
// Page d'accueil : elle lit les contenus publiés depuis le back-office.
// Les champs sont typés d'après cms.config.ts : l'éditeur propose `home.heroTitle`, `article.cover`…
const { siteName } = useAppConfig()
const { data: home } = await useSingleton('home')
const { data: latest } = await useCollectionPage('articles', { limit: 3 })
// Le titre est complété par `site.titleSuffix` (cms.config.ts), comme dans l'aperçu de l'onglet Référencement.
useCmsSeo(home)
</script>

<template>
  <div class="space-y-12">
    <section class="space-y-4">
      <CmsImage :media="home?.heroImage" sizes="(min-width: 56rem) 53rem, 100vw" loading="eager" class="w-full h-auto rounded-box" />
      <h1 class="text-4xl font-bold">{{ home?.heroTitle ?? siteName }}</h1>
      <p v-if="home?.heroText" class="text-lg opacity-70">{{ home.heroText }}</p>
      <a v-if="home?.cta" :href="home.cta.href" :target="home.cta.newTab ? '_blank' : undefined" class="btn btn-primary">{{ home.cta.label }}</a>
      <div v-if="!home" role="alert" class="alert">
        <span>La page d'accueil n'est pas encore publiée. <NuxtLink to="/admin" class="link">Ouvrir le back-office</NuxtLink></span>
      </div>
    </section>

    <section v-if="home?.highlights?.length" class="grid sm:grid-cols-3 gap-4">
      <div v-for="(item, i) in home.highlights" :key="i" class="card card-border bg-base-100">
        <div class="card-body">
          <h2 class="card-title">{{ item.title }}</h2>
          <p class="text-sm opacity-70">{{ item.text }}</p>
        </div>
      </div>
    </section>

    <section v-if="latest?.items.length" class="space-y-4">
      <div class="flex items-baseline">
        <h2 class="text-2xl font-bold flex-1">Actualités</h2>
        <NuxtLink to="/actualites" class="link text-sm">Toutes les actualités</NuxtLink>
      </div>
      <div class="grid sm:grid-cols-3 gap-4">
        <NuxtLink v-for="article in latest.items" :key="article.id" :to="article.path ?? '/actualites'" class="card card-border bg-base-100 hover:bg-base-200">
          <figure v-if="article.cover">
            <CmsImage :media="article.cover" sizes="(min-width: 40rem) 17rem, 100vw" :max-width="640" class="w-full h-36 object-cover" />
          </figure>
          <div class="card-body">
            <h3 class="card-title text-base">{{ article.title }}</h3>
            <p v-if="article.excerpt" class="text-sm opacity-70">{{ article.excerpt }}</p>
          </div>
        </NuxtLink>
      </div>
    </section>
  </div>
</template>
