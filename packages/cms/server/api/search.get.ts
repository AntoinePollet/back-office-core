import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import type { AnyField, CmsDefinition } from '../../shared/format'
import { SITE_SEARCH, type ExcerptPart, contentTexts, isSearchable, siteSearchExcerpt, siteSearchScore, siteSearchWords } from '../../shared/site-search'

/** Un résultat de la recherche du site. */
export type CmsSearchResult = {
  /** Identifiant du type de contenu ('services') et son nom ('Services'). */
  type: string
  typeLabel: string
  id: string
  title: string
  /** Adresse de la page dans la langue demandée, et adresse complète. */
  path: string
  url: string
  /** Passage où la recherche a été trouvée : des morceaux à afficher l'un après l'autre, `match` pour ceux à mettre en évidence. */
  excerpt: ExcerptPart[]
  /** Vignette du contenu (`list.thumbnail` de la collection), si elle existe. */
  image: ReturnType<typeof toPublicMedia> | null
}

/**
 * Recherche dans les pages publiées du site : `/api/search?q=droit+affaires`.
 * - `locale` : langue des pages (défaut : celle du site) ;
 * - `limit` : nombre de résultats (défaut 10, 50 au plus) ;
 * - `types` : types de contenu, séparés par des virgules (défaut : tous ceux qui ont une page).
 *
 * Sans tenir compte des majuscules ni des accents. Chaque mot doit se trouver dans la page ; les pages dont le titre
 * correspond viennent d'abord. Jamais de brouillon, de page masquée des moteurs de recherche, ni de contenu exclu
 * par `search: false`. Réponse publique, gardée en cache comme les contenus et vidée à chaque publication.
 */
export default defineEventHandler(async (event): Promise<{ items: CmsSearchResult[]; total: number; query: string }> => {
  const query = getQuery(event)
  const locale = String(query.locale ?? cmsConfig.site.defaultLocale)
  if (!cmsConfig.site.locales.includes(locale)) throw createError({ statusCode: 404, message: 'Langue inconnue.' })
  const limit = query.limit === undefined ? SITE_SEARCH.defaultLimit : Number(query.limit)
  if (!(Number.isInteger(limit) && limit >= 1 && limit <= SITE_SEARCH.maxLimit)) throw createError({ statusCode: 400, message: `limit doit être un entier entre 1 et ${SITE_SEARCH.maxLimit}.` })

  const all = ([...Object.entries(cmsConfig.singletons ?? {}), ...Object.entries(cmsConfig.collections ?? {})] as [string, CmsDefinition][]).filter(([, def]) => isSearchable(def))
  const wanted = query.types === undefined ? null : String(query.types).split(',').map(t => t.trim()).filter(Boolean)
  const unknown = wanted?.find(t => !all.some(([type]) => type === t))
  if (unknown) throw createError({ statusCode: 400, message: `Recherche impossible dans « ${unknown} ».` })
  const defs = new Map(wanted ? all.filter(([type]) => wanted.includes(type)) : all)

  const text = String(query.q ?? '').slice(0, SITE_SEARCH.maxChars).trim()
  allowSiteCache(event)
  const words = siteSearchWords(text)
  if (!words || !defs.size) return { items: [], total: 0, query: text }

  const db = useDb(event)
  const { entries, entryLocales, media } = schema
  const keys = [...defs.keys()]
  const [docs, rows] = await Promise.all([
    db.select().from(entries).where(inArray(entries.type, keys)),
    db.select().from(entryLocales).where(and(inArray(entryLocales.type, keys), eq(entryLocales.locale, locale), isNotNull(entryLocales.published))),
  ])
  const byId = new Map(docs.map(d => [d.id, d]))

  type Found = { score: number; order: number; row: typeof rows[number]; def: CmsDefinition; title: string; excerpt: ExcerptPart[]; thumb: unknown }
  const found: Found[] = []
  for (const row of rows) {
    const doc = byId.get(row.entryId)
    const def = defs.get(row.type)
    if (!doc || !def) continue
    const shared = (doc.sharedPublished ?? {}) as Record<string, unknown>
    const values = { ...shared, ...row.published } as Record<string, unknown>
    if ((shared.seo as { noindex?: boolean } | undefined)?.noindex) continue
    const seo = ((row.published as Record<string, unknown>).seo ?? {}) as { title?: string; description?: string }
    const titleField = def.kind === 'collection' ? def.titleField : undefined
    const title = (titleField ? String(values[titleField] ?? '') : '') || seo.title || def.label
    const searchDoc = { title, description: seo.description ?? '', texts: contentTexts(def.fields as Record<string, AnyField>, values, titleField) }
    const score = siteSearchScore(searchDoc, words)
    if (score === null) continue
    found.push({
      score, order: keys.indexOf(row.type), row, def, title, excerpt: siteSearchExcerpt(searchDoc, words),
      thumb: def.kind === 'collection' && def.list?.thumbnail ? values[def.list.thumbnail] : null,
    })
  }
  found.sort((a, b) => a.score - b.score || a.order - b.order || a.title.localeCompare(b.title, locale, { numeric: true }))

  const page = found.slice(0, limit)
  const thumbIds = [...new Set(page.map(f => f.thumb).filter((id): id is string => typeof id === 'string' && !!id))]
  const thumbs = new Map((thumbIds.length ? await db.select().from(media).where(inArray(media.id, thumbIds)) : []).map(m => [m.id, toPublicMedia(m, locale)]))
  const base = (cmsConfig.site.url ?? getRequestURL(event).origin).replace(/\/$/, '')
  return {
    items: page.map(({ row, def, title, excerpt, thumb }) => {
      const path = publicPath(def, locale, row.slug)!
      return { type: row.type, typeLabel: def.label, id: row.entryId, title, path, url: base + path, excerpt, image: (typeof thumb === 'string' && thumbs.get(thumb)) || null }
    }),
    total: found.length,
    query: text,
  }
})
