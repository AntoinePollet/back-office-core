<script setup lang="ts">
// Page d'exemple : elle lit les contenus publiés depuis le back-office.
const { data: home } = await useSingleton('home')
const { data: services } = await useCollection('services')
// Le suffixe du titre (« — Cabinet Durand ») et l'image de partage par défaut viennent de cms.config.ts.
useCmsSeo(home)
</script>

<template>
  <main class="max-w-3xl mx-auto p-6 space-y-8">
    <nav class="flex items-center gap-4 text-sm">
      <span class="font-bold text-lg">Cabinet Durand</span>
      <NuxtLink to="/admin" class="link ml-auto">Back-office</NuxtLink>
    </nav>

    <section class="space-y-4">
      <CmsImage :media="home?.heroImage" sizes="(min-width: 48rem) 45rem, 100vw" loading="eager" class="w-full h-auto rounded-box" />
      <h1 class="text-4xl font-bold">{{ home?.heroTitle ?? 'Accueil pas encore publié' }}</h1>
      <p v-if="home?.heroText" class="opacity-70">{{ home.heroText }}</p>
      <a v-if="home?.cta" :href="home.cta.href" :target="home.cta.newTab ? '_blank' : undefined" class="btn btn-primary">{{ home.cta.label }}</a>
    </section>

    <section v-if="home?.gallery?.length" class="cms-gallery">
      <h2 class="text-xl font-bold mb-2">Le cabinet en images</h2>
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <figure v-for="photo in home.gallery" :key="photo.id" class="space-y-1">
          <CmsImage :media="photo" sizes="(min-width: 48rem) 15rem, 50vw" class="w-full aspect-[4/3] object-cover rounded-box" />
          <figcaption v-if="photo.caption" class="text-sm opacity-70">{{ photo.caption }}</figcaption>
        </figure>
      </div>
    </section>

    <section v-if="home?.featured?.length">
      <h2 class="text-xl font-bold mb-2">À la une</h2>
      <div class="flex flex-wrap gap-2">
        <NuxtLink v-for="s in home.featured" :key="s.id" :to="`/services/${s.slug}`" class="badge badge-accent badge-lg">{{ s.title }}</NuxtLink>
      </div>
    </section>

    <section>
      <h2 class="text-xl font-bold mb-2">Services</h2>
      <p v-if="!services?.length" class="opacity-70">Aucun service publié.</p>
      <div class="grid sm:grid-cols-2 gap-3">
        <NuxtLink v-for="s in services" :key="s.id" :to="s.path ?? '/'" class="card card-border bg-base-200 p-4">
          <div class="font-semibold">{{ s.title }}</div>
          <div class="text-sm opacity-70">
            <span v-if="s.category">{{ s.category.title }} · </span>
            <span v-if="s.onQuote">Sur devis</span>
            <span v-else-if="s.fromPrice != null">À partir de {{ s.fromPrice }} € HT</span>
          </div>
        </NuxtLink>
      </div>
    </section>

    <section v-if="home?.faq?.length">
      <h2 class="text-xl font-bold mb-2">Questions fréquentes</h2>
      <div v-for="(q, i) in home.faq" :key="i" class="collapse collapse-arrow bg-base-200 mb-2">
        <input type="checkbox">
        <div class="collapse-title font-medium">{{ q.question }}</div>
        <div class="collapse-content text-sm">{{ q.answer }} <a v-if="q.more" :href="q.more.href" class="link link-primary">{{ q.more.label }}</a></div>
      </div>
    </section>

    <!-- Module « Consentement » : le lien n'apparaît que si le module est actif. -->
    <footer class="text-sm opacity-70"><CmsConsentLink class="link" /></footer>
  </main>
</template>
