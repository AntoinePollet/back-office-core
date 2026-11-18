import { verifyStripeSignature } from '../../../shared/stripe'
import { applyStripeEvent } from '../../cms-modules/stripe'

/**
 * Webhook Stripe : seule source de vérité sur l'issue d'un paiement (jamais le retour du visiteur sur la page de succès).
 * Chaque événement est authentifié par sa signature (secret du webhook, date de signature à 5 minutes près) avant
 * d'être lu. Réponse 400 si la signature est refusée : Stripe le montre dans son tableau de bord et réessaie.
 */
export default defineEventHandler(async (event) => {
  requireModule('stripe')
  // Corps brut, tel que Stripe l'a signé : le relire comme JSON puis le réécrire changerait la signature.
  const body = (await readRawBody(event, 'utf8')) ?? ''
  if (body.length > 1_000_000) throw createError({ statusCode: 413, message: 'Événement trop gros.' })
  const { webhookSecret } = await moduleSettings(event, 'stripe')
  if (!webhookSecret) throw createError({ statusCode: 503, message: 'Secret du webhook non réglé.' })

  const verified = await verifyStripeSignature(body, getRequestHeader(event, 'stripe-signature'), webhookSecret)
  if (!verified.ok) {
    console.warn('[stripe] webhook refusé :', verified.reason)
    throw createError({ statusCode: 400, message: `Webhook refusé : ${verified.reason}.` })
  }
  let parsed: { id?: string; type?: string; data?: { object?: Record<string, unknown> } }
  try { parsed = JSON.parse(body) }
  catch { throw createError({ statusCode: 400, message: 'Événement illisible.' }) }

  const result = await applyStripeEvent(event, parsed)
  return { received: true, result }
})
