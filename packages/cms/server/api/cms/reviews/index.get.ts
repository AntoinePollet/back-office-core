import { desc, inArray } from 'drizzle-orm'

/**
 * Demandes de publication en attente qui concernent la personne :
 * celles qu'elle peut traiter (elle a le droit de publier ce contenu) et celles qu'elle a faites elle-même.
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const db = useDb(event)
  const { reviewRequests, entries } = schema
  const all = await db.select().from(reviewRequests).orderBy(desc(reviewRequests.createdAt))
  const known = all.filter(r => cmsConfig.collections?.[r.type] || cmsConfig.singletons?.[r.type])
  const ids = known.map(r => r.entryId).slice(0, 80)
  const owners = ids.length ? await db.select({ id: entries.id, createdBy: entries.createdBy }).from(entries).where(inArray(entries.id, ids)) : []
  const ownerOf = new Map(owners.map(o => [o.id, o]))
  const titles = ids.length ? await entryTitles(event, ids) : new Map<string, string>()

  return known.flatMap((r) => {
    const entry = ownerOf.get(r.entryId)
    if (!entry) return []
    const mine = r.requestedBy === user.id
    const canHandle = can(user, r.type, 'publish') && ownsOrFree(user, r.type, entry)
    if (!mine && !canHandle) return []
    const def = getDef(r.type)
    return [{ id: r.entryId, type: r.type, typeLabel: def.label, title: titles.get(r.entryId) ?? def.label, by: r.requestedByName, note: r.note, at: r.createdAt, mine, canHandle }]
  })
})
