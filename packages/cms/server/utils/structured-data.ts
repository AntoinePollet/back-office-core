import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import type { H3Event } from 'h3'
import type { AnyField, CmsDefinition } from '../../shared/format'
import { googleOpeningHours } from '../cms-modules/google-business'
import { type JsonLd, type StructuredContext, breadcrumbBlock, breadcrumbName, breadcrumbTrail, contentBlocks, parentPaths, specsOf } from '../../shared/structured-data'

type Values = Record<string, unknown>
type PublicEntry = ReturnType<typeof toPublicEntry> & { structuredData?: JsonLd[] }

/**
 * Ajoute à un contenu lu par le site ses données structurées (`entry.structuredData`) : les blocs déclarés dans
 * cms.config.ts, l'organisme sur la page d'accueil, et le fil d'Ariane. Les références du contenu (images) doivent
 * déjà être résolues. Appelé pour la lecture d'un seul contenu, hors aperçu : une liste n'en a pas besoin.
 */
export async function attachStructuredData(event: H3Event, type: string, def: CmsDefinition, locale: string, items: PublicEntry[], base: string) {
  if (!def.path || !items.length) return
  const { site } = cmsConfig
  const singletons = (cmsConfig.singletons ?? {}) as Record<string, CmsDefinition>
  const ctx: StructuredContext = {
    site: { name: site.name, logo: site.logo }, base, locale,
    imageUrl: (value) => {
      const file = (Array.isArray(value) ? value[0] : value) as { url?: unknown; mime?: unknown } | null | undefined
      return file && typeof file.url === 'string' && String(file.mime ?? 'image/').startsWith('image/') ? base + file.url : null
    },
  }
  const db = useDb(event)
  const { entries, entryLocales } = schema

  // Pages uniques dont dépend la réponse : les pages parentes (fil d'Ariane) et, sur l'accueil, celles qui déclarent l'organisme.
  const isHome = def.path === '/'
  const parents = new Set(items.flatMap(item => parentPaths(def.path!.replace('[slug]', String((item as Values).slug ?? '')))))
  const parentTypes = Object.entries(singletons).filter(([key, d]) => key !== type && d.path && parents.has(d.path)).map(([key]) => key)
  const organizations = isHome ? Object.entries(singletons).filter(([key, d]) => key !== type && specsOf(d).some(s => s.kind === 'organization')) : []
  const wanted = [...new Set([...parentTypes, ...organizations.map(([key]) => key)])]
  const liveRows = wanted.length
    ? await db.select().from(entryLocales).where(and(inArray(entryLocales.type, wanted), eq(entryLocales.locale, locale), isNotNull(entryLocales.published)))
    : []
  const live = new Map(liveRows.map(r => [r.type, r]))

  const shared: JsonLd[] = []
  const present = organizations.filter(([key]) => live.has(key))
  if (present.length) {
    const docs = await db.select().from(entries).where(inArray(entries.id, present.map(([key]) => live.get(key)!.entryId)))
    const built = present.flatMap(([key, d]) => {
      const row = live.get(key)!
      const doc = docs.find(x => x.id === row.entryId)
      return doc ? [{ def: d, entry: toPublicEntry(d, doc, row, [row], false, base) }] : []
    })
    await resolveRefs(event, locale, built.map(b => ({ fields: b.def.fields as Record<string, AnyField>, values: b.entry as Values })))
    for (const b of built) {
      const page = { url: b.entry.url ?? base, title: '', description: '' }
      shared.push(...contentBlocks({ fields: b.def.fields as Record<string, AnyField>, structuredData: specsOf(b.def).filter(s => s.kind === 'organization') }, b.entry as Values, page, ctx))
    }
  }

  // Organisme sans horaires déclarés : ceux de la fiche Google (module « Avis Google »), s'il est réglé.
  const organization = shared.find(block => String(block['@id'] ?? '').endsWith('#organization'))
  if (organization && !organization.openingHoursSpecification) {
    const hours = await googleOpeningHours(event, locale).catch(() => [])
    if (hours.length) organization.openingHoursSpecification = hours
  }

  for (const item of items) {
    const values = item as Values
    if (item.seo?.noindex || !item.url) { item.structuredData = []; continue }
    const title = def.kind === 'collection' ? String(values[def.titleField] ?? '') : ''
    const page = {
      url: item.url, title: item.seo?.title || title, description: item.seo?.description ?? '',
      image: item.seo?.image, publishedAt: item.publishedAt, updatedAt: item.updatedAt,
    }
    const trail = breadcrumbTrail({
      def, path: def.path.replace('[slug]', String(values.slug ?? '')), url: item.url, locale, defaultLocale: site.defaultLocale, base,
      name: def.kind === 'collection' ? title : breadcrumbName(def, locale, site.defaultLocale),
      singletons, isLive: key => live.has(key),
    })
    const crumbs = breadcrumbBlock(trail)
    item.structuredData = [
      ...contentBlocks({ titleField: def.kind === 'collection' ? def.titleField : undefined, fields: def.fields as Record<string, AnyField>, structuredData: def.structuredData }, values, page, ctx),
      ...shared,
      ...(crumbs ? [crumbs] : []),
    ]
  }
}
