import { type AudiencePeriod, type AudienceStats, AudienceError, periodDays } from './analytics'

/**
 * Google Analytics 4 (module `google-analytics`) : la partie qui ne dépend ni du serveur ni du navigateur.
 *
 * - validation des réglages ;
 * - la balise posée dans les pages : elle ne charge rien. Elle donne seulement l'identifiant de mesure au site, qui
 *   ne charge le script de Google qu'une fois l'accord du visiteur donné (Google Analytics dépose des cookies) ;
 * - la requête à l'API de données (`properties/<id>:batchRunReports`) et la lecture de sa réponse, dans la forme
 *   commune à l'écran « Audience » (voir `./analytics.ts`).
 */

/** Identifiant de mesure d'un flux web : « G-XXXXXXXXXX ». */
const MEASUREMENT_ID = /^G-[A-Z0-9]{4,20}$/
/** Identifiant de la propriété : des chiffres seulement (ce n'est pas l'identifiant de mesure). */
const PROPERTY_ID = /^\d{5,15}$/

/** Autorisation OAuth demandée : lecture seule des statistiques. */
export const GA_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly'
/** Nom de la balise `<meta>` qui porte l'identifiant de mesure dans la page. */
export const GA_META_NAME = 'cms-google-analytics'
/** Adresse du script de Google, chargé par le navigateur après l'accord du visiteur. */
export const GA_SCRIPT_SRC = 'https://www.googletagmanager.com/gtag/js'

/** Identifiant de mesure tel qu'il est utilisé : sans espace, en majuscules. */
export const gaMeasurementId = (value: string | undefined) => (value ?? '').trim().toUpperCase()
/** Identifiant de propriété : « properties/123456789 » et « 123 456 789 » sont acceptés. */
export const gaPropertyId = (value: string | undefined) => (value ?? '').trim().replace(/^properties\//, '').replace(/\s+/g, '')

/**
 * Vérifie les réglages saisis. Un réglage absent n'est pas une erreur ici : c'est « À régler ».
 * Valider l'identifiant de mesure, c'est aussi garantir qu'il ne peut pas injecter de HTML dans les pages.
 */
export function gaSettingsErrors(settings: Record<string, string | undefined>) {
  const errors: Record<string, string> = {}
  if (settings.measurementId?.trim() && !MEASUREMENT_ID.test(gaMeasurementId(settings.measurementId)))
    errors.measurementId = 'Identifiant de mesure : « G- » suivi de lettres et de chiffres, par exemple « G-AB12CD34EF ». Les identifiants « UA-… » de l\'ancien Google Analytics ne fonctionnent plus.'
  if (settings.propertyId?.trim() && !PROPERTY_ID.test(gaPropertyId(settings.propertyId)))
    errors.propertyId = 'Identifiant de la propriété : des chiffres seulement, par exemple « 123456789 ». Ce n\'est pas l\'identifiant de mesure « G-… ».'
  if (settings.clientId?.trim() && !/\.apps\.googleusercontent\.com$/.test(settings.clientId.trim()))
    errors.clientId = 'Identifiant client OAuth : il se termine par « .apps.googleusercontent.com ».'
  return errors
}

/** La balise peut être posée : l'identifiant de mesure est saisi et valide. */
export const gaCanMeasure = (settings: Record<string, string | undefined>) => MEASUREMENT_ID.test(gaMeasurementId(settings.measurementId))

/** Réglages complets et valides : le site mesure et le back-office lit les chiffres. */
export const gaReady = (settings: Record<string, string | undefined>) =>
  ['measurementId', 'propertyId', 'clientId', 'clientSecret', 'refreshToken'].every(k => !!settings[k]?.trim()) && !Object.keys(gaSettingsErrors(settings)).length

/** La balise ajoutée aux pages du site, ou null si l'identifiant de mesure est absent ou invalide. */
export function gaTag(measurementId: string | undefined): string | null {
  const id = gaMeasurementId(measurementId)
  return MEASUREMENT_ID.test(id) ? `<meta name="${GA_META_NAME}" content="${id}">` : null
}

/** Noms des cookies de Google Analytics à retirer quand le visiteur retire son accord. */
export function gaCookieNames(measurementId: string, present: string[]) {
  const stream = `_ga_${gaMeasurementId(measurementId).slice(2)}`
  return present.filter(name => name === '_ga' || name === stream || name === '_gid' || name.startsWith('_gat'))
}

// ───────────────────────── API de données ─────────────────────────

/**
 * Le corps de la requête `batchRunReports` pour une période se terminant aujourd'hui : quatre rapports en un appel
 * (total, par jour, par page, par source). `sessions` = visites, `screenPageViews` = pages vues.
 */
export function gaReportsBody(period: AudiencePeriod, now = Date.now()) {
  const days = periodDays(period, now)
  const base = { dateRanges: [{ startDate: days[0]!, endDate: days.at(-1)! }] }
  const metrics = (...names: string[]) => names.map(name => ({ name }))
  const top = (metric: string) => ({ orderBys: [{ metric: { metricName: metric }, desc: true }], limit: '10' })
  return {
    requests: [
      { ...base, metrics: metrics('sessions', 'screenPageViews') },
      { ...base, metrics: metrics('sessions', 'screenPageViews'), dimensions: [{ name: 'date' }], limit: '100' },
      { ...base, metrics: metrics('screenPageViews'), dimensions: [{ name: 'pagePath' }], ...top('screenPageViews') },
      { ...base, metrics: metrics('sessions'), dimensions: [{ name: 'sessionSource' }], ...top('sessions') },
    ],
  }
}

type Row = { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }
type Reports = { reports?: { rows?: Row[] }[]; error?: { code?: number; status?: string; message?: string } }

const metric = (row: Row | undefined, i: number) => Number(row?.metricValues?.[i]?.value ?? 0) || 0
const dimension = (row: Row) => String(row.dimensionValues?.[0]?.value ?? '')

/** Refus et pannes de Google, traduits. Renvoie toujours une erreur lisible. */
export function gaFailure(status: number, body: unknown): AudienceError {
  const raw = typeof body === 'string' ? body : JSON.stringify(body ?? '')
  const has = (text: string) => raw.includes(text)
  if (has('ACCESS_TOKEN_SCOPE_INSUFFICIENT') || has('insufficient authentication scopes'))
    return new AudienceError('refused', `Le jeton d'actualisation n'a pas l'autorisation de lire Google Analytics : créez-en un avec « ${GA_SCOPE} ».`)
  if (has('SERVICE_DISABLED') || has('has not been used') || has('accessNotConfigured'))
    return new AudienceError('refused', 'L\'API « Google Analytics Data API » n\'est pas activée dans le projet Google Cloud du client OAuth.')
  if (status === 401) return new AudienceError('refused', 'Google refuse le jeton d\'actualisation : créez-en un nouveau.')
  if (status === 403 || status === 404)
    return new AudienceError('refused', 'Le compte Google qui a créé le jeton n\'a pas accès à cette propriété Google Analytics, ou elle n\'existe pas. Vérifiez l\'identifiant de la propriété (des chiffres, dans Administration → Détails de la propriété) et les accès de la propriété.')
  if (status === 429 || has('RESOURCE_EXHAUSTED')) return new AudienceError('unavailable', 'Google limite le nombre de demandes : réessayez dans quelques minutes.')
  if (status >= 500) return new AudienceError('unavailable', 'Google Analytics ne répond pas pour le moment.')
  const message = String((body as Reports | null)?.error?.message ?? '').slice(0, 200)
  return new AudienceError('refused', `Google Analytics a refusé la demande (${status})${message ? ` : ${message}` : ''}.`)
}

/**
 * Lit la réponse de `batchRunReports`. Les jours sans visite sont complétés par des zéros. Les sources « (direct) »
 * et « (not set) » sont réunies en « accès direct ».
 */
export function readGaAudience(status: number, body: unknown, period: AudiencePeriod, now = Date.now()): AudienceStats {
  const json = (body && typeof body === 'object' ? body : {}) as Reports
  if (status >= 400 || json.error) throw gaFailure(status >= 400 ? status : Number(json.error?.code) || 400, body)
  const [total, byDay, pages, sources] = [0, 1, 2, 3].map(i => json.reports?.[i]?.rows ?? [])
  // Google écrit les dates « 20261126 ».
  const dayRows = new Map(byDay!.map(r => [dimension(r).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3'), r]))
  const days = periodDays(period, now).map(date => ({ date, visits: metric(dayRows.get(date), 0), pageViews: metric(dayRows.get(date), 1) }))

  const referrers = new Map<string | null, number>()
  for (const row of sources!) {
    const name = dimension(row)
    const host = !name || /^\((direct|not set)\)$/i.test(name) ? null : name
    referrers.set(host, (referrers.get(host) ?? 0) + metric(row, 0))
  }
  return {
    period,
    from: days[0]!.date,
    to: days.at(-1)!.date,
    totals: {
      visits: total![0] ? metric(total![0], 0) : days.reduce((n, d) => n + d.visits, 0),
      pageViews: total![0] ? metric(total![0], 1) : days.reduce((n, d) => n + d.pageViews, 0),
    },
    days,
    pages: pages!.filter(r => metric(r, 0) > 0).map(r => ({ path: dimension(r) || '/', pageViews: metric(r, 0) })),
    referrers: [...referrers].filter(([, visits]) => visits > 0).sort((a, b) => b[1] - a[1]).map(([host, visits]) => ({ host, visits })),
  }
}
