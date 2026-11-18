import { eq } from 'drizzle-orm'

/** Retire une demande de publication : par la personne qui l'a faite, ou par quelqu'un qui peut publier ce contenu. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const type = getRouterParam(event, 'type')!
  const id = getRouterParam(event, 'id')!
  assertAccess(user, type, 'edit')
  const db = useDb(event)
  const { reviewRequests } = schema
  const [request] = await db.select().from(reviewRequests).where(eq(reviewRequests.entryId, id))
  if (!request || request.type !== type) return { ok: true }
  if (request.requestedBy !== user.id && !can(user, type, 'publish'))
    throw createError({ statusCode: 403, message: 'Seule la personne qui a fait la demande, ou quelqu\'un qui peut publier, peut la retirer.' })
  await db.delete(reviewRequests).where(eq(reviewRequests.entryId, id))
  return { ok: true }
})
