import { eq, inArray } from 'drizzle-orm'
import { cmsObjectPosition } from '../../../../../shared/media'

/** Vignette : l'image, ou la première image d'une galerie. */
function thumbOf(value: unknown): string | null {
  const first = Array.isArray(value) ? value[0] : value
  const id = first && typeof first === 'object' ? (first as { media?: unknown }).media : first
  return typeof id === 'string' && id ? id : null
}

/** Liste des contenus d'une collection, pour le back-office. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const type = getRouterParam(event, 'type')!
  const def = getDef(type)
  if (def.kind !== 'collection') throw createError({ statusCode: 400, message: 'Un singleton n\'a pas de liste.' })
  // Sans accès à la collection, on ne reçoit que les titres, et seulement s'ils servent à remplir un champ relation ou lien.
  const full = can(user, type, 'edit')
  if (!full && !canListTitles(user, type)) assertAccess(user, type, 'edit')

  const db = useDb(event)
  const [allDocs, rows, pending, planned] = await Promise.all([
    db.select().from(schema.entries).where(eq(schema.entries.type, type)),
    db.select().from(schema.entryLocales).where(eq(schema.entryLocales.type, type)),
    db.select({ entryId: schema.reviewRequests.entryId }).from(schema.reviewRequests).where(eq(schema.reviewRequests.type, type)),
    schedulesByEntry(event, type),
  ])
  // Avec le droit « seulement ses contenus », la liste complète ne montre que les siens (les titres, eux, restent proposés aux champs relation).
  const docs = full && rightsFor(user, type).own ? allDocs.filter(d => d.createdBy === user.id) : allDocs
  const requested = new Set(pending.map(p => p.entryId))
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
      thumbnail: thumbOf(thumbKey ? values[thumbKey] : null),
      statuses: Object.fromEntries(mine.map(r => [r.locale, r.status])),
      /** Une publication a été demandée et attend une réponse. */
      review: requested.has(doc.id),
      /** Mises en ligne et retraits programmés : { action, at, failed, locale }. */
      scheduled: planned.get(doc.id) ?? [],
      createdAt: doc.createdAt,
      updatedAt: new Date(Math.max(doc.updatedAt.getTime(), ...mine.map(r => r.updatedAt.getTime()))),
      sortValue: sortKey ? values[sortKey] : undefined,
    }
  })
  // Vignettes : l'identifiant du fichier est remplacé par son adresse.
  const thumbIds = [...new Set(items.flatMap(i => i.thumbnail ?? []))].slice(0, 80)
  const thumbs = thumbIds.length ? await db.select().from(schema.media).where(inArray(schema.media.id, thumbIds)) : []
  const urlById = new Map(thumbs.map(m => [m.id, thumbUrl(m.key)]))
  // Point d'intérêt du fichier : la vignette, recadrée par le navigateur, garde le sujet visible.
  const positionById = new Map(thumbs.map(m => [m.id, cmsObjectPosition(m) ?? null]))

  if (!full) return sortEntries(def, items, (item, key) => (key in item ? (item as Record<string, unknown>)[key] : item.sortValue)).map(({ id, title }) => ({ id, title }))

  // Colonnes de type relation : l'identifiant est remplacé par le titre du contenu lié.
  const relationColumns = columns.filter(c => def.fields[c]?.type === 'relation')
  const linked = [...new Set(items.flatMap(i => relationColumns.flatMap(c => [i.values[c]].flat().filter(v => typeof v === 'string'))))] as string[]
  const titles = linked.length ? await entryTitles(event, linked) : new Map<string, string>()
  for (const item of items) {
    for (const c of relationColumns)
      item.values[c] = [item.values[c]].flat().filter(v => typeof v === 'string').map(id => titles.get(id as string) ?? 'Contenu supprimé').join(', ') || null
  }

  return sortEntries(def, items, (item, key) => (key in item ? (item as Record<string, unknown>)[key] : item.sortValue))
    .map(({ sortValue: _s, ...item }) => ({ ...item, thumbnail: item.thumbnail ? urlById.get(item.thumbnail) ?? null : null, thumbnailPosition: item.thumbnail ? positionById.get(item.thumbnail) ?? null : null }))
})
