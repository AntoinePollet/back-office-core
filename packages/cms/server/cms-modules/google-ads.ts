import { and, eq, gte } from 'drizzle-orm'
import type { H3Event } from 'h3'
import type { StoredOrigin } from '../../shared/attribution'
import {
  ADS_ACCOUNT_QUERY, ADS_CLICK_LOOKBACK_DAYS, type AdsAccount, type AdsCampaign, type AdsFailure, type AdsLead, type AdsPeriod, type AdsReport,
  type AdsSettableStatus, ADS_SETTABLE_STATUSES, ADS_STATUS_LABELS,
  adsCampaignQuery, adsCampaignStateQuery, adsClickQuery, adsCustomerId, adsFailure, adsRange, budgetLock, budgetMutation, buildAdsReport, dayIn, formatMicros,
  googleAdsReady, googleAdsSettingsErrors, oauthFailure, parseDailyBudget, readAdsAccount, readAdsCampaigns, readAdsClick, statusLock, statusMutation,
} from '../../shared/google-ads'
import { CONVERSION_ACTIONS_QUERY, readConversionActions } from '../../shared/conversions'
import type { CmsModuleDefinition, ModuleSettings } from '../utils/modules'

/**
 * Google Ads, en lecture : dépense et résultats des campagnes, rapprochés des contacts enregistrés par le site
 * (voir `shared/google-ads.ts`), et trois actions réservées à l'administrateur : mettre une campagne en pause, la
 * relancer, changer son budget par jour. Rien d'autre n'est modifié dans le compte Google Ads.
 */

export class AdsError extends Error {
  constructor(public failure: AdsFailure) { super(failure.message) }
}

/** Adresses de Google. Ne se changent que pour les tests : NUXT_GOOGLE_ADS_API_URL, NUXT_GOOGLE_OAUTH_TOKEN_URL. */
const apiUrl = (event: H3Event) => String(useRuntimeConfig(event).googleAdsApiUrl).replace(/\/$/, '')
const tokenUrl = (event: H3Event) => String(useRuntimeConfig(event).googleOauthTokenUrl)

const unreachable = (what: string) => (error: Error) => {
  throw new AdsError({ kind: 'unavailable', message: error.name === 'TimeoutError' ? `${what} n'a pas répondu après 15 secondes.` : `${what} est injoignable pour le moment.` })
}

// ───────────── Jeton d'accès : valable une heure, gardé en mémoire ─────────────

const tokens = new Map<string, { token: string; expires: number }>()

async function digest(parts: unknown[]) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(parts)))
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function accessToken(event: H3Event, settings: ModuleSettings) {
  const key = await digest([settings.clientId, settings.clientSecret, settings.refreshToken])
  const hit = tokens.get(key)
  if (hit && hit.expires > Date.now() + 60_000) return hit.token
  const response = await fetch(tokenUrl(event), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'accept': 'application/json' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: settings.clientId ?? '', client_secret: settings.clientSecret ?? '', refresh_token: settings.refreshToken ?? '' }),
    signal: AbortSignal.timeout(15_000),
  }).catch(unreachable('Le service de connexion de Google'))
  const body = await response.json().catch(() => null) as { access_token?: string; expires_in?: number } | null
  if (!response.ok || !body?.access_token) throw new AdsError(oauthFailure(response.status, body))
  tokens.set(key, { token: body.access_token, expires: Date.now() + (Number(body.expires_in) || 3600) * 1000 })
  return body.access_token
}

/**
 * Un appel à l'API Google Ads pour le compte réglé (`googleAds:search`, `campaigns:mutate`…). Un jeton d'accès
 * refusé (invalidé plus tôt que prévu chez Google) est redemandé une fois.
 */
async function call<T>(event: H3Event, settings: ModuleSettings, method: string, body: unknown): Promise<T> {
  const login = adsCustomerId(settings.loginCustomerId)
  for (let attempt = 0; ; attempt++) {
    const token = await accessToken(event, settings)
    const response = await fetch(`${apiUrl(event)}/customers/${adsCustomerId(settings.customerId)}/${method}`, {
      method: 'POST',
      headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json', 'accept': 'application/json', ...(login ? { 'login-customer-id': login } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    }).catch(unreachable('Google Ads'))
    const answer = await response.json().catch(() => null)
    if (response.ok) return answer as T
    if (response.status === 401 && attempt === 0) { tokens.clear(); continue }
    throw new AdsError(adsFailure(response.status, answer))
  }
}

/** Une requête GAQL sur le compte réglé ; toutes les pages de la réponse (10 000 lignes par page, 5 pages au plus). */
export async function search(event: H3Event, settings: ModuleSettings, query: string): Promise<unknown[]> {
  const pages: unknown[] = []
  let pageToken: string | undefined
  for (let i = 0; i < 5; i++) {
    const body = await call<{ nextPageToken?: string } | null>(event, settings, 'googleAds:search', { query, ...(pageToken ? { pageToken } : {}) })
    pages.push(body)
    pageToken = body?.nextPageToken
    if (!pageToken) break
  }
  return pages
}

export async function account(event: H3Event, settings: ModuleSettings): Promise<AdsAccount> {
  const found = readAdsAccount((await search(event, settings, ADS_ACCOUNT_QUERY))[0])
  if (!found) throw new AdsError({ kind: 'refused', message: 'Google Ads n\'a renvoyé aucun compte pour ce numéro.' })
  return found
}

export const googleAdsModule: CmsModuleDefinition = {
  id: 'google-ads',
  category: 'ads',
  label: 'Google Ads',
  // Logo officiel de Google Ads (tracé : Simple Icons) et le bleu de la marque.
  logo: { style: 'fill', color: '#4285F4', paths: ['M3.9998 22.9291C1.7908 22.9291 0 21.1383 0 18.9293s1.7908-3.9998 3.9998-3.9998 3.9998 1.7908 3.9998 3.9998-1.7908 3.9998-3.9998 3.9998zm19.4643-6.0004c-.0001-.0001-7.9996-13.8563-7.9997-13.8562-1.1046-1.9132-3.5509-2.5687-5.4641-1.4641-1.9132 1.1046-2.5687 3.5509-1.4641 5.4641l7.9997 13.8562c1.1046 1.9132 3.5509 2.5687 5.4641 1.4641 1.9132-1.1046 2.5687-3.5509 1.4641-5.4641z'] },
  description: 'Ce que coûtent les campagnes Google Ads et ce qu\'elles rapportent : dépense, clics, et contacts du site (messages, paiements) venus des annonces, campagne par campagne. L\'administrateur peut mettre une campagne en pause, la relancer et changer son budget par jour.',
  settings: [
    {
      key: 'customerId', label: 'Numéro du compte Google Ads', type: 'text', required: true, placeholder: '123-456-7890',
      help: 'Les dix chiffres affichés en haut à droite de Google Ads.',
    },
    {
      key: 'loginCustomerId', label: 'Numéro du compte administrateur (MCC)', type: 'text', placeholder: '123-456-7890',
      help: 'À remplir si la personne qui a créé le jeton accède au compte par un compte administrateur : le numéro de ce compte administrateur. Sinon, laisser vide.',
      env: { key: 'googleAdsLoginCustomerId', name: 'NUXT_GOOGLE_ADS_LOGIN_CUSTOMER_ID' },
    },
    {
      key: 'clientId', label: 'Identifiant client OAuth', type: 'text', required: true, placeholder: '….apps.googleusercontent.com',
      help: 'Console Google Cloud : activer « Google Ads API » dans un projet, y demander l\'accès « Explorer », puis « Identifiants » → « Créer des identifiants » → « ID client OAuth ».',
      env: { key: 'googleAdsClientId', name: 'NUXT_GOOGLE_ADS_CLIENT_ID' },
    },
    {
      key: 'clientSecret', label: 'Secret du client OAuth', type: 'secret', required: true,
      help: 'Affiché à la création de l\'ID client OAuth, puis dans sa fiche.',
      env: { key: 'googleAdsClientSecret', name: 'NUXT_GOOGLE_ADS_CLIENT_SECRET' },
    },
    {
      key: 'refreshToken', label: 'Jeton d\'actualisation', type: 'secret', required: true,
      help: 'Obtenu une fois, en se connectant avec un compte Google qui a accès au compte Google Ads, pour l\'autorisation « https://www.googleapis.com/auth/adwords » (voir le README du site). Pour mettre en pause ou changer un budget d\'ici, ce compte doit avoir l\'accès « Standard » ou « Administrateur » au compte Google Ads ; un accès en lecture suffit pour les chiffres.',
      env: { key: 'googleAdsRefreshToken', name: 'NUXT_GOOGLE_ADS_REFRESH_TOKEN' },
    },
    {
      key: 'messageConversion', label: 'Action de conversion pour un message reçu', type: 'text', placeholder: '1234567890',
      help: 'Facultatif. Pour signaler à Google Ads les messages venus d\'une annonce : le numéro d\'une action de conversion de type « Importation depuis les clics », créée dans Google Ads (Objectifs → Conversions). L\'écran « Annonces Google » liste celles du compte avec leur numéro. Seuls les contacts dont le visiteur a donné son accord (module Consentement) sont envoyés. Le jeton doit aussi porter l\'autorisation « https://www.googleapis.com/auth/datamanager ».',
    },
    {
      key: 'paymentConversion', label: 'Action de conversion pour un paiement', type: 'text', placeholder: '1234567890',
      help: 'Facultatif. Même chose pour les paiements réussis (module Stripe), envoyés avec leur montant.',
    },
  ],
  adminPage: { to: '/admin/google-ads', label: 'Voir les annonces' },
  validate: googleAdsSettingsErrors,

  async test(event, settings) {
    const invalid = Object.values(googleAdsSettingsErrors(settings))
    if (invalid.length) throw new Error(invalid.join(' '))
    tokens.clear()
    cache.clear()
    clickTried.clear()
    clicksRefusedAt = 0
    const found = await account(event, settings)
    const ok = `Connexion réussie au compte Google Ads « ${found.name || adsCustomerId(settings.customerId)} » (${found.currency}).`
    // Actions de conversion réglées : elles doivent exister dans le compte et accepter un envoi.
    const wanted = [settings.messageConversion, settings.paymentConversion].map(v => v?.trim()).filter((v): v is string => !!v)
    if (!wanted.length) return ok
    const actions = readConversionActions(await search(event, settings, CONVERSION_ACTIONS_QUERY))
    const missing = wanted.filter(id => !actions.some(a => a.id === id))
    if (missing.length) throw new Error(`Le compte est joignable, mais l'action de conversion n° ${missing.join(', ')} n'y existe pas ou n'est pas de type « Importation depuis les clics ».`)
    return `${ok} Conversions : ${[...new Set(wanted)].map(id => `« ${actions.find(a => a.id === id)!.name} »`).join(' et ')}.`
  },
}

// ───────────── Rapport de l'écran « Annonces Google » ─────────────

/** Les chiffres de Google sont gardés cinq minutes en mémoire (voir la même réserve dans ./audience.ts). */
const CACHE_MS = 5 * 60_000
const cache = new Map<string, { at: number; account: AdsAccount; campaigns: AdsCampaign[]; from: string; to: string }>()

export type AdsAnswer =
  | { state: 'ok'; account: AdsAccount; from: string; to: string; report: AdsReport; updatedAt: string }
  | { state: 'unconfigured' | 'refused' | 'unavailable'; message: string }

type LeadRow = { table: 'message' | 'payment'; id: string; origin: StoredOrigin | null; createdAt: Date; amount?: number; currency?: string }

/** Messages et paiements réussis de la période venus de Google Ads. */
async function leadRows(event: H3Event, since: Date): Promise<LeadRow[]> {
  const db = useDb(event)
  const { formSubmissions, payments } = schema
  const [messages, paid] = await Promise.all([
    db.select({ id: formSubmissions.id, origin: formSubmissions.origin, createdAt: formSubmissions.createdAt }).from(formSubmissions).where(gte(formSubmissions.createdAt, since)),
    db.select({ id: payments.id, origin: payments.origin, createdAt: payments.createdAt, amount: payments.amount, refunded: payments.refundedAmount, currency: payments.currency }).from(payments)
      .where(and(gte(payments.createdAt, since), eq(payments.status, 'paid'), eq(payments.livemode, true))),
  ])
  return [
    ...messages.map(m => ({ table: 'message' as const, ...m })),
    ...paid.map(p => ({ table: 'payment' as const, id: p.id, origin: p.origin, createdAt: p.createdAt, amount: p.amount - p.refunded, currency: p.currency })),
  ].filter(r => r.origin?.channel === 'google-ads')
}

/** Recherches de clic faites par affichage du rapport : chacune est un appel à Google, compté dans le quota du jour. */
const MAX_CLICK_LOOKUPS = 15
/**
 * Un clic cherché sans succès n'est pas redemandé avant une heure (en mémoire, comme les chiffres) : les contacts
 * suivants passent à leur tour, et l'écran ne dépense pas le quota à chaque affichage. Après un refus de Google,
 * plus aucune recherche pendant ce même délai.
 */
const CLICK_RETRY_MS = 60 * 60_000
const clickTried = new Map<string, number>()
let clicksRefusedAt = 0

/**
 * Retrouve la campagne des contacts qui n'ont qu'un `gclid` (cas le plus courant : le balisage automatique de Google
 * Ads, sans suffixe d'URL), et l'enregistre avec le contact pour ne plus la redemander. Un clic introuvable alors
 * qu'il date de plus d'un jour est marqué comme cherché. Les erreurs sont ignorées : le rapport s'affiche quand même.
 */
async function resolveClicks(event: H3Event, settings: ModuleSettings, rows: LeadRow[], timeZone: string) {
  const now = Date.now()
  if (now - clicksRefusedAt < CLICK_RETRY_MS) return
  for (const [id, at] of clickTried) if (now - at >= CLICK_RETRY_MS) clickTried.delete(id)
  const todo = rows.filter((r) => {
    const o = r.origin!
    return o.click === 'gclid' && o.clickId && !o.campaignId && !o.clickChecked && !clickTried.has(r.id)
      && now - (o.at ?? r.createdAt.getTime()) < ADS_CLICK_LOOKBACK_DAYS * 86_400_000
  }).slice(0, MAX_CLICK_LOOKUPS)
  const db = useDb(event)
  await Promise.all(todo.map(async (row) => {
    const origin = row.origin!
    const at = origin.at ?? row.createdAt.getTime()
    const query = adsClickQuery(origin.clickId!, dayIn(timeZone, at))
    try {
      if (now - clicksRefusedAt < CLICK_RETRY_MS) return
      clickTried.set(row.id, now)
      const found = query ? readAdsClick((await search(event, settings, query))[0]) : null
      if (!found && query && now - at < 86_400_000) return
      const next: StoredOrigin = found ? { ...origin, campaignId: found.campaignId, campaign: origin.campaign ?? (found.campaignName || undefined) } : { ...origin, clickChecked: true }
      row.origin = next
      if (row.table === 'message') await db.update(schema.formSubmissions).set({ origin: next }).where(eq(schema.formSubmissions.id, row.id))
      else await db.update(schema.payments).set({ origin: next }).where(eq(schema.payments.id, row.id))
    }
    catch (error) {
      // Refus ou quota atteint : inutile d'insister pour les autres contacts.
      if (error instanceof AdsError) clicksRefusedAt = now
      else console.error('[cms] google ads : campagne du clic introuvable', error)
    }
  }))
}

/** Ce que l'écran « Annonces Google » affiche : le rapport, ou pourquoi il manque. */
export async function readGoogleAds(event: H3Event, days: AdsPeriod): Promise<AdsAnswer> {
  const settings = await moduleSettings(event, 'google-ads')
  if (!googleAdsReady(settings)) return { state: 'unconfigured', message: 'Google Ads n\'est pas encore réglé.' }
  try {
    const key = await digest([settings, days, new Date().toISOString().slice(0, 10)])
    let hit = cache.get(key)
    if (!hit || Date.now() - hit.at >= CACHE_MS) {
      const found = await account(event, settings)
      // Les jours de Google sont ceux du fuseau horaire du compte.
      const { from, to } = adsRange(days, found.timeZone)
      const campaigns = readAdsCampaigns(await search(event, settings, adsCampaignQuery(from, to)))
      for (const [k, v] of cache) if (Date.now() - v.at >= CACHE_MS) cache.delete(k)
      hit = { at: Date.now(), account: found, campaigns, from, to }
      cache.set(key, hit)
    }
    const zone = hit.account.timeZone
    const rows = (await leadRows(event, new Date(Date.now() - (days + 1) * 86_400_000))).filter(r => dayIn(zone, r.createdAt) >= hit!.from)
    await resolveClicks(event, settings, rows, zone)
    const leads: AdsLead[] = rows.map(r => ({ kind: r.table, origin: r.origin, amount: r.amount, currency: r.currency }))
    return { state: 'ok', account: hit.account, from: hit.from, to: hit.to, report: buildAdsReport(hit.campaigns, leads, hit.account.currency), updatedAt: new Date(hit.at).toISOString() }
  }
  catch (error) {
    if (error instanceof AdsError) return { state: error.failure.kind, message: error.failure.message }
    console.error('[cms] google ads : lecture impossible', error)
    return { state: 'unavailable', message: 'Les chiffres de Google Ads n\'ont pas pu être lus pour le moment.' }
  }
}

/** L'écran « Annonces Google » (dépenses comprises) est ouvert aux administrateurs et aux éditeurs. */
export const canReadGoogleAds = (user: { role: string }) => user.role === 'admin' || user.role === 'editor'

// ───────────── Piloter une campagne : pause, reprise, budget (administrateur) ─────────────

type Actor = { id: string; name?: string | null; email?: string | null }

/** Refus lisible par la personne : 409 quand l'état chez Google ne permet pas l'action, 502 quand Google la refuse. */
const refuse = (statusCode: number, message: string) => createError({ statusCode, message })

/** Réglages du module et état de la campagne chez Google à l'instant, relus avant toute modification. */
async function campaignNow(event: H3Event, id: string) {
  const settings = await moduleSettings(event, 'google-ads')
  if (!googleAdsReady(settings)) throw refuse(409, 'Google Ads n\'est pas encore réglé.')
  const query = adsCampaignStateQuery(id)
  if (!query) throw refuse(404, 'Campagne introuvable.')
  const [campaign] = readAdsCampaigns(await search(event, settings, query).catch(rethrow))
  if (!campaign) throw refuse(404, 'Google Ads ne trouve pas cette campagne dans ce compte.')
  return { settings, campaign }
}

function rethrow(error: unknown): never {
  if (error instanceof AdsError) throw refuse(error.failure.kind === 'unavailable' ? 503 : 502, error.failure.message)
  throw error
}

/** Après une modification : les chiffres gardés en mémoire ne disent plus l'état des campagnes. */
const forget = () => cache.clear()

/** Met une campagne en pause, ou la relance. Sans effet (et sans appel d'écriture) si elle est déjà dans cet état. */
export async function setCampaignStatus(event: H3Event, user: Actor, id: string, status: unknown) {
  if (!(ADS_SETTABLE_STATUSES as readonly unknown[]).includes(status)) throw refuse(400, 'État attendu : ENABLED (active) ou PAUSED (en pause).')
  const wanted = status as AdsSettableStatus
  const { settings, campaign } = await campaignNow(event, id)
  const lock = statusLock(campaign)
  if (lock) throw refuse(409, lock)
  if (campaign.status !== wanted) {
    await call(event, settings, 'campaigns:mutate', statusMutation(adsCustomerId(settings.customerId), campaign.id, wanted)).catch(rethrow)
    forget()
    logActivity(event, {
      action: 'google_ads.campaign_status', category: 'settings', actor: user, target: { kind: 'google-ads', id: campaign.id },
      phrase: `a ${wanted === 'PAUSED' ? 'mis en pause' : 'relancé'} la campagne Google Ads « ${campaign.name} »`,
    })
  }
  return { id: campaign.id, status: wanted, label: ADS_STATUS_LABELS[wanted] }
}

/**
 * Change le budget par jour d'une campagne. `expectedMicros` est le budget que la personne avait sous les yeux : s'il a
 * changé entre-temps dans Google Ads, rien n'est fait et elle est invitée à relire.
 */
export async function setCampaignBudget(event: H3Event, user: Actor, id: string, input: { amount?: unknown; expectedMicros?: unknown }) {
  const parsed = parseDailyBudget(input.amount)
  if (!parsed.ok) throw refuse(400, parsed.error)
  const { settings, campaign } = await campaignNow(event, id)
  const lock = budgetLock(campaign)
  if (lock) throw refuse(409, lock)
  const budget = campaign.budget!
  if (Number(input.expectedMicros) !== budget.amountMicros) {
    forget()
    throw refuse(409, 'Le budget de cette campagne a changé dans Google Ads depuis l\'affichage de cette page. Rechargez-la, puis recommencez.')
  }
  if (parsed.micros !== budget.amountMicros) {
    const found = await account(event, settings).catch(rethrow)
    await call(event, settings, 'campaignBudgets:mutate', budgetMutation(budget.resourceName, parsed.micros)).catch(rethrow)
    forget()
    logActivity(event, {
      action: 'google_ads.campaign_budget', category: 'settings', actor: user, target: { kind: 'google-ads', id: campaign.id },
      phrase: `a changé le budget par jour de la campagne Google Ads « ${campaign.name} » : ${formatMicros(budget.amountMicros, found.currency)} → ${formatMicros(parsed.micros, found.currency)}`,
    })
  }
  return { id: campaign.id, amountMicros: parsed.micros }
}
