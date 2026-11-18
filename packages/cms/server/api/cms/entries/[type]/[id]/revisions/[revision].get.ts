import { and, eq } from 'drizzle-orm'

/** Une version de l'historique, avec ce que le contenu contenait à ce moment-là. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const type = getRouterParam(event, 'type')!
  assertAccess(user, type, 'edit')
  await assertOwnEntry(event, user, type, getRouterParam(event, 'id')!)
  const { revisions } = schema
  const [revision] = await useDb(event).select().from(revisions).where(and(
    eq(revisions.id, getRouterParam(event, 'revision')!), eq(revisions.entryId, getRouterParam(event, 'id')!), eq(revisions.type, type),
  ))
  if (!revision) throw createError({ statusCode: 404, message: 'Version introuvable.' })
  return { id: revision.id, version: revision.version, createdAt: revision.createdAt, author: revision.authorName, snapshot: revision.snapshot }
})
