import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import type { H3Event } from 'h3'
import type { AnyField, CmsDefinition } from '../../shared/format'

type Values = Record<string, unknown>

/** Une page en ligne, telle que la lisent le flux RSS et `llms.txt` : valeurs publiées, sans références résolues. */
export type LivePage = {
  type: string
  def: CmsDefinition
  id: string
  title: string
  path: string
  url: string
  values: Values
  fields: Record<string, AnyField>
  seoDescription: string | null
  publishedAt: Date
  position: number
}

/** Texte d'un réglage du site qui peut être écrit par langue (`site.description`, titre d'un flux). */
export const localized = (value: string | Record<string, string> | undefined, locale: string): string =>
  (typeof value === 'string' ? value : value?.[locale] ?? value?.[cmsConfig.site.defaultLocale] ?? '')

/** Adresse du site, sans barre finale : celle de `site.url`, sinon celle de la demande. */
export const siteBase = (event: H3Event) => (cmsConfig.site.url ?? getRequestURL(event).origin).replace(/\/$/, '')

/**
 * Les pages en ligne de ces types de contenu, dans une langue : publiées, avec une adresse, et pas masquées des
 * moteurs de recherche. Les mêmes que dans le plan du site.
 */
export async function livePages(event: H3Event, types: string[], locale: string): Promise<LivePage[]> {
  const defs = new Map(types.map(type => [type, findDef(type)] as const).filter((pair): pair is [string, CmsDefinition] => !!pair[1]?.path))
  if (!defs.size) return []
  const db = useDb(event)
  const { entries, entryLocales } = schema
  const keys = [...defs.keys()]
  const [docs, rows] = await Promise.all([
    db.select().from(entries).where(inArray(entries.type, keys)),
    db.select().from(entryLocales).where(and(inArray(entryLocales.type, keys), eq(entryLocales.locale, locale), isNotNull(entryLocales.published))),
  ])
  const byId = new Map(docs.map(d => [d.id, d]))
  const base = siteBase(event)
  return rows.flatMap((row) => {
    const doc = byId.get(row.entryId)
    const def = defs.get(row.type)!
    const shared = (doc?.sharedPublished ?? {}) as Values
    if (!doc || (shared.seo as { noindex?: boolean } | undefined)?.noindex) return []
    const values = { ...shared, ...row.published } as Values
    const seo = ((row.published as Values).seo ?? {}) as { title?: string; description?: string }
    const path = publicPath(def, locale, row.slug)!
    return [{
      type: row.type, def, id: row.entryId, path, url: base + path, values, fields: def.fields as Record<string, AnyField>,
      title: (def.kind === 'collection' ? String(values[def.titleField] ?? '') : '') || seo.title || def.label,
      seoDescription: seo.description?.trim() || null,
      publishedAt: row.publishedAt ?? row.updatedAt, position: doc.position,
    }]
  })
}
