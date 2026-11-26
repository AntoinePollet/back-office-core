import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'

// Version du core, lue dans son package.json : elle est affichée en bas du menu du back-office.
const { version } = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8')) as { version: string }

export default defineNuxtConfig({
  compatibilityDate: '2026-01-01',

  // Le module branche aussi l'hébergement (Cloudflare ou serveur Node) : voir `cms: { target }` dans module.ts.
  modules: [
    fileURLToPath(new URL('./module.ts', import.meta.url)),
  ],

  // Le back-office est une application côté navigateur ; seul le site public est rendu sur le serveur.
  routeRules: {
    '/admin/**': { ssr: false },
  },

  // Écran affiché pendant le démarrage du back-office, à la place d'une page blanche.
  spaLoadingTemplate: fileURLToPath(new URL('./app/spa-loading-template.html', import.meta.url)),

  runtimeConfig: {
    public: {
      /** Version du core installée dans ce projet. */
      cmsVersion: version,
      /** Réglages de référencement du site (`site.name`, `site.titleSuffix`, `site.shareImage` de cms.config.ts), remplis par le module. */
      cmsSeo: { siteName: '', titleSuffix: '', shareImage: '', defaultLocale: '' },
      /** Provenance des contacts (`site.attribution` de cms.config.ts), remplie par le module. */
      cmsAttribution: { enabled: true, rememberDays: 0 },
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
    /** Google Ads (module « google-ads ») : client OAuth et jeton communs à plusieurs sites, s'ils ne sont pas saisis dans le back-office. */
    googleAdsClientId: '',
    googleAdsClientSecret: '',
    googleAdsRefreshToken: '',
    googleAdsLoginCustomerId: '',
    /** Adresses de Google. Ne se changent que pour les tests : NUXT_GOOGLE_ADS_API_URL, NUXT_GOOGLE_OAUTH_TOKEN_URL. */
    googleAdsApiUrl: 'https://googleads.googleapis.com/v26',
    googleOauthTokenUrl: 'https://oauth2.googleapis.com/token',
    /** Data Manager API de Google (envoi des conversions). Ne se change que pour les tests : NUXT_GOOGLE_DATA_MANAGER_URL. */
    googleDataManagerUrl: 'https://datamanager.googleapis.com/v1',
    /** Search Console (module « search-console ») : jeton commun à plusieurs sites, s'il n'est pas saisi dans le back-office. */
    googleSearchConsoleRefreshToken: '',
    /** Adresse de l'API Search Console. Ne se change que pour les tests : NUXT_GOOGLE_SEARCH_CONSOLE_API_URL. */
    googleSearchConsoleApiUrl: 'https://www.googleapis.com/webmasters/v3',
    /** Avis Google (module « google-business ») : clé d'API Google Maps commune à plusieurs sites, si elle n'est pas saisie dans le back-office. */
    googlePlacesApiKey: '',
    /** Adresse de l'API Places. Ne se change que pour les tests : NUXT_GOOGLE_PLACES_API_URL. */
    googlePlacesApiUrl: 'https://places.googleapis.com/v1',
    /** Assistant de rédaction (module « assistant ») : clé d'API Anthropic, si elle n'est pas saisie dans le back-office. Variable NUXT_ANTHROPIC_API_KEY. */
    anthropicApiKey: '',
    /** Adresse de l'API d'Anthropic. Ne se change que pour les tests : NUXT_ANTHROPIC_API_URL. Vide : celle du SDK. */
    anthropicApiUrl: '',
    /** Suivi des erreurs (module « monitoring ») : adresse Sentry (DSN) commune, si elle n'est pas saisie dans le back-office. Variable NUXT_SENTRY_DSN. */
    sentryDsn: '',
    /** Adresse de Sentry, à la place de l'hôte du DSN. Ne se change que pour les tests : NUXT_SENTRY_URL. */
    sentryUrl: '',
    /** Nombre de jours pendant lesquels une sauvegarde est conservée : variable NUXT_BACKUP_RETENTION_DAYS. */
    backupRetentionDays: 30,
    /** Adresse de l'API Turnstile (vérification Siteverify). Ne se change que pour les tests : NUXT_TURNSTILE_API_URL. */
    turnstileApiUrl: 'https://challenges.cloudflare.com/turnstile/v0',
    /** Avis de nouvelle version du core, pour les administrateurs. Pour le désactiver : false ici, ou NUXT_CMS_UPDATE_CHECK=false. */
    cmsUpdateCheck: true,
    /** Adresse interrogée (une fois par jour au plus) pour connaître la dernière version du core. Ne se change que pour les tests : NUXT_CMS_UPDATE_URL. */
    cmsUpdateUrl: 'https://api.github.com/repos/AntoinePollet/back-office-core/releases/latest',

    // ───── Serveur Node seulement (`cms: { target: 'node' }`) ; sans effet chez Cloudflare. ─────
    /** Dossier des données à conserver (base SQLite, fichiers de la médiathèque) : variable NUXT_DATA_DIR. */
    dataDir: '.data',
    /** Stockage compatible S3 pour la médiathèque, à la place du disque : NUXT_S3_ENDPOINT et NUXT_S3_BUCKET, avec les clés d'accès. */
    s3Endpoint: '',
    s3Bucket: '',
    /** Bucket à part pour les sauvegardes (facultatif) : NUXT_S3_BACKUP_BUCKET. */
    s3BackupBucket: '',
    /** Région attendue par le service S3 : NUXT_S3_REGION. */
    s3Region: 'us-east-1',
    s3AccessKeyId: '',
    s3SecretAccessKey: '',
    /** Le site est derrière un serveur frontal (Caddy, Nginx…) qui transmet l'adresse du visiteur : NUXT_TRUST_PROXY=true. */
    trustProxy: false,
  },

  vite: {
    plugins: [tailwindcss()],
  },
})
