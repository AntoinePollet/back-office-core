import { cancelSubscription } from '../../../../cms-modules/stripe'

/** Demande la résiliation d'un abonnement à la fin de la période payée. Administrateur seulement. */
export default defineEventHandler(async (event) => {
  await requireModule(event, 'stripe')
  const user = await requireAdmin(event)
  return cancelSubscription(event, user, getRouterParam(event, 'id')!)
})
