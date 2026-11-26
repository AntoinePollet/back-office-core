import { eq } from 'drizzle-orm'
import { findError } from '../../../../../cms-modules/monitoring'

/** Marque une erreur comme corrigée, ou la rouvre : `{ resolved: true | false }`. Elle se rouvre seule si elle se reproduit. */
export default defineEventHandler(async (event) => {
  await requireModule(event, 'monitoring')
  await requireAdmin(event)
  const row = await findError(event, getRouterParam(event, 'id')!)
  const body = await readBody<{ resolved?: unknown }>(event).catch(() => null)
  const resolvedAt = body?.resolved === false ? null : new Date()
  await useDb(event).update(schema.errors).set({ resolvedAt }).where(eq(schema.errors.id, row.id))
  return { id: row.id, resolvedAt }
})
