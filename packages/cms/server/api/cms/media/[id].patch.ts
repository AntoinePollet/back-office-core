import { eq } from 'drizzle-orm'

/** Modifie le texte alternatif d'un fichier. Corps : { alt: { fr: '…', en: '…' } }. */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const id = getRouterParam(event, 'id')!
  const body = await readBody<{ alt?: Record<string, unknown> }>(event)
  const alt = Object.fromEntries(cmsConfig.site.locales.map(l => [l, String(body.alt?.[l] ?? '').slice(0, 300)]))
  const db = useDb(event)
  await db.update(schema.media).set({ alt }).where(eq(schema.media.id, id))
  const [row] = await db.select().from(schema.media).where(eq(schema.media.id, id))
  if (!row) throw createError({ statusCode: 404, message: 'Fichier introuvable.' })
  // Le texte alternatif apparaît dans les pages.
  return { ...toAdminMedia(row), purgeFailed: !(await purgeSiteCache(event)) }
})
