import { and, desc, eq } from 'drizzle-orm'

/** Historique d'un contenu, de la version la plus récente à la plus ancienne (sans le détail des valeurs). */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const type = getRouterParam(event, 'type')!
  assertAccess(user, type, 'edit')
  await assertOwnEntry(event, user, type, getRouterParam(event, 'id')!)
  const { revisions } = schema
  return useDb(event).select({
    id: revisions.id, version: revisions.version, createdAt: revisions.createdAt, author: revisions.authorName,
    changed: revisions.changed, published: revisions.published, unpublished: revisions.unpublished, origin: revisions.origin,
  }).from(revisions)
    .where(and(eq(revisions.entryId, getRouterParam(event, 'id')!), eq(revisions.type, type)))
    .orderBy(desc(revisions.version), desc(revisions.createdAt))
})
