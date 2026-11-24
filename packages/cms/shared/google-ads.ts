/**
 * Google Ads, en lecture : ce que coûtent les campagnes (impressions, clics, dépense, conversions vues par Google),
 * rapproché des contacts que le site a lui-même enregistrés (messages et paiements venus d'une annonce, voir
 * `shared/attribution.ts`). D'où le coût par contact, campagne par campagne.
 *
 * Ce fichier porte la logique pure, sans Nuxt : réglages, requêtes (GAQL), lecture des réponses de l'API REST de
 * Google Ads, messages d'erreur, rapprochement. Les appels eux-mêmes sont dans `server/cms-modules/google-ads.ts`.
 *
 * Accès à l'API (état de la documentation de Google en novembre 2026) : un projet Google Cloud où l'API Google Ads
 * est activée, avec au moins le niveau d'accès « Explorer » pour lire un vrai compte, et un client OAuth dont le
 * jeton d'actualisation appartient à une personne qui a accès au compte. Il n'y a plus de « jeton développeur ».
 */
import type { StoredOrigin } from './attribution'

type Settings = Record<string, string | undefined>
type Obj = Record<string, any>

/** Version de l'API REST de Google Ads visée. Chaque version vit environ un an : voir le calendrier de Google. */
export const GOOGLE_ADS_API_VERSION = 'v26'
export const GOOGLE_ADS_PERIODS = [7, 30, 90] as const
export type AdsPeriod = typeof GOOGLE_ADS_PERIODS[number]
export const parseAdsPeriod = (value: unknown): AdsPeriod => (GOOGLE_ADS_PERIODS.find(p => String(p) === String(value)) ?? 30)

/** Numéro de compte sans tirets ni espaces (« 123-456-7890 » → « 1234567890 ») ; vide s'il n'a pas dix chiffres. */
export const adsCustomerId = (value: unknown) => {
  const digits = String(value ?? '').replace(/[\s-]/g, '')
  return /^\d{10}$/.test(digits) ? digits : ''
}

/** Réglages refusés à l'enregistrement : clé du réglage → message. */
export function googleAdsSettingsErrors(settings: Settings): Record<string, string> {
  const errors: Record<string, string> = {}
  if (settings.customerId && !adsCustomerId(settings.customerId)) errors.customerId = 'Le numéro de compte Google Ads a dix chiffres : 123-456-7890.'
  if (settings.loginCustomerId && !adsCustomerId(settings.loginCustomerId)) errors.loginCustomerId = 'Le numéro du compte administrateur a dix chiffres : 123-456-7890.'
  if (settings.clientId && !/\.apps\.googleusercontent\.com$/.test(settings.clientId.trim())) errors.clientId = 'L\'identifiant client OAuth se termine par « .apps.googleusercontent.com ».'
  return errors
}

export const googleAdsReady = (settings: Settings) =>
  !!settings.clientId && !!settings.clientSecret && !!settings.refreshToken && !!adsCustomerId(settings.customerId) && !Object.keys(googleAdsSettingsErrors(settings)).length

// ───────────────────────── Période et requêtes ─────────────────────────

/** Jour (AAAA-MM-JJ) d'un instant dans un fuseau horaire. Fuseau inconnu : UTC. */
export function dayIn(timeZone: string | undefined, at: number | Date): string {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at) }
  catch { return new Date(at).toISOString().slice(0, 10) }
}

/** Les `days` derniers jours, aujourd'hui compris, dans un fuseau horaire : premier et dernier jour (AAAA-MM-JJ). */
export function adsRange(days: AdsPeriod, timeZone: string | undefined, now = Date.now()) {
  return { from: dayIn(timeZone, now - (days - 1) * 86_400_000), to: dayIn(timeZone, now) }
}

export const ADS_ACCOUNT_QUERY = 'SELECT customer.descriptive_name, customer.currency_code, customer.time_zone FROM customer LIMIT 1'

const DAY = /^\d{4}-\d{2}-\d{2}$/
/** Une ligne par campagne, cumulée sur la période (pas de découpage par jour). */
export function adsCampaignQuery(from: string, to: string) {
  if (!DAY.test(from) || !DAY.test(to)) throw new Error('Dates attendues au format AAAA-MM-JJ.')
  return 'SELECT campaign.id, campaign.name, campaign.status, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions '
    + `FROM campaign WHERE segments.date BETWEEN '${from}' AND '${to}'`
}

/** Un identifiant de clic (`gclid`) tel que Google les écrit : lettres, chiffres, tiret, souligné. */
export const isGclid = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{10,200}$/.test(value)

/**
 * La campagne d'un clic, retrouvée par son `gclid`. Google exige un seul jour par requête, et ne garde les clics que
 * 90 jours. Null si l'identifiant ou le jour ne sont pas utilisables.
 */
export function adsClickQuery(gclid: string, day: string) {
  if (!isGclid(gclid) || !DAY.test(day)) return null
  return `SELECT click_view.gclid, campaign.id, campaign.name FROM click_view WHERE segments.date = '${day}' AND click_view.gclid = '${gclid}'`
}
/** Durée pendant laquelle Google garde le détail d'un clic. */
export const ADS_CLICK_LOOKBACK_DAYS = 90

// ───────────────────────── Lecture des réponses ─────────────────────────

export type AdsAccount = { name: string; currency: string; timeZone: string }
export type AdsCampaign = {
  id: string
  name: string
  /** ENABLED, PAUSED ou REMOVED. */
  status: string
  impressions: number
  clicks: number
  /** Dépense en millionièmes de la devise du compte (1 € = 1 000 000). */
  costMicros: number
  /** Conversions comptées par Google (selon les actions de conversion réglées dans le compte). */
  conversions: number
}

const num = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0)
const rowsOf = (body: unknown): Obj[] => (Array.isArray((body as Obj | null)?.results) ? (body as Obj).results : [])

export function readAdsAccount(body: unknown): AdsAccount | null {
  const customer = rowsOf(body)[0]?.customer
  if (!customer) return null
  return { name: String(customer.descriptiveName ?? ''), currency: String(customer.currencyCode ?? 'EUR').toUpperCase(), timeZone: String(customer.timeZone ?? '') }
}

/** Campagnes d'une réponse (ou de plusieurs pages mises bout à bout), une ligne par campagne. Les grands entiers arrivent en texte. */
export function readAdsCampaigns(pages: unknown[]): AdsCampaign[] {
  const byId = new Map<string, AdsCampaign>()
  for (const row of pages.flatMap(rowsOf)) {
    const id = String(row.campaign?.id ?? '')
    if (!id) continue
    const c = byId.get(id) ?? { id, name: String(row.campaign?.name ?? ''), status: String(row.campaign?.status ?? ''), impressions: 0, clicks: 0, costMicros: 0, conversions: 0 }
    c.impressions += num(row.metrics?.impressions)
    c.clicks += num(row.metrics?.clicks)
    c.costMicros += num(row.metrics?.costMicros)
    c.conversions += num(row.metrics?.conversions)
    byId.set(id, c)
  }
  return [...byId.values()]
}

export function readAdsClick(body: unknown): { campaignId: string; campaignName: string } | null {
  const campaign = rowsOf(body)[0]?.campaign
  return campaign?.id ? { campaignId: String(campaign.id), campaignName: String(campaign.name ?? '') } : null
}

// ───────────────────────── Erreurs ─────────────────────────

/** `refused` : les réglages sont à revoir ; `unavailable` : à réessayer plus tard. */
export type AdsFailure = { kind: 'refused' | 'unavailable'; message: string }

/** Refus du serveur d'autorisation de Google (échange du jeton d'actualisation). */
export function oauthFailure(status: number, body: unknown): AdsFailure {
  const code = String((body as Obj | null)?.error ?? '')
  if (code === 'invalid_grant') {
    return { kind: 'refused', message: 'Google refuse le jeton d\'actualisation : il a expiré ou a été révoqué. Un jeton créé pendant que l\'application OAuth est en mode « Test » ne vit que 7 jours : publiez l\'application, puis créez un nouveau jeton.' }
  }
  if (code === 'invalid_client' || code === 'unauthorized_client') return { kind: 'refused', message: 'Google ne reconnaît pas l\'identifiant client OAuth ou son secret.' }
  if (status >= 500 || status === 429) return { kind: 'unavailable', message: 'Le service de connexion de Google ne répond pas pour le moment.' }
  return { kind: 'refused', message: `Google a refusé la connexion (${code || status}).` }
}

/**
 * Refus de l'API Google Ads, traduit pour la personne qui règle le module. Les codes d'erreur sont cherchés partout
 * dans la réponse : leur emplacement exact varie selon les versions de l'API.
 */
export function adsFailure(status: number, body: unknown): AdsFailure {
  const raw = typeof body === 'string' ? body : JSON.stringify(body ?? '')
  const has = (code: string) => raw.includes(code)
  if (has('CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION') || has('DEVELOPER_TOKEN_NOT_APPROVED')) {
    return { kind: 'refused', message: 'Le projet Google Cloud n\'a que l\'accès « Test » à l\'API Google Ads : demandez l\'accès « Explorer » dans la console Google Cloud (« Google Ads API » → « Overview »).' }
  }
  if (has('OAUTH_TOKEN_REVOKED') || has('OAUTH_TOKEN_EXPIRED') || has('OAUTH_TOKEN_INVALID')) return { kind: 'refused', message: 'Google refuse le jeton d\'actualisation : créez-en un nouveau.' }
  if (has('NOT_ADS_USER')) return { kind: 'refused', message: 'Le compte Google qui a créé le jeton n\'a accès à aucun compte Google Ads.' }
  if (has('USER_PERMISSION_DENIED')) {
    return { kind: 'refused', message: 'Le compte Google qui a créé le jeton n\'a pas accès à ce compte Google Ads. S\'il y accède par un compte administrateur (MCC), saisissez le numéro de ce compte administrateur.' }
  }
  if (has('CUSTOMER_NOT_FOUND') || has('INVALID_CUSTOMER_ID') || status === 404) return { kind: 'refused', message: 'Google ne trouve pas ce numéro de compte Google Ads.' }
  if (has('CUSTOMER_NOT_ENABLED')) return { kind: 'refused', message: 'Ce compte Google Ads est désactivé ou n\'a pas terminé son inscription.' }
  if (has('SERVICE_DISABLED') || has('API has not been used')) return { kind: 'refused', message: 'L\'API Google Ads n\'est pas activée dans le projet Google Cloud du client OAuth.' }
  if (status === 429 || has('RESOURCE_EXHAUSTED')) return { kind: 'unavailable', message: 'Le nombre d\'appels autorisés par Google pour aujourd\'hui est atteint. Réessayez plus tard.' }
  if (status >= 500) return { kind: 'unavailable', message: 'Google Ads ne répond pas pour le moment.' }
  if (status === 401) return { kind: 'refused', message: 'Google a refusé la connexion : vérifiez le client OAuth et le jeton d\'actualisation.' }
  if (status === 403) return { kind: 'refused', message: 'Google refuse l\'accès à ce compte Google Ads avec ces réglages.' }
  const detail = String((body as Obj | null)?.error?.message ?? '').slice(0, 200)
  return { kind: 'refused', message: `Google Ads a refusé la demande (${status})${detail ? ` : ${detail}` : ''}.` }
}

// ───────────────────────── Rapprochement avec les contacts du site ─────────────────────────

/** Un contact du site venu de Google Ads : un message reçu, ou un paiement réussi (`amount` en centimes). */
export type AdsLead = { kind: 'message' | 'payment'; origin: StoredOrigin | null; amount?: number; /** Devise du paiement (« eur »). */ currency?: string }

export type AdsReportRow = AdsCampaign & {
  messages: number
  payments: number
  /** Messages et paiements. */
  contacts: number
  /**
   * Montant encaissé par les paiements rattachés, en plus petite unité de la devise du compte Google Ads. Un paiement
   * fait dans une autre devise compte comme contact, mais son montant n'est pas additionné.
   */
  revenue: number
  /** Dépense divisée par le nombre de contacts (millionièmes) ; null sans contact. */
  costPerContactMicros: number | null
}

export type AdsReport = {
  campaigns: AdsReportRow[]
  totals: { impressions: number; clicks: number; costMicros: number; conversions: number; messages: number; payments: number; contacts: number; revenue: number; costPerContactMicros: number | null }
  /** Contacts venus de Google Ads dont la campagne n'a pas pu être retrouvée. */
  unassigned: { messages: number; payments: number; contacts: number }
}

const same = (a: string, b: string) => a.trim().toLocaleLowerCase('fr') === b.trim().toLocaleLowerCase('fr')

/**
 * Rapproche les contacts du site des campagnes : par l'identifiant de campagne (`utm_id`, ou retrouvé par le
 * `gclid`), sinon par le nom (`utm_campaign` égal au nom de la campagne). Seules les campagnes qui ont eu de
 * l'activité ou un contact sur la période sont gardées, de la plus coûteuse à la moins coûteuse.
 */
export function buildAdsReport(campaigns: AdsCampaign[], leads: AdsLead[], currency = ''): AdsReport {
  const rows = new Map<string, AdsReportRow>(campaigns.map(c => [c.id, { ...c, messages: 0, payments: 0, contacts: 0, revenue: 0, costPerContactMicros: null }]))
  const unassigned = { messages: 0, payments: 0, contacts: 0 }
  for (const lead of leads) {
    if (lead.origin?.channel !== 'google-ads') continue
    const { campaignId, campaign } = lead.origin
    const row = (campaignId && rows.get(campaignId)) || (campaign ? [...rows.values()].find(r => same(r.name, campaign)) : undefined)
    const target = row ?? unassigned
    if (lead.kind === 'message') target.messages++
    else target.payments++
    target.contacts++
    if (row && lead.kind === 'payment' && (lead.currency ?? '').toLowerCase() === currency.toLowerCase()) row.revenue += lead.amount ?? 0
  }
  const kept = [...rows.values()].filter(r => r.impressions || r.clicks || r.costMicros || r.contacts)
  for (const r of kept) r.costPerContactMicros = r.contacts ? Math.round(r.costMicros / r.contacts) : null
  kept.sort((a, b) => b.costMicros - a.costMicros || b.contacts - a.contacts || a.name.localeCompare(b.name))
  const sum = (key: 'impressions' | 'clicks' | 'costMicros' | 'conversions' | 'messages' | 'payments' | 'contacts' | 'revenue') => kept.reduce((n, r) => n + r[key], 0)
  const contacts = sum('contacts') + unassigned.contacts
  const costMicros = sum('costMicros')
  return {
    campaigns: kept,
    totals: {
      impressions: sum('impressions'), clicks: sum('clicks'), costMicros, conversions: sum('conversions'),
      messages: sum('messages') + unassigned.messages, payments: sum('payments') + unassigned.payments, contacts, revenue: sum('revenue'),
      costPerContactMicros: contacts ? Math.round(costMicros / contacts) : null,
    },
    unassigned,
  }
}

/** Montant en millionièmes, prêt à afficher : « 1 234,50 € ». */
export function formatMicros(micros: number, currency: string) {
  try { return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(micros / 1_000_000) }
  catch { return `${(micros / 1_000_000).toFixed(2)} ${currency}` }
}

export const ADS_STATUS_LABELS: Record<string, string> = { ENABLED: 'Active', PAUSED: 'En pause', REMOVED: 'Supprimée' }
