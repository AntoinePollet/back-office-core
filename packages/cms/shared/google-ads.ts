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
  for (const key of ['messageConversion', 'paymentConversion'] as const) {
    if (settings[key] && !/^\d{1,20}$/.test(settings[key]!.trim())) errors[key] = 'Le numéro d\'une action de conversion ne contient que des chiffres (voir l\'écran « Annonces Google »).'
  }
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

export const ADS_ACCOUNT_QUERY = 'SELECT customer.descriptive_name, customer.currency_code, customer.time_zone, '
  + 'customer.conversion_tracking_setting.google_ads_conversion_customer FROM customer LIMIT 1'

const DAY = /^\d{4}-\d{2}-\d{2}$/
/** Ce qu'il faut d'une campagne pour la montrer et la piloter : son état et son budget. */
const CAMPAIGN_FIELDS = 'campaign.id, campaign.name, campaign.status, campaign.campaign_budget, campaign_budget.amount_micros, '
  + 'campaign_budget.explicitly_shared, campaign_budget.reference_count, campaign_budget.period, campaign_budget.type'

/** Une ligne par campagne, cumulée sur la période (pas de découpage par jour). */
export function adsCampaignQuery(from: string, to: string) {
  if (!DAY.test(from) || !DAY.test(to)) throw new Error('Dates attendues au format AAAA-MM-JJ.')
  return `SELECT ${CAMPAIGN_FIELDS}, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions `
    + `FROM campaign WHERE segments.date BETWEEN '${from}' AND '${to}'`
}

/** Identifiant de campagne : des chiffres seulement. */
export const isCampaignId = (value: unknown): value is string => typeof value === 'string' && /^\d{1,20}$/.test(value)

/** L'état actuel d'une campagne (sans chiffres), relu juste avant de la modifier. Null si l'identifiant n'en est pas un. */
export const adsCampaignStateQuery = (id: string) => (isCampaignId(id) ? `SELECT ${CAMPAIGN_FIELDS} FROM campaign WHERE campaign.id = ${id}` : null)

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

export type AdsAccount = {
  name: string
  currency: string
  timeZone: string
  /**
   * Compte qui possède les actions de conversion : ce compte-ci, ou son compte administrateur quand le suivi des
   * conversions est fait à ce niveau. Vide si Google ne le dit pas.
   */
  conversionCustomer: string
}
/** Budget d'une campagne, tel que Google le décrit. */
export type AdsBudget = {
  /** Nom de la ressource chez Google : `customers/123/campaignBudgets/456`. */
  resourceName: string
  /** Montant moyen par jour, en millionièmes de la devise ; 0 pour un budget fixé sur toute une période. */
  amountMicros: number
  /** Le budget sert à plusieurs campagnes : le changer les changerait toutes. */
  shared: boolean
  /** DAILY (par jour) ou CUSTOM_PERIOD (total sur une période). */
  period: string
  /** STANDARD, ou un budget propre à un type de campagne (SMART_CAMPAIGN, LOCAL_SERVICES, FIXED_CPA). */
  type: string
}

export type AdsCampaign = {
  id: string
  name: string
  /** ENABLED, PAUSED ou REMOVED. */
  status: string
  /** Budget de la campagne ; null si Google n'en renvoie pas. */
  budget: AdsBudget | null
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
  const owner = /^customers\/(\d{10})$/.exec(String(customer.conversionTrackingSetting?.googleAdsConversionCustomer ?? ''))?.[1] ?? ''
  return { name: String(customer.descriptiveName ?? ''), currency: String(customer.currencyCode ?? 'EUR').toUpperCase(), timeZone: String(customer.timeZone ?? ''), conversionCustomer: owner }
}

function readAdsBudget(row: Obj): AdsBudget | null {
  const resourceName = String(row.campaign?.campaignBudget ?? row.campaignBudget?.resourceName ?? '')
  if (!/^customers\/\d+\/campaignBudgets\/\d+$/.test(resourceName)) return null
  const b = row.campaignBudget ?? {}
  return {
    resourceName, amountMicros: num(b.amountMicros), period: String(b.period ?? ''), type: String(b.type ?? ''),
    shared: b.explicitlyShared === true || num(b.referenceCount) > 1,
  }
}

/** Campagnes d'une réponse (ou de plusieurs pages mises bout à bout), une ligne par campagne. Les grands entiers arrivent en texte. */
export function readAdsCampaigns(pages: unknown[]): AdsCampaign[] {
  const byId = new Map<string, AdsCampaign>()
  for (const row of pages.flatMap(rowsOf)) {
    const id = String(row.campaign?.id ?? '')
    if (!id) continue
    const c = byId.get(id) ?? { id, name: String(row.campaign?.name ?? ''), status: String(row.campaign?.status ?? ''), budget: readAdsBudget(row), impressions: 0, clicks: 0, costMicros: 0, conversions: 0 }
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
  if (has('ACTION_NOT_PERMITTED') || has('UPDATE_OPERATION_NOT_PERMITTED') || has('MUTATE_NOT_ALLOWED')) {
    return { kind: 'refused', message: 'Google refuse la modification : le compte Google qui a créé le jeton n\'a qu\'un accès en lecture à ce compte Google Ads. Il lui faut l\'accès « Standard » ou « Administrateur ».' }
  }
  if (has('BUDGET_BELOW_PER_DAY_MINIMUM') || has('MONEY_AMOUNT_LESS_THAN_CURRENCY_MINIMUM_CPC')) return { kind: 'refused', message: 'Google refuse ce budget : il est en dessous du minimum accepté pour cette campagne.' }
  if (has('MONEY_AMOUNT_TOO_LARGE')) return { kind: 'refused', message: 'Google refuse ce budget : le montant est trop élevé.' }
  if (has('NON_MULTIPLE_OF_MINIMUM_CURRENCY_UNIT')) return { kind: 'refused', message: 'Google refuse ce budget : le montant a trop de décimales pour la devise du compte.' }
  if (has('CANNOT_MODIFY_FIELD_OF_IMPLICITLY_SHARED_CAMPAIGN_BUDGET') || has('BUDGET_AMOUNT_MUST_BE_UNSET_FOR_CUSTOM_BUDGET_PERIOD')) return { kind: 'refused', message: 'Ce budget ne se change que dans Google Ads.' }
  if (has('CANNOT_MODIFY_FOR_TRIAL_CAMPAIGN')) return { kind: 'refused', message: 'Cette campagne fait partie d\'une expérience : elle ne se modifie que dans Google Ads.' }
  if (has('INVALID_OPERATION_IF_SERVING_STATUS_HAS_ENDED')) return { kind: 'refused', message: 'Cette campagne est terminée (sa date de fin est passée) : changez d\'abord sa date de fin dans Google Ads.' }
  if (has('OPERATION_NOT_PERMITTED_FOR_REMOVED_RESOURCE') || has('CAMPAIGN_BUDGET_REMOVED')) return { kind: 'refused', message: 'Cette campagne ou son budget ont été supprimés dans Google Ads.' }
  if (has('OPERATION_NOT_PERMITTED_FOR_CAMPAIGN_TYPE') || has('INVALID_STATUS_CHANGE')) return { kind: 'refused', message: 'Google ne permet pas cette modification pour ce type de campagne : passez par Google Ads.' }
  if (has('EU_POLITICAL_ADVERTISING_DECLARATION_REQUIRED')) return { kind: 'refused', message: 'Google demande d\'abord une déclaration sur la publicité politique dans l\'Union européenne : à faire dans Google Ads (paramètres du compte).' }
  if (has('AGREEMENT_REQUIRED')) return { kind: 'refused', message: 'Google demande d\'abord d\'accepter des conditions dans Google Ads.' }
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

// ───────────────────────── Piloter une campagne : pause, reprise, budget ─────────────────────────

export const ADS_SETTABLE_STATUSES = ['ENABLED', 'PAUSED'] as const
export type AdsSettableStatus = typeof ADS_SETTABLE_STATUSES[number]

/** Pourquoi l'état d'une campagne ne peut pas être changé d'ici ; null si c'est possible. */
export function statusLock(campaign: Pick<AdsCampaign, 'status'>): string | null {
  if (campaign.status === 'REMOVED') return 'Cette campagne est supprimée dans Google Ads.'
  if (!(ADS_SETTABLE_STATUSES as readonly string[]).includes(campaign.status)) return 'L\'état de cette campagne ne se change que dans Google Ads.'
  return null
}

/**
 * Pourquoi le budget d'une campagne ne peut pas être changé d'ici ; null si c'est possible. Seul le cas simple l'est :
 * un budget par jour, propre à la campagne. Les autres se règlent dans Google Ads, où l'on voit ce qu'ils entraînent.
 */
export function budgetLock(campaign: Pick<AdsCampaign, 'status' | 'budget'>): string | null {
  const b = campaign.budget
  if (campaign.status === 'REMOVED') return 'Cette campagne est supprimée dans Google Ads.'
  if (!b) return 'Google Ads n\'indique pas de budget pour cette campagne.'
  if (b.shared) return 'Ce budget est partagé entre plusieurs campagnes : il se change dans Google Ads.'
  if (b.period !== 'DAILY') return 'Ce budget est fixé pour toute une période, pas par jour : il se change dans Google Ads.'
  if (b.type !== 'STANDARD') return 'Le budget de ce type de campagne se change dans Google Ads.'
  return null
}

/** Budget par jour le plus élevé accepté d'ici (en unités de la devise) : au-delà, c'est sans doute une faute de frappe. */
export const ADS_MAX_DAILY_BUDGET = 10_000
/** Sur un mois, Google ne dépense pas plus que 30,4 fois le budget par jour (et jusqu'à 2 fois ce budget un jour donné). */
export const ADS_MONTH_FACTOR = 30.4

/**
 * Lit un budget par jour saisi (« 25 », « 25,50 », « 1 250.5 ») et le rend en millionièmes. Deux décimales au plus :
 * Google refuse un montant qui n'est pas un multiple de la plus petite unité de la devise.
 */
export function parseDailyBudget(input: unknown): { ok: true; micros: number } | { ok: false; error: string } {
  const text = String(input ?? '').replace(/[\s\u00a0\u202f€$£]/g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { ok: false, error: 'Saisissez un montant par jour, avec deux décimales au plus : 25 ou 25,50.' }
  const value = Number(text)
  if (value <= 0) return { ok: false, error: 'Le budget par jour doit être supérieur à zéro. Pour arrêter la campagne, mettez-la en pause.' }
  if (value > ADS_MAX_DAILY_BUDGET) return { ok: false, error: `Budget par jour trop élevé pour être changé d'ici (plus de ${ADS_MAX_DAILY_BUDGET.toLocaleString('fr-FR')}) : passez par Google Ads.` }
  return { ok: true, micros: Math.round(value * 100) * 10_000 }
}

/** Corps de la demande qui change l'état d'une campagne (`customers/<compte>/campaigns:mutate`). */
export const statusMutation = (customerId: string, campaignId: string, status: AdsSettableStatus) =>
  ({ operations: [{ update: { resourceName: `customers/${customerId}/campaigns/${campaignId}`, status }, updateMask: 'status' }] })

/** Corps de la demande qui change le montant d'un budget (`customers/<compte>/campaignBudgets:mutate`). */
export const budgetMutation = (resourceName: string, amountMicros: number) =>
  ({ operations: [{ update: { resourceName, amountMicros }, updateMask: 'amount_micros' }] })
