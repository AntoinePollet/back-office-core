<script setup lang="ts">
import { consentLocale, consentTexts } from '../../../shared/consent'

/**
 * Lien « Gérer mes cookies », à placer dans le pied de page du site : il rouvre le bandeau de consentement.
 * N'affiche rien tant que le module `consent` n'est pas actif. Le texte se change par le contenu du composant :
 * `<CmsConsentLink>Mes choix de confidentialité</CmsConsentLink>`.
 */
const consent = useCmsConsent()
const route = useRoute()
const label = computed(() => consentTexts(consent.config.value ? consentLocale(route.path, consent.config.value) : 'fr').manage)
</script>

<template>
  <button v-if="consent.active.value" type="button" data-cms-consent-link @click="consent.open()"><slot>{{ label }}</slot></button>
</template>
