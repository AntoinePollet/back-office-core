import projectConfig from '#cms-config'
import { and, desc, eq, gt, inArray, max, ne, notInArray, sql } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { applyDefaults, copyValues, MAX_REVISIONS, normalizeValues, partition, pick, slugify, isEmpty, toPublicValues, validateValues } from '../../shared/content'
import type { AnyField, CmsConfig, CmsDefinition } from '../../shared/format'
import { unknownValues } from '../../shared/migrate'
import { mergeValues, splitFlat, strayKeys, strayMessage } from '../../shared/flat'
import { type CustomRights, canEditRestricted } from '../../shared/access'
import type { CmsEventInput } from './events'

type Values = Record<string, unknown>
type Fields = Record<string, AnyField>
type LocaleRow = typeof schema.entryLocales.$inferSelect
type EntryRow = typeof schema.entries.$inferSelect

// Le core lit la configuration sous sa forme générale : il ne dépend pas des contenus précis d'un projet.
const config = projectConfig as unknown as CmsConfig
export const cmsConfig = config

/** Comme `getDef`, sans erreur : un contenu peut rester en base après le retrait de son type de la configuration. */
export const findDef = (type: string): CmsDefinition | undefined => config.collections?.[type] ?? config.singletons?.[type]

export function getDef(type: string): CmsDefinition {
  const def = findDef(type)
  if (!def) throw createError({ statusCode: 404, message: `Type de contenu inconnu : ${type}` })
  return def
}

const hasSlug = (def: CmsDefinition) => def.kind === 'collection' && !!def.path?.includes('[slug]')
/** Écriture canonique : l'ordre des clés ne compte pas (une valeur par défaut ajoutée après coup se range ailleurs). */
const canon = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(canon).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon((v as Record<string, unknown>)[k])).join(',')}}`
  : JSON.stringify(v ?? null)
const same = (a: unknown, b: unknown) => canon(a) === canon(b)

// ───────────── Lecture pour le back-office ─────────────

export async function loadDoc(event: H3Event, type: string, id: string) {
  const db = useDb(event)
  const { entries, entryLocales } = schema
  const [entry] = await db.select().from(entries).where(and(eq(entries.id, id), eq(entries.type, type)))
  if (!entry) return null
  const [rows, [review]] = await Promise.all([
    db.select().from(entryLocales).where(eq(entryLocales.entryId, id)),
    db.select().from(schema.reviewRequests).where(eq(schema.reviewRequests.entryId, id)),
  ])
  return {
    id,
    type,
    shared: entry.sharedDraft,
    updatedAt: entry.updatedAt,
    /** À renvoyer dans `baseVersion` à l'enregistrement, pour détecter une modification faite entre-temps. */
    version: entry.version,
    createdBy: entry.createdBy,
    /** Demande de publication en attente, s'il y en a une. */
    review: review ? { by: review.requestedByName, byId: review.requestedBy, note: review.note, at: review.createdAt } : null,
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
      const def = findDef(doc.type)
      if (!def) continue
      const mine = rows.filter(r => r.entryId === doc.id)
      const main = mine.find(r => r.locale === config.site.defaultLocale) ?? mine[0]
      const values = { ...doc.sharedDraft, ...main?.draft } as Values
      titles.set(doc.id, def.kind === 'collection' ? String(values[def.titleField] ?? '') || 'Sans titre' : def.label)
    }
  }
  return titles
}

// ───────────── Enregistrement ─────────────

/**
 * Corps d'un enregistrement. Deux écritures possibles, à ne pas mélanger dans une même demande :
 *
 * - **par parties** (celle du formulaire) : `shared` et `locales.<langue>.values`. Chaque partie envoyée remplace
 *   la partie entière ; l'appelant doit savoir quels champs sont traduits. Une valeur rangée dans la mauvaise partie
 *   ou un nom de champ inconnu est refusé (422), il n'est jamais ignoré.
 * - **à plat** : `values`, les valeurs par nom de champ pour une langue (`locale`, par défaut celle du site) ; le serveur
 *   les range lui-même. Seuls les champs cités changent, les autres gardent leur valeur ; `null` vide un champ.
 *   `seo` s'écrit `{ title, description, image, noindex }`. Les autres langues se donnent dans `translations`,
 *   avec les seuls champs traduits. Exemple :
 *   `{ "values": { "title": "Droit social", "fromPrice": 150 }, "translations": { "en": { "values": { "title": "Employment law" } } }, "publish": ["fr", "en"] }`
 */
type SaveBody = {
  /** Champs communs aux langues. Absents : ils ne sont pas modifiés. */
  shared?: Values
  /** Langues modifiées. Une langue absente n'est pas touchée. */
  locales?: Record<string, { slug?: string | null; values?: Values }>
  /** Écriture à plat : valeurs par nom de champ, communes ou traduites, pour la langue `locale`. */
  values?: Values
  /** Écriture à plat : langue de `values` et de `slug`. Défaut : la langue par défaut du site. */
  locale?: string
  /** Écriture à plat : adresse de la page dans la langue `locale`. */
  slug?: string | null
  /** Écriture à plat : les autres langues, avec leurs champs traduits. */
  translations?: Record<string, { slug?: string | null; values?: Values }>
  /**
   * À la création dans une collection : identifiant choisi par l'appelant (format UUID). Sert à l'outil d'import,
   * qui retrouve ainsi ses contenus d'un lancement à l'autre. Refusé (409) s'il est déjà pris.
   */
  id?: string
  /** Simulation : tout est vérifié (droits, valeurs, conflits) mais rien n'est écrit. Réponse : { dryRun, id, created, changed, published }. */
  dryRun?: boolean
  /** Langues à publier avec cet enregistrement. */
  publish?: string[]
  /** Langues à retirer du site. */
  unpublish?: string[]
  /**
   * Numéro de version lu par le formulaire à son chargement. Si une partie envoyée (champs communs ou langue)
   * a été modifiée depuis par quelqu'un d'autre, l'enregistrement est refusé avec un statut 409.
   * Absent : aucune vérification (appel direct de l'API).
   */
  baseVersion?: number
  /** Enregistrer quand même, par-dessus les modifications faites entre-temps. */
  force?: boolean
  /** À la création dans une collection à ordre manuel : identifiant du contenu après lequel placer le nouveau. */
  after?: string
}
type Author = { id: string; name: string; email: string; role: string; types?: string[] | null; custom?: CustomRights | null }
type Origin = 'restore' | 'duplicate'

/**
 * Refus d'enregistrer : le contenu a changé depuis que le formulaire l'a lu.
 * Le nom et la date viennent de l'historique (la version la plus récente qui touche une partie en conflit).
 */
async function conflictError(event: H3Event, entry: EntryRow, parts: string[], base: number, user: Author) {
  const db = useDb(event)
  const { revisions } = schema
  const recent = await db.select({ changed: revisions.changed, authorId: revisions.authorId, authorName: revisions.authorName, createdAt: revisions.createdAt })
    .from(revisions).where(and(eq(revisions.entryId, entry.id), gt(revisions.version, base))).orderBy(desc(revisions.version)).limit(MAX_REVISIONS)
  const hit = recent.find(r => r.changed.some(p => parts.includes(p)))
  const authorId = hit ? hit.authorId : entry.updatedBy
  let by = hit?.authorName ?? null
  if (!hit && authorId) by = (await db.select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.id, authorId)))[0]?.name ?? null
  const self = authorId === user.id
  return createError({
    statusCode: 409,
    message: `${self ? 'Vous avez modifié ce contenu dans une autre fenêtre' : `${by ?? 'Une autre personne'} a modifié ce contenu`} depuis que vous l'avez ouvert ici. Vos modifications ne sont pas encore enregistrées.`,
    data: { conflict: { by, self, at: hit?.createdAt ?? entry.updatedAt, parts, version: entry.version } },
  })
}

const BODY_KEYS = ['shared', 'locales', 'values', 'locale', 'slug', 'translations', 'publish', 'unpublish', 'baseVersion', 'force', 'after', 'id', 'dryRun']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
type FieldErrors = Record<string, Record<string, string>>

/** Refus d'une demande dont des valeurs sont inconnues ou mal rangées : rien n'est enregistré. */
function refuse(problems: FieldErrors) {
  const messages = Object.values(problems).flatMap(p => Object.values(p))
  return createError({ statusCode: 422, message: messages.length === 1 ? messages[0]! : `Rien n'a été enregistré : ${messages.join(' ')}`, data: { errors: problems } })
}

export async function saveDoc(event: H3Event, type: string, id: string | null) {
  const user = await requireUser(event)
  const body = await readBody<SaveBody>(event) ?? {}
  if (typeof body !== 'object' || Array.isArray(body)) throw createError({ statusCode: 400, message: 'Un objet JSON est attendu.' })
  return writeDoc(event, type, id, body, user, { strict: true })
}

/**
 * `strict` : la demande vient de l'API. Tout ce qu'elle contient d'inconnu ou de mal rangé est refusé.
 * Les appels internes (restauration d'une version, copie) rejouent des valeurs lues en base, parfois plus anciennes
 * que la configuration : ce qui n'a plus de champ y est simplement laissé de côté.
 */
async function writeDoc(event: H3Event, type: string, id: string | null, request: SaveBody, user: Author, options: { origin?: Origin; strict?: boolean } = {}) {
  const { origin, strict = false } = options
  let body = request
  const def = getDef(type)
  assertAccess(user, type, 'edit')
  if (strict) {
    const stray = Object.keys(body).filter(key => !BODY_KEYS.includes(key))
    if (stray.length) throw createError({ statusCode: 400, message: `Clé inconnue dans la demande : ${stray.map(k => `« ${k} »`).join(', ')}. Les valeurs des champs se donnent dans values (à plat), ou dans shared et locales.` })
  }
  const db = useDb(event)
  const { entries, entryLocales, revisions } = schema
  const fields = def.fields as Fields
  const parts = partition(fields)
  const system = def.seo ? ['seo'] : []
  const now = new Date()

  let existing: EntryRow | undefined
  let rows: LocaleRow[] = []
  if (id) {
    ;[existing] = await db.select().from(entries).where(and(eq(entries.id, id), eq(entries.type, type)))
    // Une page unique existe dès qu'elle est déclarée : son premier enregistrement la crée.
    if (!existing && !(def.kind === 'singleton' && id === type)) throw createError({ statusCode: 404, message: 'Contenu introuvable.' })
    if (existing) {
      assertEntryAccess(user, type, existing, 'edit')
      rows = await db.select().from(entryLocales).where(eq(entryLocales.entryId, id))
    }
  }
  else if (strict && body.id !== undefined) {
    if (typeof body.id !== 'string' || !UUID.test(body.id)) throw createError({ statusCode: 400, message: 'id : un identifiant au format UUID est attendu (ou aucun : le back-office en choisit un).' })
    const [taken] = await db.select({ id: entries.id }).from(entries).where(eq(entries.id, body.id))
    if (taken) throw createError({ statusCode: 409, message: 'Un contenu porte déjà cet identifiant.' })
  }
  const entryId = id ?? (strict && body.id ? body.id : crypto.randomUUID())
  const byLocale = new Map(rows.map(r => [r.locale, r]))
  // Champs réservés : pour qui n'a pas le droit de les modifier, la valeur en base est conservée quoi qu'envoie le formulaire.
  const locked = canEditRestricted(user) ? [] : Object.entries(fields).filter(([, f]) => f.restricted).map(([key]) => key)

  if (strict) {
    const problems: FieldErrors = {}
    const note = (part: string, key: string, message: string) => { (problems[part] ??= {})[key] = message }
    const flat = body.values !== undefined || body.translations !== undefined
    if (flat) {
      if (body.shared !== undefined || body.locales !== undefined) throw createError({ statusCode: 400, message: 'values et translations (écriture à plat) ne se combinent pas avec shared et locales : choisissez l\'une des deux écritures.' })
      const main = body.locale ?? config.site.defaultLocale
      if (!config.site.locales.includes(main)) throw createError({ statusCode: 400, message: `locale : langue inconnue « ${main} ». Langues du site : ${config.site.locales.join(', ')}.` })
      const isRecord = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v)
      if (body.values !== undefined && !isRecord(body.values)) throw createError({ statusCode: 400, message: 'values : un objet { nomDuChamp: valeur } est attendu.' })
      if (body.translations !== undefined && !isRecord(body.translations)) throw createError({ statusCode: 400, message: 'translations : un objet { langue: { values } } est attendu.' })

      const given = splitFlat(fields, body.values ?? {}, !!def.seo)
      for (const key of given.unknown) note(main, key, strayMessage({ key, reason: 'unknown' }, def.label))
      const byLang: Record<string, { slug?: string | null; values: Values }> = { [main]: { slug: body.slug, values: given.localized } }
      for (const [locale, translation] of Object.entries(body.translations ?? {})) {
        if (!config.site.locales.includes(locale)) { note(locale, '_', `Langue inconnue « ${locale} ». Langues du site : ${config.site.locales.join(', ')}.`); continue }
        if (locale === main) { note(locale, '_', `La langue « ${locale} » est celle de values : ses valeurs se donnent là, pas dans translations.`); continue }
        if (!isRecord(translation) || (translation.values !== undefined && !isRecord(translation.values))) { note(locale, '_', `translations.${locale} : un objet { values, slug } est attendu.`); continue }
        const translated = splitFlat(fields, translation.values ?? {}, !!def.seo)
        for (const key of translated.unknown) note(locale, key, strayMessage({ key, reason: 'unknown' }, def.label))
        for (const key of Object.keys(translated.shared))
          note(locale, key, key === 'seo' ? 'Dans seo, image et noindex sont communs à toutes les langues : ils se donnent dans values, pas dans une traduction.' : `« ${key} » est commun à toutes les langues : sa valeur se donne dans values, pas dans translations.${locale}.`)
        byLang[locale] = { slug: translation.slug, values: translated.localized }
      }
      // Un champ réservé envoyé avec une autre valeur que celle en base : refusé, plutôt qu'ignoré sans le dire.
      for (const key of locked) {
        const reserved = `« ${key} » est un champ réservé : votre rôle ne peut pas le modifier.`
        if (key in given.shared && !same(given.shared[key], existing?.sharedDraft[key])) note(main, key, reserved)
        for (const [locale, part] of Object.entries(byLang)) if (key in part.values && !same(part.values[key], byLocale.get(locale)?.draft[key])) note(locale, key, reserved)
      }
      if (Object.keys(problems).length) throw refuse(problems)

      // Fusion avec ce qui est en base : seuls les champs cités changent.
      const touchesShared = Object.keys(given.shared).length > 0
      const locales: NonNullable<SaveBody['locales']> = {}
      const wanted = new Set(Object.entries(byLang).filter(([, part]) => Object.keys(part.values).length || part.slug != null).map(([locale]) => locale))
      // Publier une langue, c'est l'envoyer : une langue à publier est reprise telle qu'elle est en base.
      for (const locale of body.publish ?? []) if (byLocale.has(locale)) wanted.add(locale)
      // Sans brouillons, les champs communs ne sont mis en ligne qu'avec une langue : celle de la demande les accompagne.
      if (!def.drafts && touchesShared && byLocale.has(main)) wanted.add(main)
      for (const locale of wanted) {
        const part = byLang[locale]
        locales[locale] = { slug: part?.slug ?? undefined, values: mergeValues(pick(parts.localized, byLocale.get(locale)?.draft, system), part?.values ?? {}) }
      }
      const { values: _v, locale: _l, slug: _s, translations: _t, ...rest } = body
      body = { ...rest, locales, ...(touchesShared ? { shared: mergeValues(pick(parts.shared, existing?.sharedDraft, system), given.shared) } : {}) }
    }
    else {
      for (const stray of strayKeys('shared', fields, body.shared, existing?.sharedDraft, system)) note('shared', stray.key, strayMessage(stray, def.label))
      for (const [locale, part] of Object.entries(body.locales ?? {})) {
        if (!config.site.locales.includes(locale)) { note(locale, '_', `Langue inconnue « ${locale} ». Langues du site : ${config.site.locales.join(', ')}.`); continue }
        for (const stray of strayKeys('localized', fields, part?.values, byLocale.get(locale)?.draft, system)) note(locale, stray.key, strayMessage(stray, def.label, locale))
      }
      if (Object.keys(problems).length) throw refuse(problems)
    }
  }

  // Listes d'images : `['id']` est accepté et enregistré sous la forme `[{ media: 'id' }]`.
  const shared = normalizeValues(parts.shared, sanitizeRichText(parts.shared, applyDefaults(parts.shared, pick(parts.shared, body.shared ?? existing?.sharedDraft ?? {}, system))))
  // Ce que le formulaire ne connaît pas (champ retiré de la configuration, valeur mise de côté par une migration) reste en base.
  Object.assign(shared, unknownValues(parts.shared, existing?.sharedDraft, system))
  const keepLocked = (target: Values, part: Fields, stored: Values | undefined) => {
    for (const key of locked) {
      if (!(key in part)) continue
      if (stored?.[key] === undefined) delete target[key]
      else target[key] = stored[key]
    }
  }
  keepLocked(shared, parts.shared, existing?.sharedDraft)
  applyDefaults(parts.shared, shared)
  const incoming = Object.entries(body.locales ?? {}).filter(([locale]) => config.site.locales.includes(locale))
  const unpublish = body.unpublish ?? []
  const requested = (def.drafts ? body.publish ?? [] : []).filter(l => !unpublish.includes(l))
  /** Langues réellement publiées par cet enregistrement. */
  const publish: string[] = []

  // Verrou optimiste, partie par partie : deux personnes qui travaillent sur deux langues différentes ne se bloquent pas,
  // mais on ne remplace jamais sans prévenir une partie que quelqu'un d'autre vient de modifier.
  // Publier touche aussi les champs communs, puisqu'ils sont mis en ligne avec la langue.
  if (existing && typeof body.baseVersion === 'number' && !body.force) {
    const base = body.baseVersion
    const touchesShared = body.shared !== undefined || requested.length > 0 || (!def.drafts && incoming.length > 0)
    const stale = [
      ...(touchesShared && existing.sharedVersion > base ? ['shared'] : []),
      ...[...new Set([...incoming.map(([l]) => l), ...requested, ...unpublish])].filter(l => (byLocale.get(l)?.version ?? 0) > base),
    ]
    if (stale.length) throw await conflictError(event, existing, stale, base, user)
  }

  const errors: Record<string, Record<string, string>> = {}
  const upserts: (typeof entryLocales.$inferInsert)[] = []
  /** Anciennes adresses de pages en ligne, à rediriger vers la nouvelle. */
  const moved: { locale: string; slug: string }[] = []

  for (const [locale, input] of incoming) {
    const prev = byLocale.get(locale)
    const values = normalizeValues(parts.localized, sanitizeRichText(parts.localized, pick(parts.localized, input.values ?? {}, system)))
    if (!prev && Object.values(values).every(isEmpty)) continue // langue pas encore traduite
    applyDefaults(parts.localized, values)
    Object.assign(values, unknownValues(parts.localized, prev?.draft, system))
    keepLocked(values, parts.localized, prev?.draft)

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
      status: 'draft', // calculé plus bas, quand les champs communs publiés sont connus
      updatedAt: now,
      publishedAt: publishing ? now : published ? prev?.publishedAt ?? null : null,
    })
  }
  // Retrait d'une langue non envoyée dans le formulaire.
  for (const locale of unpublish) {
    const prev = byLocale.get(locale)
    if (prev && !upserts.some(u => u.locale === locale)) upserts.push({ ...prev, published: null, publishedAt: null })
  }

  for (const locale of requested) if (!publish.includes(locale)) (errors[locale] ??= {})._ = 'Rien à publier dans cette langue.'
  // Tout ce qui change le site tout de suite (mise en ligne, retrait, nouvelle adresse d'une page publiée) demande le droit de publier.
  // Le contrôle porte sur ce qui est demandé, même si rien ne serait finalement publié : le refus est alors clair.
  if (requested.length || publish.length || unpublish.length || moved.length) assertAccess(user, type, 'publish')
  if (Object.keys(errors).length) throw createError({ statusCode: 422, message: 'Certains champs sont à corriger.', data: { errors } })

  const sharedPublished = publish.length ? shared : existing?.sharedPublished ?? null
  /** « Modifications en attente » : le brouillon de la langue ou celui des champs communs diffère de ce qui est en ligne. */
  const statusOf = (draft: unknown, published: unknown) =>
    (!published ? 'draft' : same(draft, published) && same(shared, sharedPublished) ? 'published' : 'changed')
  for (const row of upserts) row.status = statusOf(row.draft, row.published)

  // Ce qui change réellement : sert au numéro de version, à l'historique et à la détection des conflits.
  const sharedChanged = !existing || !same(shared, existing.sharedDraft) || !same(sharedPublished, existing.sharedPublished)
  const changedLocales = upserts.filter((row) => {
    const prev = byLocale.get(row.locale)
    return !prev || prev.slug !== row.slug || !same(prev.draft, row.draft) || !same(prev.published, row.published)
  }).map(r => r.locale)
  const changed = [...(sharedChanged ? ['shared'] : []), ...changedLocales]
  const version = (existing?.version ?? 0) + (changed.length ? 1 : 0)
  // Une langue envoyée à l'identique n'est pas réécrite, sauf si on la (re)publie.
  const writes = upserts.filter(u => changedLocales.includes(u.locale) || publish.includes(u.locale))
    .map(u => ({ ...u, version: changedLocales.includes(u.locale) ? version : byLocale.get(u.locale)?.version ?? 0 }))

  if (body.dryRun) {
    // Simulation : tout a été vérifié comme pour un vrai enregistrement, mais rien n'est écrit.
    return { dryRun: true as const, id: entryId, created: !existing, changed, published: publish, unpublished: unpublish.filter(l => byLocale.get(l)?.published) }
  }

  const statements: any[] = []

  if (existing && changed.length) {
    // Le numéro de version est réservé par une requête conditionnelle : si deux enregistrements arrivent
    // au même instant, un seul l'obtient, l'autre est refusé comme un conflit.
    const claimed = await db.update(entries).set({ version }).where(and(eq(entries.id, entryId), eq(entries.version, existing.version))).returning({ id: entries.id })
    if (!claimed.length) {
      const [fresh] = await db.select().from(entries).where(eq(entries.id, entryId))
      if (!fresh) throw createError({ statusCode: 404, message: 'Contenu introuvable.' })
      throw await conflictError(event, fresh, changed, existing.version, user)
    }
    statements.push(db.update(entries).set({
      sharedDraft: shared, sharedPublished, updatedAt: now, updatedBy: user.id,
      sharedVersion: sharedChanged ? version : existing.sharedVersion,
    }).where(eq(entries.id, entryId)))
  }
  else if (!existing) {
    let position: number | undefined
    if (def.kind === 'collection' && def.orderable && body.after) {
      // Juste après le contenu indiqué : les suivants sont décalés d'un rang.
      const [ref] = await db.select({ position: entries.position }).from(entries).where(and(eq(entries.id, body.after), eq(entries.type, type)))
      if (ref) {
        position = ref.position + 1
        statements.push(db.update(entries).set({ position: sql`${entries.position} + 1` }).where(and(eq(entries.type, type), gt(entries.position, ref.position))))
      }
    }
    if (position === undefined) {
      const [last] = await db.select({ value: max(entries.position) }).from(entries).where(eq(entries.type, type))
      position = (last?.value ?? 0) + 1
    }
    statements.push(db.insert(entries).values({
      id: entryId, type, position, sharedDraft: shared, sharedPublished, createdAt: now, updatedAt: now,
      version, sharedVersion: version, updatedBy: user.id, createdBy: user.id,
    }))
  }
  for (const row of writes) {
    const { entryId: _e, locale: _l, ...set } = row
    statements.push(db.insert(entryLocales).values(row).onConflictDoUpdate({ target: [entryLocales.entryId, entryLocales.locale], set }))
  }
  const { redirects } = schema
  for (const old of moved)
    statements.push(db.insert(redirects).values({ type, locale: old.locale, slug: old.slug, entryId, createdAt: now }).onConflictDoUpdate({ target: [redirects.type, redirects.locale, redirects.slug], set: { entryId } }))
  // Une adresse en service n'est jamais redirigée ailleurs.
  for (const row of writes)
    if (row.slug) statements.push(db.delete(redirects).where(and(eq(redirects.type, type), eq(redirects.locale, row.locale), eq(redirects.slug, row.slug))))

  // Les langues non réécrites changent quand même de statut si les champs communs ne sont plus ceux en ligne (ou le redeviennent).
  for (const row of rows) {
    if (writes.some(w => w.locale === row.locale)) continue
    const status = statusOf(row.draft, row.published)
    if (status !== row.status) statements.push(db.update(entryLocales).set({ status }).where(and(eq(entryLocales.entryId, entryId), eq(entryLocales.locale, row.locale))))
  }

  // Historique : une version par enregistrement qui change quelque chose, avec l'état complet du contenu.
  if (changed.length) {
    const snapshot = (sharedValues: Values, list: { locale: string; slug?: string | null; draft: Values }[]) =>
      ({ shared: sharedValues, locales: Object.fromEntries(list.map(r => [r.locale, { slug: r.slug ?? null, values: r.draft }])) })
    if (existing && (rows.length || !isEmpty(existing.sharedDraft))) {
      // Contenu plus ancien que l'historique : son état d'avant est gardé aussi, pour pouvoir y revenir.
      const [known] = await db.select({ id: revisions.id }).from(revisions).where(eq(revisions.entryId, entryId)).limit(1)
      if (!known) {
        statements.push(db.insert(revisions).values({
          id: crypto.randomUUID(), entryId, type, version: existing.version, snapshot: snapshot(existing.sharedDraft, rows),
          changed: [], published: [], unpublished: [], origin: 'initial', createdAt: existing.updatedAt,
        }))
      }
    }
    statements.push(db.insert(revisions).values({
      id: crypto.randomUUID(), entryId, type, version,
      snapshot: snapshot(shared, [...rows.filter(r => !writes.some(w => w.locale === r.locale)), ...writes]),
      changed, published: publish, unpublished: unpublish.filter(l => byLocale.get(l)?.published),
      origin, authorId: user.id, authorName: user.name, createdAt: now,
    }))
    statements.push(db.delete(revisions).where(and(
      eq(revisions.entryId, entryId),
      notInArray(revisions.id, db.select({ id: revisions.id }).from(revisions).where(eq(revisions.entryId, entryId)).orderBy(desc(revisions.version), desc(revisions.createdAt)).limit(MAX_REVISIONS)),
    )))
  }
  // Publier ou retirer du site répond à la demande de publication en attente, s'il y en a une.
  if (existing && (publish.length || unpublish.length)) statements.push(db.delete(schema.reviewRequests).where(eq(schema.reviewRequests.entryId, entryId)))
  if (statements.length) await db.batch(statements as [any, ...any[]])
  // Le site a changé si quelque chose a été publié, retiré, ou si une adresse en ligne a bougé.
  const purged = publish.length || moved.length || unpublish.some(l => byLocale.get(l)?.published) ? await purgeSiteCache(event) : null

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

  const doc = (await loadDoc(event, type, entryId))!
  // `purgeFailed` n'est présent que si le site devait être mis à jour : vrai quand le cache n'a pas pu être vidé.
  return purged === null ? doc : { ...doc, purgeFailed: !purged }
}

// ───────────── Historique et duplication ─────────────

/**
 * Remet une version de l'historique comme brouillon, dans toutes les langues qu'elle contenait. Rien n'est publié.
 * Les adresses des pages ne sont pas restaurées : celle d'une page en ligne ne doit pas changer sans publication.
 */
export async function restoreRevision(event: H3Event, type: string, id: string, revisionId: string) {
  const user = await requireUser(event)
  const def = getDef(type)
  assertAccess(user, type, 'edit')
  // Sans brouillons, enregistrer c'est publier : le formulaire reprend alors la version sans l'enregistrer.
  if (!def.drafts) throw createError({ statusCode: 400, message: 'Ce contenu n\'a pas de brouillon : reprenez la version dans le formulaire, puis enregistrez.' })
  const { revisions } = schema
  const [revision] = await useDb(event).select().from(revisions).where(and(eq(revisions.id, revisionId), eq(revisions.entryId, id), eq(revisions.type, type)))
  if (!revision) throw createError({ statusCode: 404, message: 'Version introuvable.' })
  const locales = Object.fromEntries(Object.entries(revision.snapshot.locales).map(([locale, l]) => [locale, { values: l.values }]))
  return writeDoc(event, type, id, { shared: revision.snapshot.shared, locales, force: true }, user, { origin: 'restore' })
}

/**
 * Copie un contenu d'une collection : brouillon dans toutes les langues présentes, titre « … (copie) »,
 * adresse différente, placé juste après l'original si la collection a un ordre manuel.
 */
export async function duplicateDoc(event: H3Event, type: string, id: string) {
  const user = await requireUser(event)
  const def = getDef(type)
  if (def.kind !== 'collection') throw createError({ statusCode: 400, message: 'Seul un contenu de collection peut être dupliqué.' })
  assertAccess(user, type, 'edit')
  // Sans brouillons, la copie serait publiée d'office : le formulaire la prépare et rien n'existe avant l'enregistrement.
  if (!def.drafts) throw createError({ statusCode: 400, message: 'Cette collection n\'a pas de brouillon : la copie se prépare dans le formulaire.' })
  const source = await loadDoc(event, type, id)
  if (!source) throw createError({ statusCode: 404, message: 'Contenu introuvable.' })
  assertEntryAccess(user, type, source, 'edit')

  const db = useDb(event)
  const { entryLocales, redirects } = schema
  const [used, old] = hasSlug(def)
    ? await Promise.all([
        db.select({ locale: entryLocales.locale, slug: entryLocales.slug }).from(entryLocales).where(eq(entryLocales.type, type)),
        db.select({ locale: redirects.locale, slug: redirects.slug }).from(redirects).where(eq(redirects.type, type)),
      ])
    : [[], []]
  // Ni l'adresse d'un autre contenu, ni une ancienne adresse encore redirigée.
  const taken = new Set([...used, ...old].map(r => `${r.locale}:${r.slug}`))

  const copy = copyValues(def, source.shared, Object.fromEntries(Object.entries(source.locales).map(([l, state]) => [l, state.values])))
  const locales: NonNullable<SaveBody['locales']> = {}
  for (const [locale, state] of Object.entries(source.locales)) {
    const values = copy.locales[locale]!
    let slug: string | undefined
    if (hasSlug(def)) {
      const wanted = slugify(state.slug ? `${state.slug}-copie` : String(({ ...copy.shared, ...values } as Values)[def.slugFrom ?? def.titleField] ?? ''))
      slug = wanted
      for (let n = 2; slug && taken.has(`${locale}:${slug}`); n++) slug = `${wanted}-${n}`
    }
    locales[locale] = { slug: slug || undefined, values }
  }
  return writeDoc(event, type, null, { shared: copy.shared, locales, after: id }, user, { origin: 'duplicate' })
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
