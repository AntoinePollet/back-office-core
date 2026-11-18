import { desc } from 'drizzle-orm'

/** Tous les fichiers de la médiathèque, du plus récent au plus ancien. */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const rows = await useDb(event).select().from(schema.media).orderBy(desc(schema.media.createdAt))
  return rows.map(toAdminMedia)
})
