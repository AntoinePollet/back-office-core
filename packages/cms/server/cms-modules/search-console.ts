import type { H3Event } from 'h3'
import {
  SC_PERMISSIONS, type ScDimension, type ScFailure, type ScPeriod, type ScReport,
  readScRows, readScTotals, scDays, scFailure, scPagesByPath, scProperty, scQueryBody, scRange, searchConsoleReady, searchConsoleSettingsErrors,
} from '../../shared/search-console'
import type { CmsModuleDefinition, ModuleSettings } from '../utils/modules'
import { AdsError, accessToken, forgetAccessTokens } from './google-ads'

/**
 * Google Search Console, en lecture seule : ce que Google montre du site dans ses résultats, par recherche et par
 * page (voir `shared/search-console.ts`). Rien n'est modifié chez Google. La connexion est celle de Google Ads : un
 * client OAuth et un jeton d'actualisation, échangé contre un jeton d'accès gardé une heure en mémoire.
 */

class ScError extends Error {
  constructor(public failure: ScFailure) { super(failure.message) }
}

/** Adresse de l'API. Ne se change que pour les tests : NUXT_GOOGLE_SEARCH_CONSOLE_API_URL. */
const apiUrl = (event: H3Event) => String(useRuntimeConfig(event).googleSearchConsoleApiUrl).replace(/\/$/, '')

/** Un appel à l'API pour la propriété réglée. Un jeton d'accès refusé est redemandé une fois. */
async function call<T>(event: H3Event, settings: ModuleSettings, path: string, body?: unknown): Promise<T> {
  const site = encodeURIComponent(scProperty(settings.property))
  for (let attempt = 0; ; attempt++) {
    // Le jeton d'accès vient du service de connexion de Google : ses refus sont ceux de Google Ads, déjà traduits.
    const token = await accessToken(event, settings).catch((error) => { throw error instanceof AdsError ? new ScError(error.failure) : error })
    const response = await fetch(`${apiUrl(event)}/sites/${site}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'authorization': `Bearer ${token}`, 'accept': 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    }).catch((error: Error) => {
      throw new ScError({ kind: 'unavailable', message: error.name === 'TimeoutError' ? 'Search Console n\'a pas répondu après 15 secondes.' : 'Search Console est injoignable pour le moment.' })
    })
    const answer = await response.json().catch(() => null)
    if (response.ok) return answer as T
    if (response.status === 401 && attempt === 0) { forgetAccessTokens(); continue }
    throw new ScError(scFailure(response.status, answer))
  }
}

const analytics = (event: H3Event, settings: ModuleSettings, range: { from: string; to: string }, dimension: ScDimension | null) =>
  call<unknown>(event, settings, '/searchAnalytics/query', scQueryBody(range, dimension))

export const searchConsoleModule: CmsModuleDefinition = {
  id: 'search-console',
  category: 'seo',
  label: 'Google Search Console',
  // Logo de Google (tracé : Simple Icons) et son bleu.
  logo: { style: 'fill', color: '#4285F4', paths: ['M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z'] },
  description: 'Ce que Google montre du site dans ses résultats : les recherches qui y amènent des visiteurs, les clics, et la position de chaque page. Lecture seule.',
  settings: [
    {
      key: 'property', label: 'Propriété Search Console', type: 'text', required: true, placeholder: 'https://www.exemple.fr/',
      help: 'Telle qu\'elle est nommée dans Search Console (menu en haut à gauche) : « https://www.exemple.fr/ » pour une propriété « Préfixe de l\'URL », « sc-domain:exemple.fr » pour une propriété « Domaine ».',
    },
    {
      key: 'clientId', label: 'Identifiant client OAuth', type: 'text', required: true, placeholder: '….apps.googleusercontent.com',
      help: 'Console Google Cloud : activer « Google Search Console API » dans un projet, puis « Identifiants » → « Créer des identifiants » → « ID client OAuth ». Le client du module Google Ads convient.',
      env: { key: 'googleAdsClientId', name: 'NUXT_GOOGLE_ADS_CLIENT_ID' },
    },
    {
      key: 'clientSecret', label: 'Secret du client OAuth', type: 'secret', required: true,
      help: 'Affiché à la création de l\'ID client OAuth, puis dans sa fiche.',
      env: { key: 'googleAdsClientSecret', name: 'NUXT_GOOGLE_ADS_CLIENT_SECRET' },
    },
    {
      key: 'refreshToken', label: 'Jeton d\'actualisation', type: 'secret', required: true,
      help: 'Obtenu une fois, en se connectant avec un compte Google qui a accès à la propriété, pour l\'autorisation « https://www.googleapis.com/auth/webmasters.readonly » (voir le README du site). Un accès en lecture suffit.',
      env: { key: 'googleSearchConsoleRefreshToken', name: 'NUXT_GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN' },
    },
  ],
  adminPage: { to: '/admin/search-console', label: 'Voir les recherches' },
  validate: searchConsoleSettingsErrors,

  async test(event, settings) {
    const invalid = Object.values(searchConsoleSettingsErrors(settings))
    if (invalid.length) throw new Error(invalid.join(' '))
    forgetAccessTokens()
    cache.clear()
    const site = await call<{ siteUrl?: string; permissionLevel?: string } | null>(event, settings, '')
    const level = String(site?.permissionLevel ?? '')
    if (level === 'siteUnverifiedUser') throw new Error('Le compte Google qui a créé le jeton connaît cette propriété, mais elle n\'est pas validée : terminez la validation dans Search Console.')
    return `Connexion réussie à la propriété « ${scProperty(settings.property)} »${SC_PERMISSIONS[level] ? ` (${SC_PERMISSIONS[level]})` : ''}.`
  },
}

// ───────────── Rapport de l'écran « Recherche Google » ─────────────

/** Les chiffres de Google sont gardés cinq minutes en mémoire (voir la même réserve dans ./audience.ts). */
const CACHE_MS = 5 * 60_000
const cache = new Map<string, { at: number; from: string; to: string; report: ScReport }>()

export type SearchConsoleAnswer =
  | { state: 'ok'; property: string; days: ScPeriod; from: string; to: string; report: ScReport; updatedAt: string }
  | { state: 'unconfigured' | 'refused' | 'unavailable'; message: string }

async function digest(parts: unknown[]) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(parts)))
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Ce que l'écran « Recherche Google » affiche : le rapport, ou pourquoi il manque. */
export async function readSearchConsole(event: H3Event, days: ScPeriod): Promise<SearchConsoleAnswer> {
  const settings = await moduleSettings(event, 'search-console')
  if (!searchConsoleReady(settings)) return { state: 'unconfigured', message: 'Search Console n\'est pas encore réglé.' }
  try {
    const range = scRange(days)
    const key = await digest([settings, range])
    let hit = cache.get(key)
    if (!hit || Date.now() - hit.at >= CACHE_MS) {
      const [totals, byDay, queries, pages] = await Promise.all([
        analytics(event, settings, range, null),
        analytics(event, settings, range, 'date'),
        analytics(event, settings, range, 'query'),
        analytics(event, settings, range, 'page'),
      ])
      for (const [k, v] of cache) if (Date.now() - v.at >= CACHE_MS) cache.delete(k)
      hit = {
        at: Date.now(), ...range,
        report: { totals: readScTotals(totals), days: scDays(readScRows(byDay), range), queries: readScRows(queries), pages: scPagesByPath(readScRows(pages)) },
      }
      cache.set(key, hit)
    }
    return { state: 'ok', property: scProperty(settings.property), days, from: hit.from, to: hit.to, report: hit.report, updatedAt: new Date(hit.at).toISOString() }
  }
  catch (error) {
    if (error instanceof ScError) return { state: error.failure.kind, message: error.failure.message }
    console.error('[cms] search console : lecture impossible', error)
    return { state: 'unavailable', message: 'Les chiffres de Search Console n\'ont pas pu être lus pour le moment.' }
  }
}

/** Les chiffres de recherche sont ouverts aux administrateurs et aux éditeurs. */
export async function requireSearchConsoleAccess(event: H3Event) {
  await requireModule(event, 'search-console')
  const user = await requireUser(event)
  if (user.role !== 'admin' && user.role !== 'editor') throw createError({ statusCode: 403, message: 'Les chiffres de recherche sont réservés aux administrateurs et aux éditeurs.' })
  return user
}
