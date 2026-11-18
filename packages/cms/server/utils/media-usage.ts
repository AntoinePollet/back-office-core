import { eq, or, sql } from 'drizzle-orm'
import type { H3Event } from 'h3'

/** Contenus qui référencent un fichier, en brouillon ou en ligne. */
export async function findMediaUsage(event: H3Event, mediaId: string) {
  const db = useDb(event)
  const { entries, entryLocales } = schema
  const needle = `%${mediaId}%`
  const [inShared, inLocales] = await Promise.all([
    db.select({ id: entries.id }).from(entries).where(or(sql`${entries.sharedDraft} like ${needle}`, sql`${entries.sharedPublished} like ${needle}`)),
    db.select({ id: entryLocales.entryId }).from(entryLocales).where(or(sql`${entryLocales.draft} like ${needle}`, sql`${entryLocales.published} like ${needle}`)),
  ])
  const ids = [...new Set([...inShared, ...inLocales].map(r => r.id))]
  const out: { id: string; type: string; label: string; title: string }[] = []
  for (const id of ids) {
    const [entry] = await db.select().from(entries).where(eq(entries.id, id))
    if (!entry) continue
    const def = findDef(entry.type)
    if (!def) continue // type retiré de la configuration : le contenu n'est plus affiché nulle part
    const rows = await db.select().from(entryLocales).where(eq(entryLocales.entryId, id))
    const main = rows.find(r => r.locale === cmsConfig.site.defaultLocale) ?? rows[0]
    const values = { ...entry.sharedDraft, ...main?.draft } as Record<string, unknown>
    out.push({ id, type: entry.type, label: def.label, title: def.kind === 'collection' ? String(values[def.titleField] ?? 'Sans titre') : def.label })
  }
  return out
}
