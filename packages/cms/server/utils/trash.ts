/**
 * Corbeille (règles : shared/trash.ts ; tables cms_trash et cms_trash_revisions).
 *
 * Un contenu ou un fichier supprimé est **retiré de ses tables d'origine** et gardé ici en entier. Le site, l'API
 * publique, le plan du site, les relations, les galeries, la recherche du back-office ne lisent que les tables
 * d'origine : un élément à la corbeille n'existe donc plus pour eux, sans condition à ajouter (ni à oublier) dans
 * chaque lecture. La restauration remet les lignes à leur place, avec les mêmes identifiants : les contenus qui
 * citaient l'élément le retrouvent.
 *
 * Fichiers : l'objet reste dans R2 tant que le fichier est à la corbeille (il faut pouvoir le restaurer), mais la
 * route /media ne le sert plus (voir `trashedMedia`). Il n'est effacé de R2 qu'à la suppression définitive.
 */
import { and, eq, inArray, lt, sql } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { TRASH_DAYS, canPurgeTrash, canSeeTrashItem, freeSlug, restoresPublished, trashDaysLeft } from '../../shared/trash'
import { cmsObjectPosition } from '../../shared/media'
import type { ActivityInput } from './activity'

type EntryRow = typeof schema.entries.$inferSelect
type LocaleRow = typeof schema.entryLocales.$inferSelect
type RedirectRow = typeof schema.redirects.$inferSelect
type ReviewRow = typeof schema.reviewRequests.$inferSelect
/** `focus` est facultatif : un fichier mis à la corbeille avant l'arrivée du point d'intérêt n'en a pas. */
type MediaRow = Omit<typeof schema.media.$inferSelect, 'focus'> & { focus?: { x: number; y: number } | null }
type TrashRow = typeof schema.trash.$inferSelect
type User = Awaited<ReturnType<typeof requireUser>>

/** Les lignes d'origine. Passées par du JSON, leurs dates sont des textes : `revive*` les remet en dates. */
type EntrySnapshot = { entry: EntryRow; locales: LocaleRow[]; redirects: RedirectRow[]; review: ReviewRow | null }
type MediaSnapshot = { media: MediaRow }
export type TrashSnapshot = EntrySnapshot | MediaSnapshot

const date = (value: unknown) => new Date(value as string)
const reviveEntry = (r: EntryRow): EntryRow => ({ ...r, createdAt: date(r.createdAt), updatedAt: date(r.updatedAt) })
const reviveLocale = (r: LocaleRow): LocaleRow => ({ ...r, updatedAt: date(r.updatedAt), publishedAt: r.publishedAt ? date(r.publishedAt) : null })
const reviveRedirect = (r: RedirectRow): RedirectRow => ({ ...r, createdAt: date(r.createdAt) })
const reviveReview = (r: ReviewRow): ReviewRow => ({ ...r, createdAt: date(r.createdAt) })
const reviveMedia = (r: MediaRow): MediaRow => ({ ...r, createdAt: date(r.createdAt) })

/**
 * Déplace l'historique d'un contenu vers la corbeille (ou l'en fait revenir) par une seule requête « insert … select » :
 * aucune limite de taille, et la requête entre dans le même lot que le reste. Les colonnes suivent l'ordre des tables.
 */
function moveRevisions(event: H3Event, direction: 'toTrash' | 'fromTrash', trashId: string, entryId: string) {
  const db = useDb(event)
  const { revisions: r, trashRevisions: t } = schema
  if (direction === 'toTrash') {
    return db.insert(t).select(db.select({
      id: r.id, trashId: sql<string>`${trashId}`.as('trash_id'), entryId: r.entryId, type: r.type, version: r.version, snapshot: r.snapshot, changed: r.changed,
      published: r.published, unpublished: r.unpublished, origin: r.origin, authorId: r.authorId, authorName: r.authorName, createdAt: r.createdAt,
    }).from(r).where(eq(r.entryId, entryId)))
  }
  return db.insert(r).select(db.select({
    id: t.id, entryId: t.entryId, type: t.type, version: t.version, snapshot: t.snapshot, changed: t.changed,
    published: t.published, unpublished: t.unpublished, origin: t.origin, authorId: t.authorId, authorName: t.authorName, createdAt: t.createdAt,
  }).from(t).where(eq(t.trashId, trashId)))
}
const actorOf = (user: User) => ({ id: user.id, name: user.name, email: user.email })

export async function isInTrash(event: H3Event, kind: 'entry' | 'media', itemId: string) {
  const { trash } = schema
  const [row] = await useDb(event).select({ id: trash.id }).from(trash).where(and(eq(trash.kind, kind), eq(trash.itemId, itemId))).limit(1)
  return row?.id ?? null
}

/**
 * Le fichier de cette clé R2 est-il à la corbeille ? La clé commence par l'identifiant du fichier (`<id>/<nom>`).
 * Sert à la route publique /media : un fichier à la corbeille n'est plus servi.
 */
export async function trashedMedia(event: H3Event, key: string) {
  const { trash } = schema
  const rows = await useDb(event).select({ snapshot: trash.snapshot }).from(trash).where(and(eq(trash.kind, 'media'), eq(trash.itemId, key.split('/')[0] ?? '')))
  return rows.some(r => (r.snapshot as unknown as MediaSnapshot).media?.key === key)
}

// ───────────── Mise à la corbeille ─────────────

/** Met un contenu d'une collection à la corbeille, avec ses langues, son historique, ses redirections. */
export async function trashEntry(event: H3Event, user: User, type: string, id: string) {
  assertAccess(user, type, 'delete')
  if (getDef(type).kind !== 'collection') throw createError({ statusCode: 400, message: 'Une page unique ne se supprime pas.' })
  const db = useDb(event)
  const { entries, entryLocales, redirects, revisions, reviewRequests, trash } = schema
  const [entry] = await db.select().from(entries).where(and(eq(entries.id, id), eq(entries.type, type)))
  if (!entry) throw createError({ statusCode: 404, message: 'Contenu introuvable.' })
  assertEntryAccess(user, type, entry, 'delete')
  const [locales, oldPaths, [review], titles] = await Promise.all([
    db.select().from(entryLocales).where(eq(entryLocales.entryId, id)),
    db.select().from(redirects).where(eq(redirects.entryId, id)),
    db.select().from(reviewRequests).where(eq(reviewRequests.entryId, id)),
    entryTitles(event, [id]),
  ])
  const title = titles.get(id) ?? 'Sans titre'
  const trashId = crypto.randomUUID()
  const snapshot: EntrySnapshot = { entry, locales, redirects: oldPaths, review: review ?? null }
  // Un seul lot : le contenu est soit à sa place, soit à la corbeille, jamais perdu entre les deux.
  await db.batch([
    db.insert(trash).values({ id: trashId, kind: 'entry', itemId: id, type, title, ownerId: entry.createdBy, snapshot: snapshot as unknown as Record<string, unknown>, deletedAt: new Date(), deletedBy: user.id, deletedByName: user.name }),
    moveRevisions(event, 'toTrash', trashId, id),
    db.delete(redirects).where(eq(redirects.entryId, id)),
    db.delete(revisions).where(eq(revisions.entryId, id)),
    db.delete(reviewRequests).where(eq(reviewRequests.entryId, id)),
    db.delete(entryLocales).where(eq(entryLocales.entryId, id)),
    db.delete(entries).where(eq(entries.id, id)),
  ])
  const purged = await purgeSiteCache(event)
  emitCmsEvents(event, [{ name: 'entry.deleted', type, id, title, user: actorOf(user) }])
  sweepTrashLater(event)
  return { ok: true, trashId, days: TRASH_DAYS, purgeFailed: !purged }
}

/** Met un fichier à la corbeille. L'objet R2 est gardé pour la restauration, mais n'est plus servi. */
export async function trashMedia(event: H3Event, user: User, row: MediaRow) {
  const db = useDb(event)
  const trashId = crypto.randomUUID()
  await db.batch([
    db.insert(schema.trash).values({ id: trashId, kind: 'media', itemId: row.id, type: null, title: row.name, ownerId: null, snapshot: { media: row } as unknown as Record<string, unknown>, deletedAt: new Date(), deletedBy: user.id, deletedByName: user.name }),
    db.delete(schema.media).where(eq(schema.media.id, row.id)),
  ])
  const purged = await purgeSiteCache(event)
  logActivity(event, { action: 'media.deleted', actor: user, details: { name: row.name }, target: { kind: 'media', id: row.id } })
  sweepTrashLater(event)
  return { ok: true, trashId, days: TRASH_DAYS, purgeFailed: !purged }
}

// ───────────── Lecture ─────────────

const visibleTo = (user: User, row: Pick<TrashRow, 'kind' | 'type' | 'ownerId'>) => canSeeTrashItem(user, row, row.type ? findDef(row.type) : null)

/** Ce que la personne peut voir de la corbeille, du plus récemment supprimé au plus ancien. */
export async function listTrash(event: H3Event, user: User) {
  await sweepTrash(event)
  const rows = await useDb(event).select().from(schema.trash).orderBy(sql`${schema.trash.deletedAt} desc`)
  const now = Date.now()
  return rows.filter(row => visibleTo(user, row)).map((row) => {
    const common = { id: row.id, kind: row.kind, title: row.title, deletedAt: row.deletedAt, deletedBy: row.deletedByName, daysLeft: trashDaysLeft(row.deletedAt, now) }
    if (row.kind === 'media') {
      const { media } = row.snapshot as unknown as MediaSnapshot
      // Vignette : servie seulement à qui voit la corbeille (paramètre `corbeille`, voir la route /media).
      return { ...common, kind: 'media' as const, mime: media.mime, size: media.size, thumbnail: media.mime.startsWith('image/') ? `${thumbUrl(media.key)}&corbeille=1` : null, thumbnailPosition: cmsObjectPosition(media) ?? null }
    }
    const { locales } = row.snapshot as unknown as EntrySnapshot
    const def = row.type ? findDef(row.type) : undefined
    return {
      ...common, kind: 'entry' as const, type: row.type, typeLabel: def?.label ?? row.type ?? '',
      /** Le contenu était en ligne : le restaurer le remet sur le site (si la personne peut publier). */
      wasPublished: locales.some(l => l.published != null),
      restoresPublished: restoresPublished(user, row.type ?? '', def),
    }
  })
}

// ───────────── Restauration ─────────────

async function restoreEntry(event: H3Event, user: User, row: TrashRow) {
  const db = useDb(event)
  const { entries, entryLocales, redirects, reviewRequests, trash, trashRevisions } = schema
  const snapshot = row.snapshot as unknown as EntrySnapshot
  const type = row.type!
  const def = findDef(type)
  const id = row.itemId
  const [taken] = await db.select({ id: entries.id }).from(entries).where(eq(entries.id, id))
  if (taken) throw createError({ statusCode: 409, message: 'Un contenu porte déjà cet identifiant : la restauration est impossible.' })

  // Qui ne peut pas publier ne remet rien en ligne : le contenu revient alors en brouillon.
  const online = restoresPublished(user, type, def)
  const entry = reviveEntry(snapshot.entry)
  if (!online) entry.sharedPublished = null
  const locales = snapshot.locales.map(reviveLocale).map(l => (online ? l : { ...l, published: null, publishedAt: null, status: 'draft' as const }))

  // Adresse reprise entre-temps par un autre contenu : le contenu restauré en reçoit une voisine (« …-2 »).
  const renamed: { locale: string; from: string; to: string }[] = []
  for (const locale of locales) {
    if (!locale.slug) continue
    const used = new Set((await db.select({ slug: entryLocales.slug }).from(entryLocales)
      .where(and(eq(entryLocales.type, type), eq(entryLocales.locale, locale.locale), sql`${entryLocales.slug} like ${`${locale.slug.replace(/[\\%_]/g, c => `\\${c}`)}%`} escape '\\'`))).map(r => r.slug))
    const slug = freeSlug(locale.slug, s => used.has(s))
    if (slug !== locale.slug) { renamed.push({ locale: locale.locale, from: locale.slug, to: slug }); locale.slug = slug }
  }
  // Anciennes adresses redirigées : seulement celles qui ne servent à personne aujourd'hui.
  const live = new Set((await db.select({ locale: entryLocales.locale, slug: entryLocales.slug }).from(entryLocales).where(eq(entryLocales.type, type))).map(r => `${r.locale}:${r.slug}`))
  for (const l of locales) if (l.slug) live.add(`${l.locale}:${l.slug}`)
  const oldPaths = snapshot.redirects.map(reviveRedirect).filter(r => !live.has(`${r.locale}:${r.slug}`))

  const statements: unknown[] = []
  // Ordre manuel : le contenu reprend son rang, les suivants se décalent d'une place.
  if (def?.kind === 'collection' && def.orderable)
    statements.push(db.update(entries).set({ position: sql`${entries.position} + 1` }).where(and(eq(entries.type, type), sql`${entries.position} >= ${entry.position}`)))
  statements.push(db.insert(entries).values(entry))
  for (const locale of locales) {
    statements.push(db.insert(entryLocales).values(locale))
    // Une adresse en service n'est jamais redirigée ailleurs.
    if (locale.slug) statements.push(db.delete(redirects).where(and(eq(redirects.type, type), eq(redirects.locale, locale.locale), eq(redirects.slug, locale.slug))))
  }
  for (const old of oldPaths) statements.push(db.insert(redirects).values(old).onConflictDoNothing())
  if (snapshot.review) statements.push(db.insert(reviewRequests).values(reviveReview(snapshot.review)).onConflictDoNothing())
  statements.push(
    moveRevisions(event, 'fromTrash', row.id, id),
    db.delete(trashRevisions).where(eq(trashRevisions.trashId, row.id)),
    db.delete(trash).where(eq(trash.id, row.id)),
  )
  await db.batch(statements as [any, ...any[]])

  const published = locales.some(l => l.published != null)
  const purged = published ? await purgeSiteCache(event) : true
  emitCmsEvents(event, [{ name: 'entry.restored', type, id, title: row.title, user: actorOf(user) }])
  return {
    ok: true, kind: 'entry' as const, type, id, title: row.title, renamed,
    /** Le contenu était en ligne et revient en brouillon : la personne ne peut pas publier. */
    asDraft: !online && snapshot.locales.some(l => l.published != null),
    published, purgeFailed: !purged,
  }
}

async function restoreMedia(event: H3Event, user: User, row: TrashRow) {
  const db = useDb(event)
  const media = reviveMedia((row.snapshot as unknown as MediaSnapshot).media)
  const [taken] = await db.select({ id: schema.media.id }).from(schema.media).where(eq(schema.media.id, media.id))
  if (taken) throw createError({ statusCode: 409, message: 'Un fichier porte déjà cet identifiant : la restauration est impossible.' })
  // Dossier supprimé entre-temps : le fichier revient à la racine de la médiathèque.
  const folders = await listMediaFolders(event)
  const folderId = media.folderId && folders.some(f => f.id === media.folderId) ? media.folderId : null
  await db.batch([
    db.insert(schema.media).values({ ...media, folderId }),
    db.delete(schema.trash).where(eq(schema.trash.id, row.id)),
  ])
  // Les contenus qui citent ce fichier l'affichent de nouveau.
  const purged = await purgeSiteCache(event)
  logActivity(event, { action: 'media.restored', actor: user, details: { name: media.name }, target: { kind: 'media', id: media.id } })
  return { ok: true, kind: 'media' as const, id: media.id, title: row.title, folderId, movedToRoot: !!media.folderId && !folderId, media: toAdminMedia({ ...media, folderId }), purgeFailed: !purged }
}

/** Restaure un élément de la corbeille. Refusé (404) à qui ne pourrait pas le supprimer : il ne le voit pas. */
export async function restoreTrash(event: H3Event, user: User, trashId: string) {
  const [row] = await useDb(event).select().from(schema.trash).where(eq(schema.trash.id, trashId))
  if (!row || !visibleTo(user, row)) throw createError({ statusCode: 404, message: 'Cet élément n\'est plus dans la corbeille.' })
  return row.kind === 'media' ? restoreMedia(event, user, row) : restoreEntry(event, user, row)
}

/** Restaure le fichier à la corbeille qui porte cet identifiant (outil d'import qui renvoie un fichier supprimé). */
export async function restoreTrashedMedia(event: H3Event, user: User, mediaId: string) {
  const trashId = await isInTrash(event, 'media', mediaId)
  return trashId ? restoreMedia(event, user, (await useDb(event).select().from(schema.trash).where(eq(schema.trash.id, trashId)))[0]!) : null
}

// ───────────── Suppression définitive ─────────────

/** Efface pour de bon des éléments de la corbeille : lignes, historique et, pour un fichier, l'objet R2. */
async function destroy(event: H3Event, rows: TrashRow[]) {
  if (!rows.length) return
  const db = useDb(event)
  const files = rows.filter(r => r.kind === 'media').map(r => (r.snapshot as unknown as MediaSnapshot).media)
  if (files.length) {
    // Garde-fou : jamais l'objet d'un fichier présent dans la médiathèque.
    const alive = new Set<string>()
    for (let i = 0; i < files.length; i += 80)
      for (const m of await db.select({ key: schema.media.key }).from(schema.media).where(inArray(schema.media.id, files.slice(i, i + 80).map(f => f.id)))) alive.add(m.key)
    const keys = files.map(f => f.key).filter(key => !alive.has(key))
    // L'objet d'abord : si R2 échoue, la ligne reste à la corbeille et la suppression sera retentée.
    for (let i = 0; i < keys.length; i += 500) await useBucket(event).delete(keys.slice(i, i + 500))
  }
  const ids = rows.map(r => r.id)
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80)
    await db.batch([
      db.delete(schema.trashRevisions).where(inArray(schema.trashRevisions.trashId, chunk)),
      db.delete(schema.trash).where(inArray(schema.trash.id, chunk)),
    ])
  }
}

const purgedLine = (user: User, row: TrashRow): ActivityInput => (row.kind === 'media'
  ? { action: 'media.purged', actor: user, details: { name: row.title } }
  : { action: 'entry.purged', actor: user, details: { title: row.title, typeLabel: (row.type && findDef(row.type)?.label) || row.type || '' } })

/** Supprime définitivement un élément de la corbeille. Administrateur seulement. */
export async function purgeTrashItem(event: H3Event, user: User, trashId: string) {
  if (!canPurgeTrash(user)) throw createError({ statusCode: 403, message: 'Seul un administrateur peut supprimer définitivement.' })
  const [row] = await useDb(event).select().from(schema.trash).where(eq(schema.trash.id, trashId))
  if (!row) throw createError({ statusCode: 404, message: 'Cet élément n\'est plus dans la corbeille.' })
  await destroy(event, [row])
  logActivity(event, purgedLine(user, row))
  return { ok: true }
}

/** Vide la corbeille. Administrateur seulement. */
export async function emptyTrash(event: H3Event, user: User) {
  if (!canPurgeTrash(user)) throw createError({ statusCode: 403, message: 'Seul un administrateur peut vider la corbeille.' })
  const rows = await useDb(event).select().from(schema.trash)
  await destroy(event, rows)
  if (rows.length) logActivity(event, { action: 'trash.emptied', actor: user, details: { count: rows.length }, target: { kind: 'trash' } })
  return { ok: true, count: rows.length }
}

/**
 * Ménage : supprime pour de bon ce qui est à la corbeille depuis plus de TRASH_DAYS jours. Pas de tâche planifiée :
 * il est fait à l'ouverture de la corbeille et à chaque suppression.
 */
export async function sweepTrash(event: H3Event) {
  const rows = await useDb(event).select().from(schema.trash).where(lt(schema.trash.deletedAt, new Date(Date.now() - TRASH_DAYS * 86_400_000)))
  if (!rows.length) return 0
  await destroy(event, rows)
  logActivity(event, { action: 'trash.expired', actor: null, details: { count: rows.length }, target: { kind: 'trash' } })
  return rows.length
}

function sweepTrashLater(event: H3Event) {
  event.waitUntil(sweepTrash(event).catch(error => console.error('[cms] le ménage de la corbeille a échoué', error)))
}
