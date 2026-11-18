<script setup lang="ts">
// Gabarit commun aux pages du site : en-tête et pied de page.
// Les pages /admin ont leur propre gabarit, fourni par le core.
const { siteName } = useAppConfig()
const { data: settings } = await useSingleton('settings')
// Titre par défaut des pages ; une page qui appelle useCmsSeo ou useSeoMeta le remplace.
useHead({ title: siteName })
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <header class="navbar max-w-4xl w-full mx-auto px-6">
      <NuxtLink to="/" class="font-bold text-lg flex-1">{{ siteName }}</NuxtLink>
      <nav class="flex gap-4 text-sm">
        <NuxtLink to="/" class="link link-hover">Accueil</NuxtLink>
        <NuxtLink to="/actualites" class="link link-hover">Actualités</NuxtLink>
      </nav>
    </header>

    <main class="flex-1 max-w-4xl w-full mx-auto px-6 py-8">
      <slot />
    </main>

    <footer class="bg-base-200 text-sm">
      <div class="max-w-4xl mx-auto px-6 py-6 flex flex-wrap gap-x-8 gap-y-2">
        <span class="font-semibold">{{ siteName }}</span>
        <a v-if="settings?.phone" :href="`tel:${settings.phone}`" class="link link-hover">{{ settings.phone }}</a>
        <a v-if="settings?.email" :href="`mailto:${settings.email}`" class="link link-hover">{{ settings.email }}</a>
        <span v-if="settings?.address" class="whitespace-pre-line">{{ settings.address }}</span>
        <span v-if="settings?.footerText" class="basis-full opacity-70">{{ settings.footerText }}</span>
      </div>
    </footer>
  </div>
</template>
