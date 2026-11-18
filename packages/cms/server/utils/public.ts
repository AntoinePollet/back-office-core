import { and, asc, count, desc, eq, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm'
import type { H3Event } from 'h3'
import type { AnyField, CmsDefinition } from '../../shared/format'

/** Nombre maximal de contenus par page. */
const MAX_PAGE_SIZE = 100
/** Types de champs sur lesquels on peut filtrer : `?where[category]=…`. */
const FILTERABLE = ['text', 'number', 'boolean', 'date', 'select', 'relation']

type ListQuery = { where: [key: string, field: AnyField, value: string][]; limit: number | null; page: number }

/** Lit la pagination et les filtres dans l'adresse. Renvoie null si la demande est une lecture simple de toute la collection. */
function parseListQuery(event: H3Event, def: CmsDefinition): ListQuery | null {
  const query = getQuery(event)
  const where: ListQuery['where'] = []
  for (const [name, raw] of Object.entries(query)) {
    const key = /^where\[(\w+)\]$/.exec(name)?.[1]
    if (!key) continue
    const field = (def.fields as Record<string, AnyField>)[key]
    if (!field || !FILTERABLE.includes(field.type)) throw createError({ statusCode: 400, message: `Filtre impossible sur « ${key} ».` })
    where.push([key, field, String(Array.isArray(raw) ? raw[0] : raw)])
  }
  const limit = query.limit === undefined ? null : Number(query.limit)
  const page = query.page === undefined ? 1 : Number(query.page)
  if (limit !== null && !(Number.isInteger(limit) && limit >= 1 && limit <= MAX_PAGE_SIZE)) throw createError({ statusCode: 400, message: `limit doit être un entier entre 1 et ${MAX_PAGE_SIZE}.` })
  if (!(Number.isInteger(page) && page >= 1)) throw createError({ statusCode: 400, message: 'page doit être un entier à partir de 1.' })
  if (limit === null && page !== 1) throw createError({ statusCode: 400, message: 'page demande aussi limit.' })
  return limit === null && !where.length ? null : { where, limit, page }
}

/**
 * Trouve, dans la base, les identifiants d'une page de résultats : filtrés, triés selon la configuration, puis découpés.
 * Seule la page demandée est ensuite chargée, quelle que soit la taille de la collection.
 */
async function findPage(event: H3Event, type: string, def: CmsDefinition, locale: string, preview: boolean, list: ListQuery) {
  const db = useDb(event)
  const { entries: e, entryLocales: el } = schema
  const source = preview ? { local: el.draft, shared: e.sharedDraft } : { local: el.published, shared: e.sharedPublished }
  // Valeur d'un champ, lue dans la partie traduite ou dans la partie commune selon sa nature.
  const value = (key: string, field: AnyField) => sql`json_extract(${field.localized ? source.local : source.shared}, ${`$.${key}`})`

  const conditions: (SQL | undefined)[] = [eq(el.type, type), eq(el.locale, locale), preview ? undefined : isNotNull(el.published)]
  for (const [key, field, raw] of list.where) {
    const column = value(key, field)
    if (field.multiple) conditions.push(sql`exists (select 1 from json_each(${column}) where value = ${raw})`)
    else if (field.type === 'boolean') conditions.push(sql`coalesce(${column}, 0) = ${raw === 'true' || raw === '1' ? 1 : 0}`)
    else if (field.type === 'number') conditions.push(sql`${column} = ${Number(raw)}`)
    else conditions.push(sql`${column} = ${raw}`)
  }

  let order: SQL
  if (def.kind === 'collection' && def.orderable) order = asc(e.position)
  else if (def.kind === 'collection' && def.defaultSort) {
    const { field: key, dir } = def.defaultSort
    const system = { createdAt: e.createdAt, updatedAt: el.updatedAt, publishedAt: el.publishedAt }[key as string]
    const expression = system ?? sql`${value(key, (def.fields as Record<string, AnyField>)[key]!)} collate nocase`
    order = dir === 'asc' ? asc(expression) : desc(expression)
  }
  else order = desc(el.updatedAt)

  const filter = and(...conditions)
  const base = db.select({ id: el.entryId }).from(el).innerJoin(e, eq(e.id, el.entryId)).where(filter).orderBy(order, asc(e.id))
  const [rows, [counted]] = await Promise.all([
    list.limit === null ? base : base.limit(list.limit).offset((list.page - 1) * list.limit),
    db.select({ n: count() }).from(el).innerJoin(e, eq(e.id, el.entryId)).where(filter),
  ])
  const total = counted?.n ?? 0
  return {
    ids: rows.map(r => r.id),
    paging: list.limit === null ? null : { total, page: list.page, limit: list.limit, pageCount: Math.max(1, Math.ceil(total / list.limit)) },
  }
}

async function inChunks<T>(ids: string[], query: (chunk: string[]) => Promise<T[]>) {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += 80) out.push(...await query(ids.slice(i, i + 80)))
  return out
}

/** Aperçu des brouillons : demandé par ?preview=1 et accordé seulement à une personne connectée au back-office. */
export async function isPreview(event: H3Event, type: string) {
  if (!getQuery(event).preview) return false
  const user = await requireUser(event).catch(() => null)
  // Un brouillon ne se montre qu'à quelqu'un qui pourrait l'ouvrir dans le back-office.
  return !!user && can(user, type, 'edit')
}

/**
 * Lit les contenus d'un type pour le site : publiés, ou brouillons en aperçu.
 * Avec `slug`, ne lit que le contenu qui porte cette adresse (ou cet identifiant).
 */
export async function readPublic(event: H3Event, type: string, slug?: string) {
  const def = getDef(type)
  const locale = String(getQuery(event).locale ?? cmsConfig.site.defaultLocale)
  if (!cmsConfig.site.locales.includes(locale)) throw createError({ statusCode: 404, message: 'Langue inconnue.' })
  const preview = await isPreview(event, type)
  // Hors aperçu, la réponse est publique. Une demande d'aperçu n'est jamais mise en cache, même refusée :
  // sinon la version publiée serait gardée sous cette adresse et servie ensuite à la place du brouillon.
  allowSiteCache(event)

  const db = useDb(event)
  const { entries, entryLocales } = schema
  let all: (typeof entryLocales.$inferSelect)[]
  const list = slug === undefined && def.kind === 'collection' ? parseListQuery(event, def) : null
  const found = list ? await findPage(event, type, def, locale, preview, list) : null
  if (found) all = await inChunks(found.ids, ids => db.select().from(entryLocales).where(inArray(entryLocales.entryId, ids)))
  else if (slug === undefined) all = await db.select().from(entryLocales).where(eq(entryLocales.type, type))
  else {
    const [hit] = await db.select({ id: entryLocales.entryId }).from(entryLocales)
      .where(and(eq(entryLocales.type, type), eq(entryLocales.locale, locale), or(eq(entryLocales.slug, slug), eq(entryLocales.entryId, slug))))
    all = hit ? await db.select().from(entryLocales).where(eq(entryLocales.entryId, hit.id)) : []
  }
  const visible = all.filter(r => preview || r.published != null)
  const rows = visible.filter(r => r.locale === locale)
  const ids = [...new Set(rows.map(r => r.entryId))]
  const docs = slug === undefined && !found
    ? await db.select().from(entries).where(eq(entries.type, type))
    : await inChunks(ids, chunk => db.select().from(entries).where(inArray(entries.id, chunk)))
  const byId = new Map(docs.map(d => [d.id, d]))
  // Adresse officielle du site si elle est déclarée, sinon celle de la requête.
  const base = (cmsConfig.site.url ?? getRequestURL(event).origin).replace(/\/$/, '')

  // Une page trouvée par la base arrive déjà filtrée et triée : on garde son ordre.
  if (found) rows.sort((a, b) => found.ids.indexOf(a.entryId) - found.ids.indexOf(b.entryId))
  const items = rows.flatMap((row) => {
    const entry = byId.get(row.entryId)
    return entry ? [toPublicEntry(def, entry, row, visible.filter(r => r.entryId === row.entryId), preview, base)] : []
  })
  await resolveRefs(event, locale, [
    ...items.map(values => ({ fields: def.fields, values })),
    // L'image de partage est enregistrée comme un champ image.
    ...items.flatMap(i => (i.seo ? [{ fields: { image: { type: 'image' as const, label: '' } }, values: i.seo as Record<string, unknown> }] : [])),
  ], preview)
  return { def, locale, preview, items, positionOf: (id: string) => byId.get(id)?.position, sorted: !!found, paging: found?.paging ?? null }
}
