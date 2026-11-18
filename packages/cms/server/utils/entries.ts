import projectConfig from '#cms-config'
import { and, eq, inArray, max, ne } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { applyDefaults, partition, pick, slugify, isEmpty, toPublicValues, validateValues } from '../../shared/content'
import type { AnyField, CmsConfig, CmsDefinition } from '../../shared/format'
import type { CmsEventInput } from './events'

type Values = Record<string, unknown>
type Fields = Record<string, AnyField>
type LocaleRow = typeof schema.entryLocales.$inferSelect
type EntryRow = typeof schema.entries.$inferSelect

// Le core lit la configuration sous sa forme générale : il ne dépend pas des contenus précis d'un projet.
const config = projectConfig as unknown as CmsConfig
export const cmsConfig = config

export function getDef(type: string): CmsDefinition {
  const def = config.collections?.[type] ?? config.singletons?.[type]
  if (!def) throw createError({ statusCode: 404, message: `Type de contenu inconnu : ${type}` })
  return def
}

const hasSlug = (def: CmsDefinition) => def.kind === 'collection' && !!def.path?.includes('[slug]')
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

// ───────────── Lecture pour le back-office ─────────────

export async function loadDoc(event: H3Event, type: string, id: string) {
  const db = useDb(event)
  const { entries, entryLocales } = schema
  const [entry] = await db.select().from(entries).where(and(eq(entries.id, id), eq(entries.type, type)))
  if (!entry) return null
  const rows = await db.select().from(entryLocales).where(eq(entryLocales.entryId, id))
  return {
    id,
    type,
    shared: entry.sharedDraft,
    updatedAt: entry.updatedAt,
    locales: Object.fromEntries(rows.map(r => [r.locale, { slug: r.slug, status: r.status, values: r.draft, publishedAt: r.publishedAt }])),
  }
}

/** Titres de contenus (version brouillon, langue par défaut), pour afficher une relation dans le back-office. */
export async function entryTitles(event: H3Event, ids: string[]) {
  const titles = new Map<string, string>()
  const db = useDb(event)
  const { entries, entryLocales } = schema
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80)
    const [docs, rows] = await Promise.all([
      db.select().from(entries).where(inArray(entries.id, chunk)),
      db.select().from(entryLocales).where(inArray(entryLocales.entryId, chunk)),
    ])
    for (const doc of docs) {
      const def = getDef(doc.type)
      const mine = rows.filter(r => r.entryId === doc.id)
      const main = mine.find(r => r.locale === config.site.defaultLocale) ?? mine[0]
      const values = { ...doc.sharedDraft, ...main?.draft } as Values
      titles.set(doc.id, def.kind === 'collection' ? String(values[def.titleField] ?? '') || 'Sans titre' : def.label)
    }
  }
  return titles
}

// ───────────── Enregistrement ─────────────

type SaveBody = {
  shared?: Values
  locales?: Record<string, { slug?: string | null; values?: Values }>
  /** Langues à publier avec cet enregistrement. */
  publish?: string[]
  /** Langues à retirer du site. */
  unpublish?: string[]
}

export async function saveDoc(event: H3Event, type: string, id: string | null) {
  const user = await requireUser(event)
  const def = getDef(type)
  assertCanEdit(def, user)
  const body = await readBody<SaveBody>(event)
  const db = useDb(event)
  const { entries, entryLocales } = schema
  const fields = def.fields as Fields
  const parts = partition(fields)
  const system = def.seo ? ['seo'] : []
  const now = new Date()

  let existing: EntryRow | undefined
  let rows: LocaleRow[] = []
  if (id) {
    ;[existing] = await db.select().from(entries).where(and(eq(entries.id, id), eq(entries.type, type)))
    if (!existing) throw createError({ statusCode: 404, message: 'Contenu introuvable.' })
    rows = await db.select().from(entryLocales).where(eq(entryLocales.entryId, id))
  }
  const entryId = id ?? crypto.randomUUID()
  const byLocale = new Map(rows.map(r => [r.locale, r]))

  const shared = sanitizeRichText(parts.shared, applyDefaults(parts.shared, pick(parts.shared, body.shared ?? existing?.sharedDraft ?? {}, system)))
  const incoming = Object.entries(body.locales ?? {}).filter(([locale]) => config.site.locales.includes(locale))
  const unpublish = body.unpublish ?? []
  const requested = (def.drafts ? body.publish ?? [] : []).filter(l => !unpublish.includes(l))
  /** Langues réellement publiées par cet enregistrement. */
  const publish: string[] = []

  const errors: Record<string, Record<string, string>> = {}
  const upserts: (typeof entryLocales.$inferInsert)[] = []
  /** Anciennes adresses de pages en ligne, à rediriger vers la nouvelle. */
  const moved: { locale: string; slug: string }[] = []

  for (const [locale, input] of incoming) {
    const prev = byLocale.get(locale)
    const values = sanitizeRichText(parts.localized, pick(parts.localized, input.values ?? {}, system))
    if (!prev && Object.values(values).every(isEmpty)) continue // langue pas encore traduite
    applyDefaults(parts.localized, values)

    let slug: string | null = null
    if (hasSlug(def) && def.kind === 'collection') {
      // L'adresse est tirée du titre au premier enregistrement, puis ne change que si on la modifie explicitement :
      // renommer une page publiée ne doit pas casser son adresse.
      slug = slugify(input.slug || prev?.slug || String(values[def.slugFrom ?? def.titleField] ?? '')) || null
      if (slug) {
        const [clash] = await db.select({ id: entryLocales.entryId }).from(entryLocales)
          .where(and(eq(entryLocales.type, type), eq(entryLocales.locale, locale), eq(entryLocales.slug, slug), ne(entryLocales.entryId, entryId)))
        if (clash) (errors[locale] ??= {}).slug = 'Cette adresse est déjà utilisée par un autre contenu.'
      }
    }

    // Sans brouillons, tout enregistrement est une publication des langues remplies.
    if (prev?.published && prev.slug && slug && prev.slug !== slug) moved.push({ locale, slug: prev.slug })

    const publishing = def.drafts ? requested.includes(locale) : !unpublish.includes(locale)
    if (publishing) {
      publish.push(locale)
      const found = validateValues(fields, { ...shared, ...values })
      if (hasSlug(def) && !slug) found.slug = 'Une adresse est nécessaire pour publier.'
      if (Object.keys(found).length) errors[locale] = { ...errors[locale], ...found }
    }

    const published = unpublish.includes(locale) ? null : publishing ? values : prev?.published ?? null
    upserts.push({
      entryId, locale, type, slug, draft: values, published,
      status: !published ? 'draft' : publishing || same(values, published) ? 'published' : 'changed',
      updatedAt: now,
      publishedAt: publishing ? now : published ? prev?.publishedAt ?? null : null,
    })
  }

  for (const locale of requested) if (!publish.includes(locale)) (errors[locale] ??= {})._ = 'Rien à publier dans cette langue.'
  if (Object.keys(errors).length) throw createError({ statusCode: 422, message: 'Certains champs sont à corriger.', data: { errors } })

  const sharedPublished = publish.length ? shared : existing?.sharedPublished ?? null
  const statements: any[] = []

  if (existing) {
    statements.push(db.update(entries).set({ sharedDraft: shared, sharedPublished, updatedAt: now }).where(eq(entries.id, entryId)))
  }
  else {
    const [last] = await db.select({ value: max(entries.position) }).from(entries).where(eq(entries.type, type))
    statements.push(db.insert(entries).values({ id: entryId, type, position: (last?.value ?? 0) + 1, sharedDraft: shared, sharedPublished, createdAt: now, updatedAt: now }))
  }
  for (const row of upserts) {
    const { entryId: _e, locale: _l, ...set } = row
    statements.push(db.insert(entryLocales).values(row).onConflictDoUpdate({ target: [entryLocales.entryId, entryLocales.locale], set }))
  }
  const { redirects } = schema
  for (const old of moved)
    statements.push(db.insert(redirects).values({ type, locale: old.locale, slug: old.slug, entryId, createdAt: now }).onConflictDoUpdate({ target: [redirects.type, redirects.locale, redirects.slug], set: { entryId } }))
  // Une adresse en service n'est jamais redirigée ailleurs.
  for (const row of upserts)
    if (row.slug) statements.push(db.delete(redirects).where(and(eq(redirects.type, type), eq(redirects.locale, row.locale), eq(redirects.slug, row.slug))))

  // Un champ commun modifié sans publication : les langues publiées non touchées passent en « modifications en attente ».
  if (existing && !same(shared, sharedPublished)) {
    for (const row of rows) {
      if (row.status === 'published' && !upserts.some(u => u.locale === row.locale))
        statements.push(db.update(entryLocales).set({ status: 'changed' }).where(and(eq(entryLocales.entryId, entryId), eq(entryLocales.locale, row.locale))))
    }
  }
  // Retrait d'une langue non envoyée dans le formulaire.
  for (const locale of unpublish) {
    if (!upserts.some(u => u.locale === locale) && byLocale.has(locale))
      statements.push(db.update(entryLocales).set({ status: 'draft', published: null, publishedAt: null }).where(and(eq(entryLocales.entryId, entryId), eq(entryLocales.locale, locale))))
  }
  await db.batch(statements as [any, ...any[]])
  // Le site a changé si quelque chose a été publié, retiré, ou si une adresse en ligne a bougé.
  if (publish.length || moved.length || unpublish.some(l => byLocale.get(l)?.published)) await purgeSiteCache(event)

  const who = { id: user.id, email: user.email }
  const mainDraft = upserts.find(u => u.locale === config.site.defaultLocale)?.draft ?? byLocale.get(config.site.defaultLocale)?.draft ?? upserts[0]?.draft
  const title = def.kind === 'collection' ? String(({ ...shared, ...mainDraft } as Values)[def.titleField] ?? '') || 'Sans titre' : def.label
  const urlFor = (locale: string) => {
    const slug = upserts.find(u => u.locale === locale)?.slug ?? byLocale.get(locale)?.slug ?? ''
    if (!def.path || (hasSlug(def) && !slug)) return undefined
    return (config.site.url ?? getRequestURL(event).origin).replace(/\/$/, '') + (locale === config.site.defaultLocale ? '' : `/${locale}`) + def.path.replace('[slug]', slug)
  }
  const events: CmsEventInput[] = [{ name: existing ? 'entry.updated' : 'entry.created', type, id: entryId, title, user: who }]
  for (const locale of publish) events.push({ name: 'entry.published', type, id: entryId, title, locale, url: urlFor(locale), user: who })
  for (const locale of unpublish) if (byLocale.get(locale)?.published) events.push({ name: 'entry.unpublished', type, id: entryId, title, locale, user: who })
  emitCmsEvents(event, events)

  return loadDoc(event, type, entryId)
}

// ───────────── Lecture pour le site public ─────────────

export const publicPath = (def: CmsDefinition, locale: string, slug: string | null) =>
  (def.path ? (locale === config.site.defaultLocale ? '' : `/${locale}`) + def.path.replace('[slug]', slug ?? '') : null)

/**
 * Un contenu tel que le site le reçoit. `siblings` : les lignes du même contenu visibles dans les autres langues.
 * En aperçu, ce sont les brouillons qui sont renvoyés.
 */
export function toPublicEntry(def: CmsDefinition, entry: EntryRow, row: LocaleRow, siblings: LocaleRow[] = [row], preview = false, base = '') {
  const shared = (preview ? entry.sharedDraft : entry.sharedPublished) ?? {}
  const values = (preview ? row.draft : row.published) ?? {}
  const merged = { ...shared, ...values } as Values
  const sharedSeo = (shared.seo ?? {}) as { image?: string; noindex?: boolean }
  const localSeo = (values.seo ?? {}) as { title?: string; description?: string }
  const seo = def.seo
    ? {
        title: localSeo.title || (def.kind === 'collection' ? String(merged[def.titleField] ?? '') : '') || null,
        description: localSeo.description || null,
        image: (sharedSeo.image ?? null) as unknown,
        noindex: !!sharedSeo.noindex,
      }
    : null
  return {
    id: entry.id,
    locale: row.locale,
    path: publicPath(def, row.locale, row.slug),
    url: def.path ? base + publicPath(def, row.locale, row.slug) : null,
    // Dans l'ordre des langues du site, pour un résultat stable.
    alternates: def.path
      ? [...siblings].sort((a, b) => config.site.locales.indexOf(a.locale) - config.site.locales.indexOf(b.locale))
          .map(s => ({ locale: s.locale, path: publicPath(def, s.locale, s.slug)!, url: base + publicPath(def, s.locale, s.slug) }))
      : [],
    status: row.status,
    ...(def.kind === 'collection' ? { slug: row.slug } : {}),
    seo,
    createdAt: entry.createdAt,
    updatedAt: row.updatedAt,
    publishedAt: row.publishedAt,
    ...toPublicValues(def.fields as Fields, merged),
  }
}

/** Trie selon la configuration : ordre manuel, tri déclaré, ou du plus récent au plus ancien. */
export function sortEntries<T>(def: CmsDefinition, items: T[], get: (item: T, key: string) => unknown): T[] {
  if (def.kind !== 'collection') return items
  const key = def.orderable ? 'position' : def.defaultSort?.field ?? 'updatedAt'
  const dir = def.orderable || def.defaultSort?.dir === 'asc' ? 1 : -1
  const compare = (a: unknown, b: unknown) =>
    a instanceof Date && b instanceof Date ? a.getTime() - b.getTime()
    : typeof a === 'number' && typeof b === 'number' ? a - b
    : String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true })
  return [...items].sort((a, b) => dir * compare(get(a, key), get(b, key)))
}
