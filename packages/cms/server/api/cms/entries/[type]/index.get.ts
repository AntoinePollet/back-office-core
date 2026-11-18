import { eq, inArray } from 'drizzle-orm'

/** Liste des contenus d'une collection, pour le back-office. */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const type = getRouterParam(event, 'type')!
  const def = getDef(type)
  if (def.kind !== 'collection') throw createError({ statusCode: 400, message: 'Un singleton n\'a pas de liste.' })

  const db = useDb(event)
  const [docs, rows] = await Promise.all([
    db.select().from(schema.entries).where(eq(schema.entries.type, type)),
    db.select().from(schema.entryLocales).where(eq(schema.entryLocales.type, type)),
  ])
  const sortKey = def.defaultSort?.field
  const columns = def.list?.columns ?? []
  const thumbKey = def.list?.thumbnail

  const items = docs.map((doc) => {
    const mine = rows.filter(r => r.entryId === doc.id)
    const main = mine.find(r => r.locale === cmsConfig.site.defaultLocale) ?? mine[0]
    const values: Record<string, unknown> = { ...doc.sharedDraft, ...main?.draft }
    return {
      id: doc.id,
      position: doc.position,
      title: String(values[def.titleField] ?? ''),
      slug: main?.slug ?? null,
      values: Object.fromEntries(columns.map(c => [c, values[c] ?? null])),
      thumbnail: (thumbKey && typeof values[thumbKey] === 'string' ? values[thumbKey] : null) as string | null,
      statuses: Object.fromEntries(mine.map(r => [r.locale, r.status])),
      createdAt: doc.createdAt,
      updatedAt: new Date(Math.max(doc.updatedAt.getTime(), ...mine.map(r => r.updatedAt.getTime()))),
      sortValue: sortKey ? values[sortKey] : undefined,
    }
  })
  // Vignettes : l'identifiant du fichier est remplacé par son adresse.
  const thumbIds = [...new Set(items.flatMap(i => i.thumbnail ?? []))].slice(0, 80)
  const thumbs = thumbIds.length ? await db.select().from(schema.media).where(inArray(schema.media.id, thumbIds)) : []
  const urlById = new Map(thumbs.map(m => [m.id, thumbUrl(m.key)]))

  // Colonnes de type relation : l'identifiant est remplacé par le titre du contenu lié.
  const relationColumns = columns.filter(c => def.fields[c]?.type === 'relation')
  const linked = [...new Set(items.flatMap(i => relationColumns.flatMap(c => [i.values[c]].flat().filter(v => typeof v === 'string'))))] as string[]
  const titles = linked.length ? await entryTitles(event, linked) : new Map<string, string>()
  for (const item of items) {
    for (const c of relationColumns)
      item.values[c] = [item.values[c]].flat().filter(v => typeof v === 'string').map(id => titles.get(id as string) ?? 'Contenu supprimé').join(', ') || null
  }

  return sortEntries(def, items, (item, key) => (key in item ? (item as Record<string, unknown>)[key] : item.sortValue))
    .map(({ sortValue: _s, ...item }) => ({ ...item, thumbnail: item.thumbnail ? urlById.get(item.thumbnail) ?? null : null }))
})
