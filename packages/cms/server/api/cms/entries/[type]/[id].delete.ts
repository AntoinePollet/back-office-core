import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const type = getRouterParam(event, 'type')!
  const id = getRouterParam(event, 'id')!
  assertCanEdit(getDef(type), user)
  if (getDef(type).kind !== 'collection') throw createError({ statusCode: 400, message: 'Un singleton ne se supprime pas.' })

  const db = useDb(event)
  const [entry] = await db.select({ id: schema.entries.id }).from(schema.entries).where(and(eq(schema.entries.id, id), eq(schema.entries.type, type)))
  if (!entry) throw createError({ statusCode: 404, message: 'Contenu introuvable.' })
  const title = (await entryTitles(event, [id])).get(id) ?? 'Sans titre'
  await db.batch([
    db.delete(schema.redirects).where(eq(schema.redirects.entryId, id)),
    db.delete(schema.revisions).where(eq(schema.revisions.entryId, id)),
    db.delete(schema.entryLocales).where(eq(schema.entryLocales.entryId, id)),
    db.delete(schema.entries).where(eq(schema.entries.id, id)),
  ])
  const purged = await purgeSiteCache(event)
  emitCmsEvents(event, [{ name: 'entry.deleted', type, id, title, user: { id: user.id, email: user.email } }])
  return { ok: true, purgeFailed: !purged }
})
