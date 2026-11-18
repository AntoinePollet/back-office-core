/**
 * Mesure d'audience (module `analytics`) : la partie qui ne dépend ni du serveur ni du navigateur,
 * pour pouvoir la vérifier par des tests unitaires.
 *
 * - les statistiques telles que l'écran « Audience » les reçoit, quel que soit le fournisseur ;
 * - pour Cloudflare Web Analytics : validation des réglages, balise à insérer dans les pages,
 *   requête à l'API GraphQL Analytics et lecture de sa réponse.
 *
 * Un autre fournisseur (Plausible, Umami…) s'ajouterait à côté : ses réglages, sa balise, sa requête,
 * et la même forme de statistiques en sortie.
 */

/** Durées proposées dans l'écran « Audience », en jours. */
export const AUDIENCE_PERIODS = [7, 30] as const
export type AudiencePeriod = typeof AUDIENCE_PERIODS[number]

export type AudienceDay = { date: string; visits: number; pageViews: number }

/** Les statistiques d'une période, telles que l'écran les affiche. */
export type AudienceStats = {
  period: AudiencePeriod
  /** Premier et dernier jour couverts (AAAA-MM-JJ, en temps universel). */
  from: string
  to: string
  totals: { visits: number; pageViews: number }
  /** Un élément par jour de la période, y compris les jours sans visite. */
  days: AudienceDay[]
  /** Pages les plus vues : chemin (« /services/conseil ») et nombre de vues. */
  pages: { path: string; pageViews: number }[]
  /** Sites d'où viennent les visiteurs ; `host: null` : accès direct (adresse tapée, favori, application). */
  referrers: { host: string | null; visits: number }[]
}

/** Erreur lisible renvoyée par un fournisseur. `refused` : jeton ou identifiant refusé ; `unavailable` : panne, délai dépassé. */
export class AudienceError extends Error {
  constructor(public kind: 'refused' | 'unavailable', message: string) {
    super(message)
    this.name = 'AudienceError'
  }
}

const DAY = 86_400_000
const isoDay = (time: number) => new Date(time).toISOString().slice(0, 10)

/** Les jours d'une période qui se termine aujourd'hui (temps universel), du plus ancien au plus récent. */
export function periodDays(period: AudiencePeriod, now = Date.now()) {
  const today = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate())
  return Array.from({ length: period }, (_, i) => isoDay(today - (period - 1 - i) * DAY))
}

export const parsePeriod = (value: unknown): AudiencePeriod => (Number(value) === 30 ? 30 : 7)

// ───────────────────────── Cloudflare Web Analytics ─────────────────────────

/** Identifiant de compte Cloudflare : 32 caractères hexadécimaux. */
const ACCOUNT_ID = /^[a-f0-9]{32}$/i
/** Identifiant du site (« site tag ») et jeton de la balise (« token ») : lettres et chiffres seulement. */
const TAG = /^[a-z0-9]{16,64}$/i

/**
 * Vérifie les réglages saisis. Renvoie un message par réglage refusé, vide si tout est bon.
 * Un réglage absent n'est pas une erreur ici : c'est « À régler ».
 * Valider le jeton de la balise, c'est aussi garantir qu'il ne peut pas injecter de HTML dans les pages.
 */
export function cloudflareSettingsErrors(settings: Record<string, string | undefined>) {
  const errors: Record<string, string> = {}
  if (settings.siteToken && !TAG.test(settings.siteToken)) errors.siteToken = 'Jeton de la balise : uniquement des lettres et des chiffres (environ 32 caractères), sans guillemets.'
  if (settings.accountId && !ACCOUNT_ID.test(settings.accountId)) errors.accountId = 'Identifiant du compte : 32 caractères, chiffres et lettres de a à f.'
  if (settings.siteTag && !TAG.test(settings.siteTag)) errors.siteTag = 'Identifiant du site : uniquement des lettres et des chiffres (environ 32 caractères).'
  return errors
}

/** Adresse du script de mesure de Cloudflare. */
export const CLOUDFLARE_BEACON_SRC = 'https://static.cloudflareinsights.com/beacon.min.js'

/**
 * La balise à ajouter à la fin des pages du site, ou null si le jeton est absent ou invalide.
 * Le jeton est validé (lettres et chiffres) : rien d'autre que lui ne peut entrer dans le HTML.
 */
export function cloudflareBeacon(siteToken: string | undefined): string | null {
  if (!siteToken || !TAG.test(siteToken)) return null
  return `<script defer src="${CLOUDFLARE_BEACON_SRC}" data-cf-beacon='{"token":"${siteToken}"}'></script>`
}

/**
 * Requête GraphQL des statistiques d'une période : jeu de données des pages vues (`rumPageloadEventsAdaptiveGroups`),
 * filtré sur le site et sans les robots identifiés. Quatre regroupements en un seul appel : total, par jour,
 * par page, par site d'origine. `count` = pages vues ; `sum.visits` = visites (arrivées depuis un autre site ou en direct).
 */
export const CLOUDFLARE_AUDIENCE_QUERY = `query Audience($accountTag: string!, $siteTag: string!, $start: Time!, $end: Time!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      total: rumPageloadEventsAdaptiveGroups(limit: 1, filter: { siteTag: $siteTag, datetime_geq: $start, datetime_lt: $end, bot: 0 }) {
        count
        sum { visits }
      }
      days: rumPageloadEventsAdaptiveGroups(limit: 100, orderBy: [date_ASC], filter: { siteTag: $siteTag, datetime_geq: $start, datetime_lt: $end, bot: 0 }) {
        count
        sum { visits }
        dimensions { date }
      }
      pages: rumPageloadEventsAdaptiveGroups(limit: 10, orderBy: [count_DESC], filter: { siteTag: $siteTag, datetime_geq: $start, datetime_lt: $end, bot: 0 }) {
        count
        dimensions { requestPath }
      }
      referrers: rumPageloadEventsAdaptiveGroups(limit: 10, orderBy: [sum_visits_DESC], filter: { siteTag: $siteTag, datetime_geq: $start, datetime_lt: $end, bot: 0 }) {
        sum { visits }
        dimensions { refererHost }
      }
    }
  }
}`

/** Le corps de la requête à envoyer à l'API GraphQL de Cloudflare pour une période se terminant aujourd'hui. */
export function cloudflareAudienceRequest(settings: { accountId: string; siteTag: string }, period: AudiencePeriod, now = Date.now()) {
  const days = periodDays(period, now)
  const start = `${days[0]}T00:00:00Z`
  const end = new Date(Date.parse(`${days.at(-1)}T00:00:00Z`) + DAY).toISOString().replace('.000Z', 'Z')
  return {
    query: CLOUDFLARE_AUDIENCE_QUERY,
    variables: { accountTag: settings.accountId, siteTag: settings.siteTag, start, end },
  }
}

type Group = { count?: number; sum?: { visits?: number }; dimensions?: Record<string, string | null | undefined> }
type GraphqlResponse = {
  data?: { viewer?: { accounts?: { total?: Group[]; days?: Group[]; pages?: Group[]; referrers?: Group[] }[] } } | null
  errors?: { message?: string }[] | null
}

/** Une erreur de l'API GraphQL qui veut dire « jeton ou compte refusé », et non une panne. */
const REFUSED = /auth|token|permission|not authori[sz]ed|forbidden|access|account/i

/**
 * Lit la réponse de l'API GraphQL. Lève une `AudienceError` lisible si Cloudflare refuse la requête.
 * Les jours sans visite sont complétés par des zéros ; les pages et sites sans visite sont retirés.
 */
export function readCloudflareAudience(status: number, body: unknown, period: AudiencePeriod, now = Date.now()): AudienceStats {
  const json = (body && typeof body === 'object' ? body : {}) as GraphqlResponse
  const messages = (json.errors ?? []).map(e => String(e?.message ?? '')).filter(Boolean)
  if (status === 401 || status === 403 || (messages.length && messages.some(m => REFUSED.test(m)))) {
    throw new AudienceError('refused', 'Cloudflare refuse ce jeton d\'API ou cet identifiant de compte. Vérifiez que le jeton a le droit « Account Analytics : lecture » sur ce compte.')
  }
  if (status >= 400 || messages.length) {
    throw new AudienceError('unavailable', `Cloudflare n'a pas pu fournir les statistiques${messages.length ? ` : ${messages[0]!.slice(0, 200)}` : ` (erreur ${status})`}.`)
  }
  const account = json.data?.viewer?.accounts?.[0]
  if (!account) throw new AudienceError('refused', 'Ce compte Cloudflare est introuvable avec ce jeton d\'API : vérifiez l\'identifiant du compte.')

  const byDay = new Map((account.days ?? []).map(g => [String(g.dimensions?.date ?? ''), g]))
  const days = periodDays(period, now).map(date => ({ date, visits: byDay.get(date)?.sum?.visits ?? 0, pageViews: byDay.get(date)?.count ?? 0 }))
  const total = account.total?.[0]
  return {
    period,
    from: days[0]!.date,
    to: days.at(-1)!.date,
    totals: {
      visits: total?.sum?.visits ?? days.reduce((n, d) => n + d.visits, 0),
      pageViews: total?.count ?? days.reduce((n, d) => n + d.pageViews, 0),
    },
    days,
    pages: (account.pages ?? []).filter(g => (g.count ?? 0) > 0)
      .map(g => ({ path: String(g.dimensions?.requestPath || '/'), pageViews: g.count ?? 0 })),
    referrers: (account.referrers ?? []).filter(g => (g.sum?.visits ?? 0) > 0)
      .map(g => ({ host: g.dimensions?.refererHost || null, visits: g.sum?.visits ?? 0 })),
  }
}
