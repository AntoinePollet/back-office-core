import { invoicePdfUrl, requirePaymentsAccess } from '../../../../cms-modules/stripe'

/** Facture d'un paiement : conduit au PDF établi par Stripe. Administrateur et éditeur. */
export default defineEventHandler(async (event) => {
  await requirePaymentsAccess(event)
  return sendRedirect(event, await invoicePdfUrl(event, getRouterParam(event, 'id')!), 302)
})
