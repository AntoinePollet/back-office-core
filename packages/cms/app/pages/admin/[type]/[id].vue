<script setup lang="ts">
// Le formulaire est dans <CmsEntryEditor> : la page unique (/admin/<type>) l'affiche aussi.
definePageMeta({ layout: 'admin', middleware: 'cms-auth' })
</script>

<template>
  <CmsEntryEditor />
</template>
