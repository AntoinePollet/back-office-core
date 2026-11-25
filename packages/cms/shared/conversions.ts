/**
 * Conversions envoyées à Google Ads : un contact du site (message reçu, paiement réussi) venu d'une annonce est
 * signalé à Google, qui peut alors dire quelle campagne et quel mot-clé l'ont amené, et régler ses enchères dessus.
 *
 * Seuls partent les contacts qui portent un identifiant de clic Google (`gclid`, `gbraid`, `wbraid`) ET l'accord du
 * visiteur pour la mesure de la publicité (module `consent`). Ce qui part : l'identifiant de clic, la date du contact,
 * son montant pour un paiement, et un identifiant interne qui évite les doublons. Ni nom, ni e-mail, ni message.
 *
 * L'envoi passe par la « Data Manager API » de Google (`events:ingest`) : depuis juin 2026, l'ancien envoi par
 * l'API Google Ads (`uploadClickConversions`) est fermé aux nouvelles intégrations. Le jeton d'actualisation doit
 * donc porter l'autorisation `https://www.googleapis.com/auth/datamanager` en plus de celle de Google Ads.
 *
 * Google ne connaît un clic que quelques heures après : un contact est mis en attente, envoyé par la tâche planifiée
 * du site, et réessayé si Google n'est pas joignable. Ce fichier porte la logique pure ; les appels sont dans
 * `server/cms-modules/google-conversions.ts`.
 */
import type { StoredOrigin } from './attribution'

/** Où en est l'envoi d'un contact, enregistré avec lui. */
export type ConversionState = {
  /** `pending` : à envoyer ; `sent` : accepté par Google ; `failed` : refusé ; `expired` : clic trop ancien. */
  state: 'pending' | 'sent' | 'failed' | 'expired'
  /** Dernière tentative, ou moment de l'envoi (millisecondes). */
  at?: number
  /** Tentatives sans réponse utilisable de Google. */
  tries?: number
  /** Pourquoi Google a refusé, ou ce qui a empêché le dernier essai. */
  error?: string
  /** Référence de la demande chez Google, pour un diagnostic. */
  requestId?: string
}

const GOOGLE_CLICKS = ['gclid', 'gbraid', 'wbraid'] as const
/** Délai après le clic avant le premier envoi : Google ne connaît pas un clic plus récent. */
export const CONVERSION_WAIT_MS = 6 * 3_600_000
/** Délai entre deux essais quand Google n'a pas répondu. */
export const CONVERSION_RETRY_MS = 3_600_000
/** Au-delà de ce nombre d'essais sans réponse, l'envoi est abandonné. */
export const CONVERSION_MAX_TRIES = 48
/** Âge maximal d'un clic pour Google (fenêtre de conversion la plus longue). */
export const CONVERSION_MAX_AGE_DAYS = 90
/** Contacts envoyés par passage de la tâche planifiée. */
export const CONVERSION_BATCH = 20

/** Ce contact peut-il être signalé à Google ? Il faut un clic Google et l'accord du visiteur. */
export const conversionEligible = (origin: StoredOrigin | null | undefined): origin is StoredOrigin =>
  !!origin && origin.consent === true && !!origin.clickId && (GOOGLE_CLICKS as readonly unknown[]).includes(origin.click)

/** Un contact en attente, tel que le serveur le lit : le clic, la date du contact, et l'état de l'envoi. */
export type PendingLead = { origin: StoredOrigin | null; createdAt: number; conversion: ConversionState | null }

/**
 * Que faire d'un contact en attente à cet instant : l'envoyer, attendre (clic trop récent, ou essai trop proche du
 * précédent), ou l'abandonner (clic de plus de 90 jours). Null : rien à faire pour ce contact.
 */
export function conversionStep(lead: PendingLead, now = Date.now()): 'send' | 'wait' | 'expire' | null {
  if (lead.conversion?.state !== 'pending' || !conversionEligible(lead.origin)) return null
  const clickAt = lead.origin.at ?? lead.createdAt
  if (now - clickAt > CONVERSION_MAX_AGE_DAYS * 86_400_000) return 'expire'
  if (now - clickAt < CONVERSION_WAIT_MS) return 'wait'
  if (lead.conversion.at && now - lead.conversion.at < CONVERSION_RETRY_MS) return 'wait'
  return 'send'
}

/** Identifiant d'une action de conversion Google Ads : des chiffres. */
export const isConversionActionId = (value: unknown): value is string => typeof value === 'string' && /^\d{1,20}$/.test(value.trim())

export type ConversionEvent = {
  /** Identifiant interne du contact : Google s'en sert pour ne pas compter deux fois le même. */
  id: string
  origin: StoredOrigin
  /** Date du contact (millisecondes). */
  at: number
  /** Montant d'un paiement, en plus petite unité de la devise (centimes), et sa devise. */
  amount?: number
  currency?: string
}

/** Devises sans décimales chez Stripe : le montant y est déjà en unités. */
const ZERO_DECIMAL = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf'])

/**
 * Corps de la demande `events:ingest` de la Data Manager API pour un contact. `account` : le compte Google Ads qui
 * possède l'action de conversion ; `login` : le compte administrateur par lequel on y accède, s'il y en a un.
 * L'accord transmis est celui que le visiteur a donné : la mesure de la publicité, pas la personnalisation.
 */
export function ingestRequest(event: ConversionEvent, target: { account: string; login?: string; action: string }) {
  const { origin } = event
  const account = (accountId: string) => ({ accountId, accountType: 'GOOGLE_ADS' })
  const currency = (event.currency ?? '').toLowerCase()
  return {
    destinations: [{ operatingAccount: account(target.account), ...(target.login ? { loginAccount: account(target.login) } : {}), productDestinationId: target.action }],
    events: [{
      adIdentifiers: { [origin.click as 'gclid' | 'gbraid' | 'wbraid']: origin.clickId },
      eventTimestamp: new Date(event.at).toISOString(),
      transactionId: event.id,
      ...(event.amount !== undefined && currency ? { conversionValue: ZERO_DECIMAL.has(currency) ? event.amount : event.amount / 100, currency: currency.toUpperCase() } : {}),
      consent: { adUserData: 'CONSENT_GRANTED', adPersonalization: 'CONSENT_DENIED' },
    }],
  }
}

/**
 * Ce que la réponse de Google veut dire pour le contact :
 * - `sent` : accepté ;
 * - `failed` : ce contact est refusé pour de bon (identifiant de clic illisible…) ;
 * - `retry` : Google n'a pas pu répondre, à réessayer plus tard ;
 * - `config` : le réglage du module est en cause (jeton, autorisation, action de conversion) : tous les envois
 *   s'arrêtent jusqu'à sa correction, et aucun contact n'est perdu.
 */
export type IngestOutcome = { kind: 'sent'; requestId?: string } | { kind: 'failed' | 'retry' | 'config'; message: string }

export function ingestOutcome(status: number, body: unknown): IngestOutcome {
  const answer = (body ?? {}) as { requestId?: string; error?: { message?: string; status?: string } }
  if (status >= 200 && status < 300) return { kind: 'sent', ...(answer.requestId ? { requestId: String(answer.requestId).slice(0, 100) } : {}) }
  const raw = JSON.stringify(body ?? '')
  const detail = String(answer.error?.message ?? '').slice(0, 200)
  if (status === 429 || status >= 500) return { kind: 'retry', message: 'Google n\'a pas pu traiter la demande pour le moment.' }
  if (raw.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT') || raw.includes('insufficient authentication scopes')) {
    return { kind: 'config', message: 'Le jeton d\'actualisation n\'a pas l\'autorisation d\'envoyer des conversions : recréez-le en cochant aussi « https://www.googleapis.com/auth/datamanager ».' }
  }
  if (raw.includes('SERVICE_DISABLED') || raw.includes('has not been used')) return { kind: 'config', message: 'La « Data Manager API » n\'est pas activée dans le projet Google Cloud du client OAuth.' }
  if (status === 401) return { kind: 'config', message: 'Google refuse le jeton : vérifiez le client OAuth et le jeton d\'actualisation.' }
  if (status === 403) return { kind: 'config', message: `Google refuse l'envoi de conversions pour ce compte${detail ? ` : ${detail}` : '.'}` }
  if (status === 404 || /destination|productDestinationId|operatingAccount|loginAccount/i.test(detail)) {
    return { kind: 'config', message: `Google ne reconnaît pas le compte ou l'action de conversion${detail ? ` : ${detail}` : '.'}` }
  }
  return { kind: 'failed', message: detail || `Google a refusé ce contact (${status}).` }
}

/** L'état d'un contact après un essai. */
export function conversionAfter(before: ConversionState, outcome: IngestOutcome, now = Date.now()): ConversionState {
  if (outcome.kind === 'sent') return { state: 'sent', at: now, ...(outcome.requestId ? { requestId: outcome.requestId } : {}) }
  if (outcome.kind === 'failed') return { state: 'failed', at: now, error: outcome.message }
  // Réglage en cause : le contact reste en attente, sans compter un essai (il partira une fois le réglage corrigé).
  if (outcome.kind === 'config') return { ...before, state: 'pending', error: outcome.message }
  const tries = (before.tries ?? 0) + 1
  return tries >= CONVERSION_MAX_TRIES
    ? { state: 'failed', at: now, tries, error: 'Google n\'a pas répondu après de nombreux essais.' }
    : { state: 'pending', at: now, tries, error: outcome.message }
}

/** Libellé de l'état, pour le détail d'un message ou d'un paiement. */
export function conversionLabel(conversion: ConversionState | null | undefined): string | null {
  if (!conversion) return null
  const when = conversion.at ? ` le ${new Date(conversion.at).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })}` : ''
  if (conversion.state === 'sent') return `signalé à Google Ads${when}`
  if (conversion.state === 'failed') return `refusé par Google Ads${conversion.error ? ` : ${conversion.error}` : ''}`
  if (conversion.state === 'expired') return 'non signalé : le clic sur l\'annonce datait de plus de 90 jours'
  return conversion.error ? `en attente : ${conversion.error}` : 'en attente d\'envoi à Google Ads (quelques heures après le clic)'
}

/** Comptes des envois, pour l'écran « Annonces Google ». */
export function conversionCounts(rows: { conversion: ConversionState | null }[]) {
  const counts = { pending: 0, sent: 0, failed: 0, expired: 0 }
  for (const r of rows) if (r.conversion && r.conversion.state in counts) counts[r.conversion.state]++
  return counts
}

// ───────────────────────── Actions de conversion du compte ─────────────────────────

/** Actions de conversion « importation depuis les clics », les seules qui acceptent un envoi. */
export const CONVERSION_ACTIONS_QUERY = 'SELECT conversion_action.id, conversion_action.name, conversion_action.status FROM conversion_action '
  + 'WHERE conversion_action.type = \'UPLOAD_CLICKS\' AND conversion_action.status = \'ENABLED\''

export type ConversionAction = { id: string; name: string }
export function readConversionActions(pages: unknown[]): ConversionAction[] {
  return pages.flatMap(page => ((page as { results?: any[] } | null)?.results ?? []))
    .map(row => ({ id: String(row?.conversionAction?.id ?? ''), name: String(row?.conversionAction?.name ?? '') }))
    .filter(a => a.id)
}
