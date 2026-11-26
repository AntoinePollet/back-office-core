import { desc } from 'drizzle-orm'
import { requirePaymentsAccess } from '../../../cms-modules/stripe'

/** Paiements reçus par Stripe et abonnements souscrits, du plus récent au plus ancien (les 1000 derniers). Administrateur et éditeur. */
export default defineEventHandler(async (event) => {
  await requirePaymentsAccess(event)
  const db = useDb(event)
  const [payments, subscriptions] = await Promise.all([
    db.select().from(schema.payments).orderBy(desc(schema.payments.createdAt)).limit(1000),
    db.select().from(schema.subscriptions).orderBy(desc(schema.subscriptions.createdAt)).limit(1000),
  ])
  return { payments, subscriptions }
})
