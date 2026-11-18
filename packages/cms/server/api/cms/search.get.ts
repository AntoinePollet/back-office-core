import { eq, sql } from 'drizzle-orm'
import { matchScore, searchWords } from '../../../shared/search'
import type { EntryStatus } from '../../database/schema'

/** Nombre maximal de contenus renvoyés. */
const MAX_RESULTS = 20

export type CmsSearchItem = {
  id: string
  type: string
  /** Titre dans la langue où la recherche a été trouvée. */
  title: string
  locale: string
  /** Statut dans la langue principale du site, comme dans les listes. */
  status: EntryStatus
}

/**
 * Recherche de contenus par leur titre, dans toutes les collections et toutes les langues, pour la palette (⌘K).
 * Sans tenir compte des majuscules ni des accents. Les pages uniques n'ont pas de titre : la palette les propose par leur nom.
 */
export default defineEventHandler(async (event): Promise<{ items: CmsSearchItem[]; more: boolean }> => {
  const user = await requireUser(event)
  const words = searchWords(String(getQuery(event).q ?? '').slice(0, 100))
  // Un éditeur ne trouve pas les contenus réservés aux administrateurs.
  const collections = Object.entries(cmsConfig.collections ?? {}).filter(([type]) => can(user, type, 'edit'))
  if (words.join('').length < 2 || !collections.length) return { items: [], more: false }

  const db = useDb(event)
  const { entries, entryLocales } = schema
  // SQLite ne sait pas comparer sans les accents : la base ne renvoie que les titres (pas les contenus entiers),
  // et la comparaison se fait ici. Une requête par collection, envoyées ensemble.
  const queries = collections.map(([type, def]) => {
    const path = `$.${def.titleField}`
    return db.select({
      id: entries.id,
      type: entries.type,
      locale: entryLocales.locale,
      status: entryLocales.status,
      // Le champ titre est soit traduit (une valeur par langue), soit commun aux langues.
      title: sql<string | null>`coalesce(json_extract(${entryLocales.draft}, ${path}), json_extract(${entries.sharedDraft}, ${path}))`,
    }).from(entries).leftJoin(entryLocales, eq(entryLocales.entryId, entries.id)).where(eq(entries.type, type))
  })
  const rows = (await db.batch(queries as [typeof queries[number], ...typeof queries])).flat()

  const main = cmsConfig.site.defaultLocale
  type Found = CmsSearchItem & { score: number }
  const found = new Map<string, Found>()
  const mainStatus = new Map<string, EntryStatus>()
  for (const row of rows) {
    if (row.locale === main && row.status) mainStatus.set(row.id, row.status)
    if (typeof row.title !== 'string') continue
    const score = matchScore(row.title, words)
    if (score === null) continue
    const locale = row.locale ?? main
    const previous = found.get(row.id)
    // Un contenu n'apparaît qu'une fois : dans la langue qui correspond le mieux, la langue principale d'abord à égalité.
    if (!previous || score < previous.score || (score === previous.score && locale === main))
      found.set(row.id, { id: row.id, type: row.type, title: row.title, locale, status: row.status ?? 'draft', score })
  }

  const order = new Map(collections.map(([type], i) => [type, i]))
  const sorted = [...found.values()].sort((a, b) =>
    a.score - b.score || order.get(a.type)! - order.get(b.type)! || a.title.localeCompare(b.title, 'fr', { numeric: true }))
  return {
    items: sorted.slice(0, MAX_RESULTS).map(({ score: _score, ...item }) => ({ ...item, status: mainStatus.get(item.id) ?? item.status })),
    more: sorted.length > MAX_RESULTS,
  }
})
