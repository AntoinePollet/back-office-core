import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'

// Version du core, lue dans son package.json : elle est affichée en bas du menu du back-office.
const { version } = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8')) as { version: string }

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
    public: {
      /** Version du core installée dans ce projet. */
      cmsVersion: version,
      /** Réglages de référencement du site (`site.name`, `site.titleSuffix`, `site.shareImage` de cms.config.ts), remplis par le module. */
      cmsSeo: { siteName: '', titleSuffix: '', shareImage: '' },
      /** Script de Cloudflare Turnstile (module « turnstile »). Ne se change que pour les tests : NUXT_PUBLIC_TURNSTILE_SCRIPT_URL. */
      turnstileScriptUrl: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
    },
    /** Secret des sessions. En production : variable NUXT_AUTH_SECRET. */
    authSecret: '',
    /** Clé d'API Brevo pour l'envoi d'e-mails par les workflows : variable NUXT_BREVO_API_KEY. */
    brevoApiKey: '',
    /** Adresse de l'API Brevo. Ne se change que pour les tests : NUXT_BREVO_API_URL. */
    brevoApiUrl: 'https://api.brevo.com/v3',
    /** Clé d'API Resend (module « resend ») : variable NUXT_RESEND_API_KEY. */
    resendApiKey: '',
    /** Adresse de l'API Resend. Ne se change que pour les tests : NUXT_RESEND_API_URL. */
    resendApiUrl: 'https://api.resend.com',
    /** Adresse de l'API Stripe. Ne se change que pour les tests : NUXT_STRIPE_API_URL. */
    stripeApiUrl: 'https://api.stripe.com',
    /** Expéditeur des e-mails, validé dans Brevo ou Resend : « Cabinet Durand <contact@cabinet-durand.fr> ». Variable NUXT_EMAIL_FROM. */
    emailFrom: '',
    /** Adresse de l'API Cloudflare (statistiques du module « analytics »). Ne se change que pour les tests : NUXT_CLOUDFLARE_API_URL. */
    cloudflareApiUrl: 'https://api.cloudflare.com/client/v4',
    /** Adresse de l'API de statistiques de Plausible. Ne se change que pour les tests : NUXT_PLAUSIBLE_API_URL. Vide : l'adresse réglée dans le module. */
    plausibleApiUrl: '',
    /** Nombre de jours pendant lesquels une sauvegarde est conservée : variable NUXT_BACKUP_RETENTION_DAYS. */
    backupRetentionDays: 30,
    /** Adresse de l'API Turnstile (vérification Siteverify). Ne se change que pour les tests : NUXT_TURNSTILE_API_URL. */
    turnstileApiUrl: 'https://challenges.cloudflare.com/turnstile/v0',
    /** Avis de nouvelle version du core, pour les administrateurs. Pour le désactiver : false ici, ou NUXT_CMS_UPDATE_CHECK=false. */
    cmsUpdateCheck: true,
    /** Adresse interrogée (une fois par jour au plus) pour connaître la dernière version du core. Ne se change que pour les tests : NUXT_CMS_UPDATE_URL. */
    cmsUpdateUrl: 'https://api.github.com/repos/AntoinePollet/back-office-core/releases/latest',
  },

  nitro: {
    preset: 'cloudflare_module',
  },

  vite: {
    plugins: [tailwindcss()],
  },
})
