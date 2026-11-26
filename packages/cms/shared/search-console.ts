/**
 * Google Search Console, en lecture : ce que Google montre du site dans ses résultats (affichages, clics, taux de
 * clic, position moyenne), par recherche et par page.
 *
 * Ce fichier porte la logique pure, sans Nuxt : réglages, période, corps des requêtes, lecture des réponses de l'API
 * (`searchAnalytics/query`), messages d'erreur, rapprochement des adresses de Google avec les pages du site. Les
 * appels eux-mêmes sont dans `server/cms-modules/search-console.ts`.
 *
 * Accès à l'API : le même genre de client OAuth que pour Google Ads, avec un jeton d'actualisation qui porte
 * l'autorisation `https://www.googleapis.com/auth/webmasters.readonly`, créé par une personne qui a accès à la
 * propriété dans Search Console.
 */
import { dayIn } from './google-ads'

type Settings = Record<string, string | undefined>
type Obj = Record<string, any>

export const SEARCH_CONSOLE_PERIODS = [7, 28, 90] as const
export type ScPeriod = typeof SEARCH_CONSOLE_PERIODS[number]
export const parseScPeriod = (value: unknown): ScPeriod => (SEARCH_CONSOLE_PERIODS.find(p => String(p) === String(value)) ?? 28)

/** Google publie ses chiffres avec deux à trois jours de retard : la période s'arrête avant-hier. */
export const SEARCH_CONSOLE_LAG_DAYS = 2
/** Les jours de Search Console sont ceux de la côte ouest des États-Unis. */
const GOOGLE_TIME_ZONE = 'America/Los_Angeles'
const DAY_MS = 86_400_000

/**
 * Une propriété Search Console telle que l'API l'attend : « https://www.exemple.fr/ » (préfixe d'URL, avec sa barre
 * finale) ou « sc-domain:exemple.fr » (domaine entier). Vide si ce n'en est pas une.
 */
export function scProperty(value: unknown): string {
  const text = String(value ?? '').trim()
  if (!text) return ''
  const domain = /^sc-domain:(.+)$/i.exec(text)
  if (domain) {
    const host = domain[1]!.trim().toLowerCase()
    return /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(host) ? `sc-domain:${host}` : ''
  }
  if (!/^https?:\/\//i.test(text)) return ''
  try {
    const url = new URL(text)
    if (url.search || url.hash || url.username || url.password) return ''
    // Un préfixe d'URL se termine par une barre : c'est ainsi que Search Console le nomme.
    return url.href.endsWith('/') ? url.href : `${url.href}/`
  }
  catch { return '' }
}

/** Réglages refusés à l'enregistrement : clé du réglage → message. */
export function searchConsoleSettingsErrors(settings: Settings): Record<string, string> {
  const errors: Record<string, string> = {}
  if (settings.property && !scProperty(settings.property)) errors.property = 'La propriété s\'écrit comme dans Search Console : « https://www.exemple.fr/ » ou « sc-domain:exemple.fr ».'
  if (settings.clientId && !/\.apps\.googleusercontent\.com$/.test(settings.clientId.trim())) errors.clientId = 'L\'identifiant client OAuth se termine par « .apps.googleusercontent.com ».'
  return errors
}

export const searchConsoleReady = (settings: Settings) =>
  !!settings.clientId && !!settings.clientSecret && !!settings.refreshToken && !!scProperty(settings.property) && !Object.keys(searchConsoleSettingsErrors(settings)).length

// ───────────────────────── Période et requêtes ─────────────────────────

/** Les `days` derniers jours publiés par Google : premier et dernier jour (AAAA-MM-JJ). */
export function scRange(days: ScPeriod, now = Date.now()) {
  const last = now - SEARCH_CONSOLE_LAG_DAYS * DAY_MS
  return { from: dayIn(GOOGLE_TIME_ZONE, last - (days - 1) * DAY_MS), to: dayIn(GOOGLE_TIME_ZONE, last) }
}

export type ScDimension = 'query' | 'page' | 'date'
/** Lignes demandées : les recherches montrées à l'écran, toutes les pages (pour « Pages et titres »), un point par jour. */
export const SC_ROW_LIMITS: Record<ScDimension, number> = { query: 50, page: 1000, date: 100 }

/** Corps d'une demande `searchAnalytics/query` : les totaux (sans regroupement), ou un regroupement. */
export function scQueryBody(range: { from: string; to: string }, dimension: ScDimension | null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(range.from) || !/^\d{4}-\d{2}-\d{2}$/.test(range.to)) throw new Error('Dates attendues au format AAAA-MM-JJ.')
  return { startDate: range.from, endDate: range.to, type: 'web', ...(dimension ? { dimensions: [dimension], rowLimit: SC_ROW_LIMITS[dimension] } : {}) }
}

// ───────────────────────── Lecture des réponses ─────────────────────────

export type ScMetrics = {
  clicks: number
  impressions: number
  /** Part des affichages suivis d'un clic, de 0 à 1. */
  ctr: number
  /** Position moyenne dans les résultats (1 : premier résultat) ; 0 sans affichage. */
  position: number
}
export type ScRow = ScMetrics & { key: string }
export const SC_EMPTY: ScMetrics = { clicks: 0, impressions: 0, ctr: 0, position: 0 }

const num = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0)

/** Les lignes d'une réponse, avec leur clé (la recherche, l'adresse de la page ou le jour). */
export function readScRows(body: unknown): ScRow[] {
  const rows = (body as Obj | null)?.rows
  if (!Array.isArray(rows)) return []
  return rows.map((r: Obj) => ({ key: String(r?.keys?.[0] ?? ''), clicks: num(r?.clicks), impressions: num(r?.impressions), ctr: num(r?.ctr), position: num(r?.position) }))
}

/** Les totaux de la période : l'unique ligne d'une demande sans regroupement. */
export const readScTotals = (body: unknown): ScMetrics => {
  const [row] = readScRows(body)
  return row ? { clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position } : { ...SC_EMPTY }
}

/** Additionne des lignes : la position est pondérée par les affichages, le taux de clic recalculé. */
export function sumScMetrics(rows: ScMetrics[]): ScMetrics {
  const clicks = rows.reduce((n, r) => n + r.clicks, 0)
  const impressions = rows.reduce((n, r) => n + r.impressions, 0)
  const weighted = rows.reduce((n, r) => n + r.position * r.impressions, 0)
  return { clicks, impressions, ctr: impressions ? clicks / impressions : 0, position: impressions ? weighted / impressions : 0 }
}

/**
 * Adresse d'une page chez Google → adresse dans le site (« /services/droit-des-affaires »), sans paramètres, sans
 * barre finale (sauf l'accueil). Null si ce n'est pas une adresse lisible.
 */
export function scPagePath(url: string): string | null {
  try {
    const path = decodeURI(new URL(url).pathname)
    return path.length > 1 ? path.replace(/\/+$/, '') || '/' : '/'
  }
  catch { return null }
}

/**
 * Les pages de Google regroupées par adresse du site : « http » et « https », avec ou sans « www », avec ou sans
 * barre finale ou paramètres sont la même page pour le site. Triées par nombre de clics, puis d'affichages.
 */
export function scPagesByPath(rows: ScRow[]): (ScMetrics & { path: string })[] {
  const groups = new Map<string, ScRow[]>()
  for (const row of rows) {
    const path = scPagePath(row.key)
    if (path) groups.set(path, [...(groups.get(path) ?? []), row])
  }
  return [...groups].map(([path, list]) => ({ path, ...sumScMetrics(list) }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions || a.path.localeCompare(b.path))
}

/** Un point par jour de la période, y compris les jours sans affichage (Google ne les renvoie pas). */
export function scDays(rows: ScRow[], range: { from: string; to: string }): { date: string; clicks: number; impressions: number }[] {
  const byDay = new Map(rows.map(r => [r.key, r]))
  const out: { date: string; clicks: number; impressions: number }[] = []
  const end = Date.parse(`${range.to}T12:00:00Z`)
  for (let at = Date.parse(`${range.from}T12:00:00Z`); at <= end && out.length < 400; at += DAY_MS) {
    const date = new Date(at).toISOString().slice(0, 10)
    out.push({ date, clicks: byDay.get(date)?.clicks ?? 0, impressions: byDay.get(date)?.impressions ?? 0 })
  }
  return out
}

export type ScReport = {
  totals: ScMetrics
  days: { date: string; clicks: number; impressions: number }[]
  /** Les recherches qui amènent le plus de clics. */
  queries: ScRow[]
  /** Toutes les pages vues par Google, par adresse du site. */
  pages: (ScMetrics & { path: string })[]
}

// ───────────────────────── Refus ─────────────────────────

export type ScFailure = { kind: 'refused' | 'unavailable'; message: string }

/** Niveaux d'accès à une propriété, tels que l'API les nomme. */
export const SC_PERMISSIONS: Record<string, string> = {
  siteOwner: 'propriétaire',
  siteFullUser: 'accès complet',
  siteRestrictedUser: 'accès restreint',
}

/** Refus de l'API Search Console, traduit pour la personne qui règle le module. */
export function scFailure(status: number, body: unknown): ScFailure {
  const raw = typeof body === 'string' ? body : JSON.stringify(body ?? '')
  const has = (text: string) => raw.includes(text)
  if (has('ACCESS_TOKEN_SCOPE_INSUFFICIENT') || has('insufficient authentication scopes') || has('insufficientPermissions')) {
    return { kind: 'refused', message: 'Le jeton d\'actualisation n\'a pas l\'autorisation de lire Search Console : créez-en un avec « https://www.googleapis.com/auth/webmasters.readonly ».' }
  }
  if (has('SERVICE_DISABLED') || has('has not been used') || has('accessNotConfigured')) return { kind: 'refused', message: 'L\'API « Google Search Console API » n\'est pas activée dans le projet Google Cloud du client OAuth.' }
  if (status === 401) return { kind: 'refused', message: 'Google refuse le jeton d\'actualisation : créez-en un nouveau.' }
  if (status === 403 || status === 404) {
    return { kind: 'refused', message: 'Le compte Google qui a créé le jeton n\'a pas accès à cette propriété Search Console, ou elle n\'existe pas sous ce nom. Vérifiez son écriture (« https://www.exemple.fr/ » avec la barre finale, ou « sc-domain:exemple.fr ») et les utilisateurs de la propriété.' }
  }
  if (status === 429 || has('quotaExceeded') || has('rateLimitExceeded')) return { kind: 'unavailable', message: 'Google limite le nombre de demandes : réessayez dans quelques minutes.' }
  if (status >= 500) return { kind: 'unavailable', message: 'Search Console ne répond pas pour le moment.' }
  const message = String((body as Obj | null)?.error?.message ?? '').slice(0, 200)
  return { kind: 'refused', message: `Search Console a refusé la demande (${status})${message ? ` : ${message}` : ''}.` }
}

// ───────────────────────── Affichage ─────────────────────────

/** « 4,2 % ». */
export const formatCtr = (ctr: number) => `${(ctr * 100).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`
/** Position moyenne, à une décimale ; « — » sans affichage. */
export const formatPosition = (position: number) => (position > 0 ? position.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—')
