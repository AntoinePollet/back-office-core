import { inArray } from 'drizzle-orm'
import type { H3Event } from 'h3'
import type { AnyField, CmsDefinition } from '../../shared/format'
import { adminEntryPath } from '../../shared/admin-paths'
import { contentImageIds, seoPath, seoPoints, seoState, seoTips, seoView, type SeoMedia, type SeoOther, type SeoSite, type SeoState } from '../../shared/seo'

type Values = Record<string, unknown>
type Who = Parameters<typeof can>[0]
/** Ce qu'il faut d'un contenu et de sa version dans une langue. */
type Doc = { id: string; type: string; sharedDraft: Values; createdBy?: string | null }
type Row = { entryId: string; type: string; locale: string; slug: string | null; status: string; draft: Values }

/** Une page du site dans une langue, telle que la vue d'ensemble « Référencement » la montre. */
export type SeoPageRow = {
  type: string
  id: string
  locale: string
  /** Nom du type de contenu (« Services ») et nom de la page (titre du contenu, ou nom de la page unique). */
  typeLabel: string
  name: string
  /** Adresse publique dans cette langue. */
  path: string
  status: string
  /** Titre sans le suffixe du site, puis tel que le site l'affiche ; description. Vides s'ils manquent. */
  baseTitle: string
  title: string
  description: string
  state: SeoState
  /** Nombre de points à voir, et leur intitulé. */
  points: number
  tips: { id: string; level: string; title: string; advice: string }[]
  /** Formulaire du contenu, ouvert sur l'onglet Référencement dans cette langue. */
  to: string
}

/** Formulaire d'un contenu, ouvert sur l'onglet Référencement. */
const seoFormPath = (type: string, id: string, locale: string) =>
  `${adminEntryPath(type, id)}?tab=seo${locale === cmsConfig.site.defaultLocale ? '' : `&lang=${locale}`}`

/**
 * Toutes les pages du site qui ont l'onglet Référencement, dans chaque langue où elles existent, avec leurs conseils.
 * Ce sont les brouillons qui sont examinés : la liste dit la même chose que l'onglet du formulaire, où l'on corrige.
 * Chacun ne voit que les contenus qu'il peut modifier ; les doublons ne sont donc cherchés que parmi ceux-là.
 */
export async function seoOverview(event: H3Event, user: Who): Promise<SeoPageRow[]> {
  const site = cmsConfig.site as SeoSite
  const defaultLocale = cmsConfig.site.defaultLocale
  const types = ([...Object.entries(cmsConfig.singletons ?? {}), ...Object.entries(cmsConfig.collections ?? {})] as [string, CmsDefinition][])
    .filter(([type, def]) => def.seo && def.path && can(user, type, 'edit'))
  if (!types.length) return []
  const keys = types.map(([type]) => type)
  const defs = new Map(types)

  const db = useDb(event)
  const [docs, rows] = await Promise.all([
    db.select().from(schema.entries).where(inArray(schema.entries.type, keys)),
    db.select().from(schema.entryLocales).where(inArray(schema.entryLocales.type, keys)),
  ])
  const byId = new Map<string, Doc>(docs.filter(d => ownsOrFree(user, d.type, d)).map(d => [d.id, d]))
  const mine: Row[] = rows.filter(r => byId.has(r.entryId) && cmsConfig.site.locales.includes(r.locale))
  // Une page unique jamais ouverte n'existe pas encore en base : elle figure quand même dans la liste, vide.
  for (const [type, def] of types) {
    if (def.kind !== 'singleton' || mine.some(r => r.type === type)) continue
    if (!byId.has(type)) byId.set(type, { id: type, type, sharedDraft: {} })
    mine.push({ entryId: type, type, locale: defaultLocale, slug: null, status: 'draft', draft: {} })
  }

  // Fichiers cités par ces pages : image de partage et images du contenu.
  const ids = new Set<string>()
  for (const row of mine) {
    const doc = byId.get(row.entryId)!
    const image = (doc.sharedDraft.seo as Values | undefined)?.image
    if (typeof image === 'string' && image) ids.add(image)
    for (const id of contentImageIds(defs.get(row.type)!.fields as Record<string, AnyField>, { ...doc.sharedDraft, ...row.draft })) ids.add(id)
  }
  const media = new Map<string, SeoMedia>()
  const wanted = [...ids]
  for (let i = 0; i < wanted.length; i += 80) {
    for (const m of await db.select().from(schema.media).where(inArray(schema.media.id, wanted.slice(i, i + 80))))
      media.set(m.id, { name: m.name, mime: m.mime, width: m.width, height: m.height, alt: m.alt })
  }

  const pages = mine.map((row) => {
    const doc = byId.get(row.entryId)!
    const def = defs.get(row.type)!
    const view = seoView(def, doc.sharedDraft, row.draft, site)
    const name = def.kind === 'collection' ? String(({ ...doc.sharedDraft, ...row.draft } as Values)[def.titleField] ?? '') || 'Sans titre' : def.label
    return { row, doc, def, view, name, to: seoFormPath(row.type, row.entryId, row.locale) }
  })

  return pages.map(({ row, doc, def, view, name, to }) => {
    const others: SeoOther[] = pages
      .filter(p => p.row.locale === row.locale && p.row.entryId !== row.entryId)
      .map(p => ({ name: p.name, title: p.view.baseTitle, description: p.view.description, to: p.to }))
    const tips = seoTips({
      def, site, locale: row.locale, defaultLocale, shared: doc.sharedDraft, values: row.draft, slug: row.slug,
      published: row.status !== 'draft', media: id => media.get(id), others,
    })
    return {
      type: row.type, id: row.entryId, locale: row.locale, typeLabel: def.label, name,
      path: seoPath(def, row.locale, defaultLocale, row.slug)!,
      status: row.status,
      baseTitle: view.baseTitle, title: view.pageTitle ?? '', description: view.description,
      state: seoState(tips, view.noindex), points: seoPoints(tips),
      tips: tips.map(({ id, level, title, advice }) => ({ id, level, title, advice })),
      to,
    }
  })
}
