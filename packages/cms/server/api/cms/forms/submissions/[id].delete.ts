import { eq } from 'drizzle-orm'
import { requireSubmissionsAccess } from '../../../../cms-modules/forms'

/** Supprime définitivement un message reçu. */
export default defineEventHandler(async (event) => {
  await requireSubmissionsAccess(event)
  await useDb(event).delete(schema.formSubmissions).where(eq(schema.formSubmissions.id, getRouterParam(event, 'id')!))
  return { ok: true }
})
