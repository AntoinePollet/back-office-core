import { desc, eq } from 'drizzle-orm'

/** Liens d'aperçu en cours et expirés récemment. Un administrateur voit ceux de tout le monde, les autres les leurs. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { previewLinks } = schema
  const query = useDb(event).select().from(previewLinks).orderBy(desc(previewLinks.createdAt)).limit(50)
  const rows = await (user.role === 'admin' ? query : query.where(eq(previewLinks.createdBy, user.id)))
  const now = Date.now()
  return rows.map(r => ({ id: r.id, label: r.label, by: r.createdByName, mine: r.createdBy === user.id, createdAt: r.createdAt, expiresAt: r.expiresAt, expired: r.expiresAt.getTime() <= now }))
})
