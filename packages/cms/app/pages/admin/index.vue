<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'cms-auth' })

// L'accueil du back-office ouvre le premier contenu du menu.
const schema = await useCmsSchema()
const singleton = Object.keys(schema.value.singletons ?? {})[0]
const collection = Object.keys(schema.value.collections ?? {})[0]
await navigateTo(singleton ? `/admin/${singleton}` : `/admin/${collection}`, { replace: true })
</script>

<template>
  <div />
</template>
