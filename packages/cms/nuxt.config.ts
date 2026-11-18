import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2026-01-01',

  modules: [
    'nitro-cloudflare-dev',
    fileURLToPath(new URL('./module.ts', import.meta.url)),
  ],

  // Le back-office est une application côté navigateur ; seul le site public est rendu sur le serveur.
  routeRules: {
    '/admin/**': { ssr: false },
  },

  runtimeConfig: {
    /** Secret des sessions. En production : variable NUXT_AUTH_SECRET. */
    authSecret: '',
    /** Clé d'API Brevo pour l'envoi d'e-mails par les workflows : variable NUXT_BREVO_API_KEY. */
    brevoApiKey: '',
    /** Adresse de l'API Brevo. Ne se change que pour les tests : NUXT_BREVO_API_URL. */
    brevoApiUrl: 'https://api.brevo.com/v3',
    /** Expéditeur des e-mails, validé dans Brevo : « Cabinet Durand <contact@cabinet-durand.fr> ». Variable NUXT_EMAIL_FROM. */
    emailFrom: '',
  },

  nitro: {
    preset: 'cloudflare_module',
  },

  vite: {
    plugins: [tailwindcss()],
  },
})
