// Exemple de site client : il étend le core et fournit son cms.config.ts.
export default defineNuxtConfig({
  extends: ['backoffice-core'],
  compatibilityDate: '2026-01-01',
  css: ['~/assets/css/site.css'],
})
