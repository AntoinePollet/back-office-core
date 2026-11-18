import type { H3Event } from 'h3'
import {
  type AudiencePeriod, type AudienceStats, AudienceError,
  cloudflareAudienceRequest, cloudflareBeacon, cloudflareSettingsErrors, readCloudflareAudience,
} from '../../shared/analytics'
import type { AnalyticsProviderId } from '../../shared/modules'
import type { CmsModuleDefinition, ModuleSettingField, ModuleSettings } from '../utils/modules'

/**
 * Mesure d'audience (module `analytics`).
 *
 * Le module délègue tout ce qui dépend du fournisseur à un `AudienceProvider` : ses réglages, la balise
 * à insérer dans les pages du site, la lecture des statistiques. Ajouter un fournisseur, c'est écrire un objet
 * de plus dans `providers` (et l'ajouter à ANALYTICS_PROVIDERS dans shared/modules.ts).
 */
type AudienceProvider = {
  label: string
  description: string
  logo: CmsModuleDefinition['logo']
  settings: ModuleSettingField[]
  validate: (settings: ModuleSettings) => Record<string, string>
  /** Balise HTML à ajouter à la fin des pages du site, ou null si les réglages ne le permettent pas encore. */
  beacon: (settings: ModuleSettings) => string | null
  /** Statistiques d'une période se terminant aujourd'hui. Lève une `AudienceError` lisible en cas de refus ou de panne. */
  stats: (event: H3Event, settings: ModuleSettings, period: AudiencePeriod) => Promise<AudienceStats>
}

/** Adresse de l'API Cloudflare. Ne se change que pour les tests (variable NUXT_CLOUDFLARE_API_URL). */
const cloudflareApi = (event: H3Event) => String(useRuntimeConfig(event).cloudflareApiUrl).replace(/\/$/, '')

const cloudflare: AudienceProvider = {
  label: 'Mesure d\'audience',
  description: 'Fréquentation du site (visites, pages vues, pages les plus vues, sites d\'origine) dans l\'écran « Audience », par Cloudflare Web Analytics : sans cookie, donc sans bandeau de consentement.',
  // Logo officiel de Cloudflare et sa couleur (tracé : Simple Icons).
  logo: { style: 'fill', color: '#F38020', paths: ['M16.5088 16.8447c.1475-.5068.0908-.9707-.1553-1.3154-.2246-.3164-.6045-.499-1.0615-.5205l-8.6592-.1123a.1559.1559 0 0 1-.1333-.0713c-.0283-.042-.0351-.0986-.021-.1553.0278-.084.1123-.1484.2036-.1562l8.7359-.1123c1.0351-.0489 2.1601-.8868 2.5537-1.9136l.499-1.3013c.0215-.0561.0293-.1128.0147-.168-.5625-2.5463-2.835-4.4453-5.5499-4.4453-2.5039 0-4.6284 1.6177-5.3876 3.8614-.4927-.3658-1.1187-.5625-1.794-.499-1.2026.119-2.1665 1.083-2.2861 2.2856-.0283.31-.0069.6128.0635.894C1.5683 13.171 0 14.7754 0 16.752c0 .1748.0142.3515.0352.5273.0141.083.0844.1475.1689.1475h15.9814c.0909 0 .1758-.0645.2032-.1553l.12-.4268zm2.7568-5.5634c-.0771 0-.1611 0-.2383.0112-.0566 0-.1054.0415-.127.0976l-.3378 1.1744c-.1475.5068-.0918.9707.1543 1.3164.2256.3164.6055.498 1.0625.5195l1.8437.1133c.0557 0 .1055.0263.1329.0703.0283.043.0351.1074.0214.1562-.0283.084-.1132.1485-.204.1553l-1.921.1123c-1.041.0488-2.1582.8867-2.5527 1.914l-.1406.3585c-.0283.0713.0215.1416.0986.1416h6.5977c.0771 0 .1474-.0489.169-.126.1122-.4082.1757-.837.1757-1.2803 0-2.6025-2.125-4.727-4.7344-4.727'] },
  settings: [
    {
      key: 'siteToken', label: 'Jeton de la balise', type: 'text', required: true, placeholder: '32 lettres et chiffres',
      help: 'Tableau de bord Cloudflare → « Web Analytics » → « Ajouter un site » (ou « Gérer le site » s\'il existe déjà) : dans le code proposé, copiez la valeur qui suit "token": (sans les guillemets). La balise est ajoutée au site automatiquement.',
    },
    {
      key: 'siteTag', label: 'Identifiant du site', type: 'text', required: true, placeholder: '32 lettres et chiffres',
      help: 'Dans « Web Analytics », ouvrez les statistiques du site : l\'adresse de la page, dans le navigateur, contient « siteTag~in= » suivi de cet identifiant. Ce n\'est pas le même que le jeton de la balise.',
    },
    {
      key: 'accountId', label: 'Identifiant du compte', type: 'text', required: true, placeholder: '32 caractères',
      help: 'Page d\'accueil du tableau de bord Cloudflare : menu « ⋯ » à côté du nom du compte → « Copier l\'ID du compte » (Account ID). On le trouve aussi dans l\'adresse de la page : dash.cloudflare.com/<identifiant>/…',
    },
    {
      key: 'apiToken', label: 'Jeton d\'API (lecture des statistiques)', type: 'secret', required: true,
      help: 'Profil (en haut à droite) → « Jetons d\'API » → « Créer un jeton » → « Créer un jeton personnalisé » ; autorisation : Compte → « Account Analytics » → « Lecture » ; ressources du compte : ce compte. Ce jeton ne peut que lire des statistiques.',
    },
  ],
  validate: cloudflareSettingsErrors,
  beacon: settings => cloudflareBeacon(settings.siteToken),

  async stats(event, settings, period) {
    const response = await fetch(`${cloudflareApi(event)}/graphql`, {
      method: 'POST',
      headers: { 'authorization': `Bearer ${settings.apiToken ?? ''}`, 'content-type': 'application/json', 'accept': 'application/json' },
      body: JSON.stringify(cloudflareAudienceRequest({ accountId: settings.accountId ?? '', siteTag: settings.siteTag ?? '' }, period)),
      signal: AbortSignal.timeout(10_000),
    }).catch((error: Error) => {
      throw new AudienceError('unavailable', error.name === 'TimeoutError' ? 'Cloudflare n\'a pas répondu après 10 secondes.' : 'Cloudflare est injoignable pour le moment.')
    })
    const body = await response.json().catch(() => null)
    return readCloudflareAudience(response.status, body, period)
  },
}

const providers: Record<AnalyticsProviderId, AudienceProvider> = { cloudflare }

/** Le fournisseur choisi dans cms.config.ts (`analytics({ provider })`), Cloudflare par défaut. */
const provider = () => providers[moduleOptions<{ provider?: AnalyticsProviderId }>('analytics').provider ?? 'cloudflare'] ?? cloudflare

export const analyticsModule: CmsModuleDefinition = {
  id: 'analytics',
  get label() { return provider().label },
  get description() { return provider().description },
  get logo() { return provider().logo },
  get settings() { return provider().settings },
  adminPage: { to: '/admin/audience', label: 'Voir l\'audience' },
  affectsSite: true,
  validate: settings => provider().validate(settings),

  async test(event, settings) {
    const invalid = Object.values(provider().validate(settings))
    if (invalid.length) throw new Error(invalid.join(' '))
    const stats = await provider().stats(event, settings, 7)
    forgetAudience()
    if (!stats.totals.pageViews) return 'Connexion réussie. Aucune visite n\'est encore enregistrée : les premières apparaîtront quelques minutes après les premiers passages sur le site.'
    return `Connexion réussie : ${stats.totals.pageViews} page${stats.totals.pageViews > 1 ? 's' : ''} vue${stats.totals.pageViews > 1 ? 's' : ''} ces 7 derniers jours.`
  },
}

/** Statut de chaque réglage obligatoire : le module est-il prêt à mesurer et à lire ? */
const ready = (settings: ModuleSettings) =>
  provider().settings.every(s => !s.required || !!settings[s.key]) && !Object.keys(provider().validate(settings)).length

/** Balise à ajouter aux pages du site, ou null (module absent, réglage manquant ou invalide). */
export async function analyticsBeacon(event: H3Event) {
  if (!activeModule('analytics')) return null
  return provider().beacon(await moduleSettings(event, 'analytics'))
}

// ───────────── Statistiques, gardées quelques minutes ─────────────

/**
 * Les statistiques ne changent pas à la seconde : elles sont gardées cinq minutes en mémoire, pour ne pas appeler
 * l'API à chaque affichage. La mémoire d'un Worker est propre à chaque instance et peut être vidée à tout moment :
 * c'est une économie, pas une garantie. La clé contient les réglages : un jeton changé repart de zéro.
 */
const CACHE_MS = 5 * 60_000
const cache = new Map<string, { at: number; stats: AudienceStats }>()
const forgetAudience = () => cache.clear()

async function cacheKey(settings: ModuleSettings, period: AudiencePeriod) {
  const raw = JSON.stringify([provider().label, settings, period, new Date().toISOString().slice(0, 10)])
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export type AudienceAnswer =
  | { state: 'ok'; stats: AudienceStats; updatedAt: string }
  | { state: 'unconfigured' | 'refused' | 'unavailable'; message: string }

/** Ce que l'écran « Audience » affiche : les statistiques, ou pourquoi elles manquent. */
export async function readAudience(event: H3Event, period: AudiencePeriod): Promise<AudienceAnswer> {
  const settings = await moduleSettings(event, 'analytics')
  if (!ready(settings)) return { state: 'unconfigured', message: 'La mesure d\'audience n\'est pas encore réglée.' }
  const key = await cacheKey(settings, period)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return { state: 'ok', stats: hit.stats, updatedAt: new Date(hit.at).toISOString() }
  try {
    const stats = await provider().stats(event, settings, period)
    for (const [k, v] of cache) if (Date.now() - v.at >= CACHE_MS) cache.delete(k)
    const at = Date.now()
    cache.set(key, { at, stats })
    return { state: 'ok', stats, updatedAt: new Date(at).toISOString() }
  }
  catch (error) {
    if (error instanceof AudienceError) return { state: error.kind, message: error.message }
    console.error('[cms] audience : lecture impossible', error)
    return { state: 'unavailable', message: 'Les statistiques n\'ont pas pu être lues pour le moment.' }
  }
}

/** L'écran « Audience » est ouvert aux administrateurs et aux éditeurs. */
export const canReadAudience = (user: { role: string }) => user.role === 'admin' || user.role === 'editor'
