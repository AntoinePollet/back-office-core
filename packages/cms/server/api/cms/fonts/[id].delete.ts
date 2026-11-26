import { eq } from 'drizzle-orm'

/**
 * Supprime un fichier de police, tout de suite (pas de corbeille : le fichier d'origine est chez qui l'a envoyé).
 * Si le thème se servait de sa famille et qu'il n'en reste aucun fichier, le site affiche la police du système.
 */
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const id = getRouterParam(event, 'id')!
  const fonts = await loadCustomFonts(event)
  const font = fonts.find(f => f.id === id)
  if (!font) throw createError({ statusCode: 404, message: 'Police introuvable.' })
  const db = useDb(event)
  const [row] = await db.select().from(schema.media).where(eq(schema.media.id, id))
  await saveCustomFonts(event, fonts.filter(f => f.id !== id))
  if (row && isFontMime(row.mime)) {
    await db.delete(schema.media).where(eq(schema.media.id, id))
    await useBucket(event).delete(row.key).catch(error => console.error('[cms] police : fichier non supprimé du stockage', error))
  }
  logActivity(event, { action: 'font.deleted', category: 'settings', actor: admin, phrase: `a supprimé la police « ${font.name} »`, target: { kind: 'theme' } })
  return { ok: true, purgeFailed: !(await purgeSiteCache(event)) }
})
