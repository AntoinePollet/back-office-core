// Le site étend le core du back-office : il apporte /admin, l'API des contenus et les fonctions useCollection, useSingleton…
// Les contenus se décrivent dans cms.config.ts ; les pages du site sont dans app/pages.
export default defineNuxtConfig({
  extends: ['backoffice-core'],
  compatibilityDate: '2026-01-01',
  // Hébergement sur un serveur Node (Docker) : base SQLite et fichiers dans le dossier de données. Voir HEBERGEMENT.md.
  cms: { target: 'node' },
  css: ['~/assets/css/site.css'],
})
