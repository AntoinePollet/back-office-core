import { and, eq, gte } from 'drizzle-orm'
import type { H3Event } from 'h3'
import type { StoredOrigin } from '../../shared/attribution'
import {
  ADS_ACCOUNT_QUERY, ADS_CLICK_LOOKBACK_DAYS, type AdsAccount, type AdsCampaign, type AdsFailure, type AdsLead, type AdsPeriod, type AdsReport,
  adsCampaignQuery, adsClickQuery, adsCustomerId, adsFailure, adsRange, buildAdsReport, dayIn, googleAdsReady, googleAdsSettingsErrors,
  oauthFailure, readAdsAccount, readAdsCampaigns, readAdsClick,
} from '../../shared/google-ads'
import type { CmsModuleDefinition, ModuleSettings } from '../utils/modules'

/**
 * Google Ads, en lecture : dépense et résultats des campagnes, rapprochés des contacts enregistrés par le site
 * (voir `shared/google-ads.ts`). Rien n'est modifié dans le compte Google Ads.
 */

class AdsError extends Error {
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

async function accessToken(event: H3Event, settings: ModuleSettings) {
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

/** Une requête GAQL sur le compte réglé ; toutes les pages de la réponse (10 000 lignes par page, 5 pages au plus). */
async function search(event: H3Event, settings: ModuleSettings, query: string): Promise<unknown[]> {
  const token = await accessToken(event, settings)
  const login = adsCustomerId(settings.loginCustomerId)
  const pages: unknown[] = []
  let pageToken: string | undefined
  for (let i = 0; i < 5; i++) {
    const response = await fetch(`${apiUrl(event)}/customers/${adsCustomerId(settings.customerId)}/googleAds:search`, {
      method: 'POST',
      headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json', 'accept': 'application/json', ...(login ? { 'login-customer-id': login } : {}) },
      body: JSON.stringify({ query, ...(pageToken ? { pageToken } : {}) }),
      signal: AbortSignal.timeout(15_000),
    }).catch(unreachable('Google Ads'))
    const body = await response.json().catch(() => null) as { nextPageToken?: string } | null
    if (!response.ok) {
      // Jeton d'accès refusé alors qu'il venait de la mémoire : il sera redemandé au prochain appel.
      if (response.status === 401) tokens.clear()
      throw new AdsError(adsFailure(response.status, body))
    }
    pages.push(body)
    pageToken = body?.nextPageToken
    if (!pageToken) break
  }
  return pages
}

async function account(event: H3Event, settings: ModuleSettings): Promise<AdsAccount> {
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
  description: 'Ce que coûtent les campagnes Google Ads et ce qu\'elles rapportent : dépense, clics, et contacts du site (messages, paiements) venus des annonces, campagne par campagne. Lecture seule : rien n\'est modifié dans Google Ads.',
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
      help: 'Obtenu une fois, en se connectant avec un compte Google qui a accès au compte Google Ads, pour l\'autorisation « https://www.googleapis.com/auth/adwords » (voir le README du site). Il ne donne ici qu\'un accès en lecture aux statistiques.',
      env: { key: 'googleAdsRefreshToken', name: 'NUXT_GOOGLE_ADS_REFRESH_TOKEN' },
    },
  ],
  adminPage: { to: '/admin/google-ads', label: 'Voir les annonces' },
  validate: googleAdsSettingsErrors,

  async test(event, settings) {
    const invalid = Object.values(googleAdsSettingsErrors(settings))
    if (invalid.length) throw new Error(invalid.join(' '))
    tokens.clear()
    cache.clear()
    const found = await account(event, settings)
    return `Connexion réussie au compte Google Ads « ${found.name || adsCustomerId(settings.customerId)} » (${found.currency}).`
  },
}

// ───────────── Rapport de l'écran « Annonces Google » ─────────────

/** Les chiffres de Google sont gardés cinq minutes en mémoire (voir la même réserve dans ./audience.ts). */
const CACHE_MS = 5 * 60_000
const cache = new Map<string, { at: number; account: AdsAccount; campaigns: AdsCampaign[]; from: string; to: string }>()

export type AdsAnswer =
  | { state: 'ok'; account: AdsAccount; from: string; to: string; report: AdsReport; updatedAt: string }
  | { state: 'unconfigured' | 'refused' | 'unavailable'; message: string }

type LeadRow = { table: 'message' | 'payment'; id: string; origin: StoredOrigin | null; createdAt: Date; amount?: number }

/** Messages et paiements réussis de la période venus de Google Ads. */
async function leadRows(event: H3Event, since: Date): Promise<LeadRow[]> {
  const db = useDb(event)
  const { formSubmissions, payments } = schema
  const [messages, paid] = await Promise.all([
    db.select({ id: formSubmissions.id, origin: formSubmissions.origin, createdAt: formSubmissions.createdAt }).from(formSubmissions).where(gte(formSubmissions.createdAt, since)),
    db.select({ id: payments.id, origin: payments.origin, createdAt: payments.createdAt, amount: payments.amount, refunded: payments.refundedAmount }).from(payments)
      .where(and(gte(payments.createdAt, since), eq(payments.status, 'paid'), eq(payments.livemode, true))),
  ])
  return [
    ...messages.map(m => ({ table: 'message' as const, ...m })),
    ...paid.map(p => ({ table: 'payment' as const, id: p.id, origin: p.origin, createdAt: p.createdAt, amount: p.amount - p.refunded })),
  ].filter(r => r.origin?.channel === 'google-ads')
}

/** Recherches de clic faites par affichage du rapport : chacune est un appel à Google, compté dans le quota du jour. */
const MAX_CLICK_LOOKUPS = 15

/**
 * Retrouve la campagne des contacts qui n'ont qu'un `gclid` (cas le plus courant : le balisage automatique de Google
 * Ads, sans suffixe d'URL), et l'enregistre avec le contact pour ne plus la redemander. Un clic introuvable alors
 * qu'il date de plus d'un jour est marqué comme cherché. Les erreurs sont ignorées : le rapport s'affiche quand même.
 */
async function resolveClicks(event: H3Event, settings: ModuleSettings, rows: LeadRow[], timeZone: string) {
  const now = Date.now()
  const todo = rows.filter((r) => {
    const o = r.origin!
    return o.click === 'gclid' && o.clickId && !o.campaignId && !o.clickChecked && now - (o.at ?? r.createdAt.getTime()) < ADS_CLICK_LOOKBACK_DAYS * 86_400_000
  }).slice(0, MAX_CLICK_LOOKUPS)
  const db = useDb(event)
  await Promise.all(todo.map(async (row) => {
    const origin = row.origin!
    const at = origin.at ?? row.createdAt.getTime()
    const query = adsClickQuery(origin.clickId!, dayIn(timeZone, at))
    try {
      const found = query ? readAdsClick((await search(event, settings, query))[0]) : null
      if (!found && query && now - at < 86_400_000) return
      const next: StoredOrigin = found ? { ...origin, campaignId: found.campaignId, campaign: origin.campaign ?? (found.campaignName || undefined) } : { ...origin, clickChecked: true }
      row.origin = next
      if (row.table === 'message') await db.update(schema.formSubmissions).set({ origin: next }).where(eq(schema.formSubmissions.id, row.id))
      else await db.update(schema.payments).set({ origin: next }).where(eq(schema.payments.id, row.id))
    }
    catch (error) {
      if (!(error instanceof AdsError)) console.error('[cms] google ads : campagne du clic introuvable', error)
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
    const leads: AdsLead[] = rows.map(r => ({ kind: r.table, origin: r.origin, amount: r.amount }))
    return { state: 'ok', account: hit.account, from: hit.from, to: hit.to, report: buildAdsReport(hit.campaigns, leads), updatedAt: new Date(hit.at).toISOString() }
  }
  catch (error) {
    if (error instanceof AdsError) return { state: error.failure.kind, message: error.failure.message }
    console.error('[cms] google ads : lecture impossible', error)
    return { state: 'unavailable', message: 'Les chiffres de Google Ads n\'ont pas pu être lus pour le moment.' }
  }
}

/** L'écran « Annonces Google » (dépenses comprises) est ouvert aux administrateurs et aux éditeurs. */
export const canReadGoogleAds = (user: { role: string }) => user.role === 'admin' || user.role === 'editor'
