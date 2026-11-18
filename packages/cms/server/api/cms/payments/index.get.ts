import { desc } from 'drizzle-orm'
import { requirePaymentsAccess } from '../../../cms-modules/stripe'

/** Paiements reçus par Stripe, du plus récent au plus ancien (les 1000 derniers). Administrateur et éditeur. */
export default defineEventHandler(async (event) => {
  await requirePaymentsAccess(event)
  const payments = await useDb(event).select().from(schema.payments).orderBy(desc(schema.payments.createdAt)).limit(1000)
  return { payments }
})
