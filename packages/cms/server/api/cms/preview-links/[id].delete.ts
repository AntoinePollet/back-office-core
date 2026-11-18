import { eq } from 'drizzle-orm'

/** Révoque un lien d'aperçu : il cesse de fonctionner tout de suite. Par son créateur ou un administrateur. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = getRouterParam(event, 'id')!
  const db = useDb(event)
  const [link] = await db.select().from(schema.previewLinks).where(eq(schema.previewLinks.id, id))
  if (!link) return { ok: true }
  if (link.createdBy !== user.id && user.role !== 'admin') throw createError({ statusCode: 403, message: 'Ce lien a été créé par quelqu\'un d\'autre.' })
  await db.delete(schema.previewLinks).where(eq(schema.previewLinks.id, id))
  return { ok: true }
})
