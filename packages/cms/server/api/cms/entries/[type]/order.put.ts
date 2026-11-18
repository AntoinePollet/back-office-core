import { eq } from 'drizzle-orm'

/** Enregistre l'ordre manuel d'une collection. Corps : { ids: [identifiants dans le nouvel ordre] }. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const type = getRouterParam(event, 'type')!
  const def = getDef(type)
  assertAccess(user, type, 'publish') // l'ordre s'applique au site tout de suite
  if (def.kind !== 'collection' || !def.orderable) throw createError({ statusCode: 400, message: 'Cette collection n\'a pas d\'ordre manuel.' })

  const { ids } = await readBody<{ ids?: unknown }>(event)
  const db = useDb(event)
  const known = new Set((await db.select({ id: schema.entries.id }).from(schema.entries).where(eq(schema.entries.type, type))).map(r => r.id))
  if (!Array.isArray(ids) || ids.length !== known.size || new Set(ids).size !== ids.length || !ids.every(id => known.has(id as string)))
    throw createError({ statusCode: 409, message: 'La liste a changé entre-temps. Rechargez la page et recommencez.' })

  const updates = (ids as string[]).map((id, i) => db.update(schema.entries).set({ position: i + 1 }).where(eq(schema.entries.id, id)))
  // D1 limite la taille d'un lot : on envoie par paquets.
  for (let i = 0; i < updates.length; i += 50) await db.batch(updates.slice(i, i + 50) as [any, ...any[]])
  return { ok: true, purgeFailed: !(await purgeSiteCache(event)) }
})
