import { eq } from 'drizzle-orm'

/** Supprime un fichier. Refusé s'il est utilisé, sauf avec ?force=1. */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const id = getRouterParam(event, 'id')!
  const db = useDb(event)
  const [row] = await db.select().from(schema.media).where(eq(schema.media.id, id))
  if (!row) throw createError({ statusCode: 404, message: 'Fichier introuvable.' })

  if (!getQuery(event).force) {
    const usage = await findMediaUsage(event, id)
    if (usage.length) throw createError({ statusCode: 409, message: 'Ce fichier est utilisé par des contenus.', data: { usage } })
  }
  await useBucket(event).delete(row.key)
  await db.delete(schema.media).where(eq(schema.media.id, id))
  return { ok: true, purgeFailed: !(await purgeSiteCache(event)) }
})
