import { and, eq, gte, isNotNull } from 'drizzle-orm'
import type { H3Event } from 'h3'
import type { StoredOrigin } from '../../shared/attribution'
import {
  CONVERSION_ACTIONS_QUERY, CONVERSION_BATCH, CONVERSION_MAX_AGE_DAYS, type ConversionAction, type ConversionState,
  conversionAfter, conversionCounts, conversionEligible, conversionStep, ingestOutcome, ingestRequest, isConversionActionId, readConversionActions,
} from '../../shared/conversions'
import { adsCustomerId, googleAdsReady } from '../../shared/google-ads'
import type { ModuleSettings } from '../utils/modules'
import { AdsError, accessToken, account, search } from './google-ads'

/**
 * Conversions envoyées à Google Ads (voir `shared/conversions.ts`) : les contacts du site venus d'une annonce, avec
 * l'accord du visiteur, sont mis en attente à leur arrivée puis envoyés par la tâche planifiée du site.
 */

type Kind = 'message' | 'payment'
const SETTING: Record<Kind, 'messageConversion' | 'paymentConversion'> = { message: 'messageConversion', payment: 'paymentConversion' }

/** Adresse de la Data Manager API. Ne se change que pour les tests : NUXT_GOOGLE_DATA_MANAGER_URL. */
const ingestUrl = (event: H3Event) => `${String(useRuntimeConfig(event).googleDataManagerUrl).replace(/\/$/, '')}/events:ingest`

/** Réglages du module, s'il est actif et réglé ; sinon null. */
async function readySettings(event: H3Event): Promise<ModuleSettings | null> {
  if (!(await activeModule(event, 'google-ads'))) return null
  const settings = await moduleSettings(event, 'google-ads')
  return googleAdsReady(settings) ? settings : null
}

/**
 * L'état à enregistrer avec un nouveau contact : « en attente » s'il doit être signalé à Google, sinon null.
 * Il faut un clic Google, l'accord du visiteur, et une action de conversion réglée pour ce type de contact
 * au moment où il arrive (un réglage fait plus tard ne renvoie pas les contacts passés).
 */
export async function conversionForLead(event: H3Event, kind: Kind, origin: StoredOrigin | null): Promise<ConversionState | null> {
  if (!conversionEligible(origin)) return null
  const settings = await readySettings(event).catch(() => null)
  return settings && isConversionActionId(settings[SETTING[kind]]) ? { state: 'pending' } : null
}

type Lead = { kind: Kind; id: string; origin: StoredOrigin | null; createdAt: Date; conversion: ConversionState | null; amount?: number; currency?: string }

async function leads(event: H3Event): Promise<Lead[]> {
  const db = useDb(event)
  const { formSubmissions, payments } = schema
  const since = new Date(Date.now() - (CONVERSION_MAX_AGE_DAYS + 2) * 86_400_000)
  const [messages, paid] = await Promise.all([
    db.select({ id: formSubmissions.id, origin: formSubmissions.origin, createdAt: formSubmissions.createdAt, conversion: formSubmissions.conversion })
      .from(formSubmissions).where(and(gte(formSubmissions.createdAt, since), isNotNull(formSubmissions.conversion))),
    db.select({ id: payments.id, origin: payments.origin, createdAt: payments.createdAt, conversion: payments.conversion, amount: payments.amount, refunded: payments.refundedAmount, currency: payments.currency, status: payments.status })
      .from(payments).where(and(gte(payments.createdAt, since), isNotNull(payments.conversion))),
  ])
  return [
    ...messages.map(m => ({ kind: 'message' as const, ...m })),
    // Un paiement remboursé ou échoué entre-temps n'est plus signalé.
    ...paid.filter(p => p.status === 'paid').map(p => ({ kind: 'payment' as const, id: p.id, origin: p.origin, createdAt: p.createdAt, conversion: p.conversion, amount: p.amount - p.refunded, currency: p.currency })),
  ]
}

async function store(event: H3Event, lead: Lead, conversion: ConversionState) {
  const db = useDb(event)
  if (lead.kind === 'message') await db.update(schema.formSubmissions).set({ conversion }).where(eq(schema.formSubmissions.id, lead.id))
  else await db.update(schema.payments).set({ conversion }).where(eq(schema.payments.id, lead.id))
}

/** Dernier problème de réglage rencontré à l'envoi (en mémoire), montré à l'administrateur dans « Annonces Google ». */
let configProblem: { at: number; message: string } | null = null

/**
 * Envoie à Google les contacts en attente dont le clic est assez ancien. Appelé par la tâche planifiée du site
 * (toutes les cinq minutes). Un contact par demande : Google rejette toute une demande pour un seul contact refusé.
 * Renvoie ce qui a été fait, pour le journal et les tests.
 */
export async function sendPendingConversions(event: H3Event, now = Date.now()) {
  const done = { sent: 0, failed: 0, retried: 0, expired: 0, stopped: null as string | null }
  const settings = await readySettings(event)
  if (!settings) return done
  const due: Lead[] = []
  for (const lead of await leads(event)) {
    const step = conversionStep({ origin: lead.origin, createdAt: lead.createdAt.getTime(), conversion: lead.conversion }, now)
    if (step === 'expire') { await store(event, lead, { state: 'expired', at: now }); done.expired++ }
    else if (step === 'send' && isConversionActionId(settings[SETTING[lead.kind]])) due.push(lead)
  }
  if (!due.length) return done
  try {
    const token = await accessToken(event, settings)
    // Le compte qui possède les actions de conversion : celui-ci, ou son compte administrateur (suivi fait à ce niveau).
    const owner = (await account(event, settings)).conversionCustomer || adsCustomerId(settings.customerId)
    const login = adsCustomerId(settings.loginCustomerId) || undefined
    for (const lead of due.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).slice(0, CONVERSION_BATCH)) {
      const body = ingestRequest(
        { id: lead.id, origin: lead.origin!, at: lead.createdAt.getTime(), ...(lead.kind === 'payment' ? { amount: lead.amount, currency: lead.currency } : {}) },
        { account: owner, login, action: settings[SETTING[lead.kind]]!.trim() },
      )
      const response = await fetch(ingestUrl(event), {
        method: 'POST',
        headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json', 'accept': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      }).catch(() => null)
      const outcome = response ? ingestOutcome(response.status, await response.json().catch(() => null)) : { kind: 'retry' as const, message: 'Google est injoignable pour le moment.' }
      await store(event, lead, conversionAfter(lead.conversion!, outcome, now))
      if (outcome.kind === 'sent') { done.sent++; configProblem = null }
      else if (outcome.kind === 'failed') done.failed++
      else if (outcome.kind === 'retry') done.retried++
      else {
        // Réglage en cause : inutile de présenter les autres contacts, ils resteront en attente.
        configProblem = { at: now, message: outcome.message }
        done.stopped = outcome.message
        break
      }
    }
  }
  catch (error) {
    if (!(error instanceof AdsError)) throw error
    configProblem = { at: now, message: error.failure.message }
    done.stopped = error.failure.message
  }
  return done
}

export type ConversionsOverview = {
  /** Actions de conversion du compte qui acceptent un envoi, avec leur numéro (à recopier dans les réglages). */
  actions: ConversionAction[]
  /** Numéros réglés pour les messages et les paiements ; null : rien n'est envoyé pour ce type de contact. */
  message: string | null
  payment: string | null
  counts: ReturnType<typeof conversionCounts>
  /** Ce qui empêche les envois en ce moment, s'il y a lieu. */
  problem: string | null
}

/** Ce que l'administrateur voit des conversions dans « Annonces Google ». Les erreurs de lecture ne bloquent pas l'écran. */
export async function conversionsOverview(event: H3Event): Promise<ConversionsOverview | null> {
  const settings = await readySettings(event)
  if (!settings) return null
  const picked = (kind: Kind) => (isConversionActionId(settings[SETTING[kind]]) ? settings[SETTING[kind]]!.trim() : null)
  let actions: ConversionAction[] = []
  // Un problème de réglage vu au dernier envoi reste affiché jusqu'au prochain envoi réussi (cinq minutes au plus après la correction).
  let problem = configProblem?.message ?? null
  try { actions = readConversionActions(await search(event, settings, CONVERSION_ACTIONS_QUERY)) }
  catch (error) { if (error instanceof AdsError) problem ??= error.failure.message; else throw error }
  const message = picked('message'), payment = picked('payment')
  for (const id of [message, payment]) {
    if (id && actions.length && !actions.some(a => a.id === id)) problem ??= `L'action de conversion n° ${id} n'existe pas dans ce compte, ou n'est pas de type « Importation depuis les clics ».`
  }
  return { actions, message, payment, counts: conversionCounts(await leads(event)), problem }
}

