import { eq } from 'drizzle-orm'
import { requireSubmissionsAccess } from '../../../../cms-modules/forms'

/** Marque un message comme lu ou non lu. */
export default defineEventHandler(async (event) => {
  await requireSubmissionsAccess(event)
  const body = await readBody<{ read?: unknown }>(event)
  const [row] = await useDb(event).update(schema.formSubmissions).set({ read: body?.read !== false })
    .where(eq(schema.formSubmissions.id, getRouterParam(event, 'id')!)).returning()
  if (!row) throw createError({ statusCode: 404, message: 'Message introuvable.' })
  return row
})
