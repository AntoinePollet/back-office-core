import { eq } from 'drizzle-orm'
import { formatAmount } from '../../../../shared/stripe'

/**
 * État d'un paiement pour la page de succès du site (`?session_id=cs_…`). Route publique : l'identifiant de session,
 * long et imprévisible, n'est connu que de l'acheteur. Ne renvoie ni e-mail ni adresse.
 * `pending` tant que l'événement signé de Stripe n'est pas arrivé : la page ne doit pas annoncer un paiement confirmé.
 */
export default defineEventHandler(async (event) => {
  await requireModule(event, 'stripe')
  const id = getRouterParam(event, 'id') ?? ''
  if (!/^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(id)) throw createError({ statusCode: 404, message: 'Paiement introuvable.' })
  const [row] = await useDb(event).select().from(schema.payments).where(eq(schema.payments.sessionId, id))
  if (!row) return { status: 'pending' as const, product: null, quantity: null, amount: null }
  return {
    status: row.status === 'paid' || row.status === 'refunded' ? row.status : row.status === 'failed' ? 'failed' as const : 'pending' as const,
    product: row.title,
    quantity: row.quantity,
    amount: formatAmount(row.amount, row.currency),
  }
})
