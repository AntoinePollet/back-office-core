import { eq } from 'drizzle-orm'
import { findError } from '../../../../../cms-modules/monitoring'

/** Efface une erreur de la liste. Si elle se reproduit, elle reviendra comme une erreur nouvelle. */
export default defineEventHandler(async (event) => {
  await requireModule(event, 'monitoring')
  await requireAdmin(event)
  const row = await findError(event, getRouterParam(event, 'id')!)
  await useDb(event).delete(schema.errors).where(eq(schema.errors.id, row.id))
  return { ok: true }
})
