import { and, eq } from 'drizzle-orm'

/**
 * Demande de publication : la personne signale que son brouillon est prêt, pour quelqu'un qui a le droit de publier.
 * Corps : { note?: string }. Une seule demande par contenu : une nouvelle remplace la précédente.
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const type = getRouterParam(event, 'type')!
  const id = getRouterParam(event, 'id')!
  const def = getDef(type)
  assertAccess(user, type, 'edit')
  if (!def.drafts) throw createError({ statusCode: 400, message: 'Ce contenu n\'a pas de brouillon : il n\'y a rien à faire publier.' })

  const db = useDb(event)
  const { entries, entryLocales, reviewRequests } = schema
  const [entry] = await db.select().from(entries).where(and(eq(entries.id, id), eq(entries.type, type)))
  if (!entry) throw createError({ statusCode: 404, message: 'Contenu introuvable.' })
  assertEntryAccess(user, type, entry, 'edit')
  const rows = await db.select({ status: entryLocales.status }).from(entryLocales).where(eq(entryLocales.entryId, id))
  if (!rows.some(r => r.status !== 'published')) throw createError({ statusCode: 400, message: 'Tout est déjà en ligne : il n\'y a rien à faire publier.' })

  const { note } = await readBody<{ note?: unknown }>(event) ?? {}
  const text = typeof note === 'string' ? note.trim().slice(0, 500) : ''
  const request = { entryId: id, type, requestedBy: user.id, requestedByName: user.name, note: text || null, createdAt: new Date() }
  const { entryId: _id, ...set } = request
  await db.insert(reviewRequests).values(request).onConflictDoUpdate({ target: reviewRequests.entryId, set })

  const title = (await entryTitles(event, [id])).get(id) ?? def.label
  emitCmsEvents(event, [{ name: 'entry.review_requested', type, id, title, note: text, requester: user.name, user: { id: user.id, email: user.email } }])
  return { review: { by: user.name, byId: user.id, note: request.note, at: request.createdAt } }
})
