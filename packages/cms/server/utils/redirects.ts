/**
 * Redirections manuelles et pages introuvables.
 *
 * ── Où les redirections s'appliquent ──
 * Dans le gestionnaire d'erreurs du serveur (server/redirects-error-handler.ts), donc **seulement quand le site s'apprête
 * à répondre 404** : une page qui existe ne coûte rien (aucune lecture en base, aucun code exécuté). Une ancienne
 * adresse coûte une lecture indexée (deux si la destination est une page du site). La réponse de redirection est mise
 * en cache comme une page (`allowSiteCache`) : toute modification purge le cache, elle prend donc effet tout de suite,
 * et le navigateur revérifie à chaque visite (une 301 corrigée n'est pas retenue à vie).
 * En navigation interne (sans rechargement), le navigateur pose la même question à `/_cms/redirect`
 * (app/plugins/cms-redirects.client.ts).
 *
 * ── Pages introuvables ──
 * Chaque 404 d'une adresse plausible est comptée (table cms_not_found), sans adresse IP ni rien de personnel. Pour
 * qu'un afflux de 404 ne se transforme pas en afflux d'écritures :
 * - le bruit des robots est écarté avant tout (`isNoise`) ;
 * - l'écriture part après la réponse (`waitUntil`) ;
 * - au plus une écriture groupée toutes les `FLUSH_MS` par instance du serveur : entre deux, les demandes sont
 *   additionnées en mémoire (`BUFFER_MAX` adresses distinctes au plus, le surplus est abandonné) ;
 * - la table est plafonnée (`NOT_FOUND_MAX` adresses, les plus demandées sont gardées) et oublie ce qui n'est plus
 *   demandé depuis `NOT_FOUND_DAYS` jours ; ce ménage est fait à chaque écriture.
 */
import { and, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm'
import type { H3Event } from 'h3'
import {
  type Hop, type RedirectGraph, type RedirectStatus, type RedirectTarget, NOT_FOUND_DAYS, NOT_FOUND_MAX, REDIRECT_BATCH_MAX,
  canonicalPath, checkRule, cleanReferrer, isNoise, isRedirectStatus, isReservedPath, normalizeSource, normalizeUrlTarget,
  parseRedirectBatch, pathKey, redirectLocation,
} from '../../shared/redirects'

type RuleRow = typeof schema.redirectRules.$inferSelect

/** Les redirections se gèrent comme le reste du site public : administrateur et éditeur. */
export const canManageRedirects = (user: { role: string }) => user.role === 'admin' || user.role === 'editor'

export async function requireRedirectsAccess(event: H3Event) {
  const user = await requireUser(event)
  if (!canManageRedirects(user)) throw createError({ statusCode: 403, message: 'Les redirections sont réservées aux administrateurs et aux éditeurs.' })
  return user
}

const targetOf = (row: RuleRow): RedirectTarget =>
  (row.targetKind === 'page'
    ? { kind: 'page', type: row.targetType ?? '', id: row.targetId ?? '', locale: row.targetLocale ?? cmsConfig.site.defaultLocale }
    : { kind: 'url', url: row.targetUrl ?? '' })

const targetColumns = (target: RedirectTarget) =>
  (target.kind === 'page'
    ? { targetKind: 'page' as const, targetType: target.type, targetId: target.id, targetLocale: target.locale, targetUrl: null }
    : { targetKind: 'url' as const, targetType: null, targetId: null, targetLocale: null, targetUrl: target.url })

const sameTarget = (a: RedirectTarget, b: RedirectTarget) =>
  (a.kind === 'page' && b.kind === 'page' ? a.type === b.type && a.id === b.id && a.locale === b.locale : a.kind === 'url' && b.kind === 'url' && a.url === b.url)

// ───────────── Application (site public) ─────────────

/**
 * Redirection manuelle qui vaut pour ce chemin, ou null. À n'appeler que lorsqu'aucune page ne répond.
 * `search` : les paramètres de la demande (« ?a=1 »), recopiés sur une destination interne qui n'en a pas.
 */
export async function findRedirect(event: H3Event, pathname: string, search = ''): Promise<{ location: string; status: RedirectStatus; external: boolean } | null> {
  const key = canonicalPath(pathname)
  if (!key || key === '/' || isReservedPath(key)) return null
  const db = useDb(event)
  const [rule] = await db.select().from(schema.redirectRules).where(eq(schema.redirectRules.source, key))
  if (!rule) return null
  let to: string | null
  if (rule.targetKind === 'url') to = rule.targetUrl
  else {
    const def = findDef(rule.targetType ?? '')
    if (!def?.path || !rule.targetId) return null
    const { entryLocales } = schema
    const [row] = await db.select({ slug: entryLocales.slug, published: isNotNull(entryLocales.published) }).from(entryLocales)
      .where(and(eq(entryLocales.entryId, rule.targetId), eq(entryLocales.locale, rule.targetLocale ?? cmsConfig.site.defaultLocale)))
    // La page visée n'est pas (ou plus) en ligne : la redirection attend son retour, le visiteur reçoit la page 404.
    if (!row?.published) return null
    to = publicPath(def, rule.targetLocale ?? cmsConfig.site.defaultLocale, row.slug)
  }
  // Jamais vers soi-même (une page visée peut avoir pris l'ancienne adresse entre-temps).
  if (!to || pathKey(to) === key) return null
  const external = /^https?:\/\//i.test(to)
  return { location: redirectLocation(to, search), status: isRedirectStatus(rule.status) ? rule.status : 301, external }
}

// ───────────── Pages introuvables ─────────────

/** Délai minimal entre deux écritures d'une même instance du serveur. */
const FLUSH_MS = 5000
/** Nombre maximal d'adresses distinctes gardées en mémoire entre deux écritures. */
const BUFFER_MAX = 100

type Pending = { hits: number; lastAt: number; referrer: string | null }
// État d'une instance du serveur (isolat) : il disparaît avec elle, ce qui ne perd au pire que quelques secondes de comptage.
const pending = new Map<string, Pending>()
let lastFlush = 0

/** Note qu'une adresse a répondu 404. Ne lit ni n'écrit rien pendant la réponse. */
export function noteNotFound(event: H3Event, pathname: string) {
  const key = canonicalPath(pathname)
  if (!key || isReservedPath(key) || isNoise(key, getRequestHeader(event, 'user-agent') ?? null)) return
  if ('preview' in getQuery(event)) return
  const known = pending.get(key)
  if (!known && pending.size >= BUFFER_MAX) return
  const referrer = cleanReferrer(getRequestHeader(event, 'referer'), getRequestHost(event))
  pending.set(key, { hits: (known?.hits ?? 0) + 1, lastAt: Date.now(), referrer: referrer ?? known?.referrer ?? null })
  if (Date.now() - lastFlush >= FLUSH_MS) event.waitUntil(flushNotFound(event))
}

/** Écrit en une fois ce qui a été compté en mémoire, puis fait le ménage (ancienneté, plafond). */
export async function flushNotFound(event: H3Event) {
  if (!pending.size) return
  const batch = [...pending]
  pending.clear()
  lastFlush = Date.now()
  try {
    const db = useDb(event)
    const { notFound } = schema
    await db.batch([
      ...batch.map(([path, p]) => db.insert(notFound).values({ path, hits: p.hits, firstAt: new Date(p.lastAt), lastAt: new Date(p.lastAt), referrer: p.referrer })
        .onConflictDoUpdate({ target: notFound.path, set: { hits: sql`${notFound.hits} + ${p.hits}`, lastAt: new Date(p.lastAt), ...(p.referrer ? { referrer: p.referrer } : {}) } })),
      db.delete(notFound).where(lt(notFound.lastAt, new Date(Date.now() - NOT_FOUND_DAYS * 86_400_000))),
      // Plafond : on garde les adresses les plus demandées, puis les plus récentes.
      db.delete(notFound).where(sql`${notFound.path} not in (select path from cms_not_found order by hits desc, last_at desc limit ${NOT_FOUND_MAX})`),
    ] as unknown as [any, ...any[]])
  }
  catch (error) {
    console.error('[cms] le comptage des pages introuvables a échoué', error)
  }
}

/** Oublie une adresse introuvable (ou toutes), y compris ce que cette instance a encore en mémoire. */
export async function forgetNotFound(event: H3Event, path?: string) {
  const { notFound } = schema
  if (path) pending.delete(path)
  else pending.clear()
  await (path ? useDb(event).delete(notFound).where(eq(notFound.path, path)) : useDb(event).delete(notFound))
}

/** Les adresses introuvables, de la plus demandée à la moins demandée. */
export async function listNotFound(event: H3Event) {
  // Ce que cette instance a encore en mémoire est écrit d'abord : la liste est à jour pour qui la regarde.
  await flushNotFound(event)
  const db = useDb(event)
  const { notFound } = schema
  await db.delete(notFound).where(lt(notFound.lastAt, new Date(Date.now() - NOT_FOUND_DAYS * 86_400_000)))
  const items = await db.select().from(notFound).orderBy(sql`${notFound.hits} desc, ${notFound.lastAt} desc`).limit(NOT_FOUND_MAX)
  return { items, max: NOT_FOUND_MAX, days: NOT_FOUND_DAYS }
}

// ───────────── État du site pour les vérifications ─────────────

type Live = { entryId: string; locale: string; type: string; slug: string | null }
export type RedirectContext = RedirectGraph & {
  /** Adresse en ligne de chaque page, par « identifiant:langue ». */
  liveKeys: Map<string, string>
  /** Type de chaque contenu existant, par identifiant. */
  entryTypes: Map<string, string>
  rows: RuleRow[]
}

const pageId = (id: string, locale: string) => `${id}:${locale}`
const keyOfTarget = (context: Pick<RedirectContext, 'liveKeys'>, target: RedirectTarget) =>
  (target.kind === 'page' ? context.liveKeys.get(pageId(target.id, target.locale)) ?? null : pathKey(target.url))

/** Lit ce qu'il faut pour vérifier une redirection : les redirections existantes et les adresses des pages en ligne. */
export async function loadRedirectContext(event: H3Event): Promise<RedirectContext> {
  const db = useDb(event)
  const { entries, entryLocales, redirects, redirectRules } = schema
  const [rows, autos, live, docs] = await Promise.all([
    db.select().from(redirectRules),
    db.select().from(redirects),
    db.select({ entryId: entryLocales.entryId, locale: entryLocales.locale, type: entryLocales.type, slug: entryLocales.slug }).from(entryLocales).where(isNotNull(entryLocales.published)),
    db.select({ id: entries.id, type: entries.type }).from(entries),
  ])
  const context: RedirectContext = { rules: new Map(), autos: new Map(), pages: new Map(), liveKeys: new Map(), entryTypes: new Map(docs.map(d => [d.id, d.type])), rows }
  for (const row of live as Live[]) {
    const def = findDef(row.type)
    const key = def?.path && cmsConfig.site.locales.includes(row.locale) ? pathKey(publicPath(def, row.locale, row.slug)) : null
    if (!key) continue
    context.pages.set(key, { type: row.type, id: row.entryId, locale: row.locale, title: def!.label })
    context.liveKeys.set(pageId(row.entryId, row.locale), key)
  }
  for (const auto of autos) {
    const def = findDef(auto.type)
    const key = def?.path ? pathKey(publicPath(def, auto.locale, auto.slug)) : null
    const target: RedirectTarget = { kind: 'page', type: auto.type, id: auto.entryId, locale: auto.locale }
    if (key) context.autos.set(key, { key: keyOfTarget(context, target), target })
  }
  for (const row of rows) context.rules.set(row.source, { id: row.id, key: keyOfTarget(context, targetOf(row)), target: targetOf(row) })
  return context
}

/** Remplace, pour les pages en ligne qui occupent ces adresses, le nom du type par le titre du contenu (messages d'erreur). */
async function nameLivePages(event: H3Event, context: RedirectContext, sources: unknown[]) {
  const pages = sources.flatMap((raw) => {
    const source = normalizeSource(raw)
    const page = source.ok ? context.pages.get(source.path) : undefined
    return page ? [page] : []
  })
  if (!pages.length) return
  const titles = await entryTitles(event, [...new Set(pages.map(p => p.id))])
  for (const page of pages) page.title = titles.get(page.id) ?? page.title
}

/** Adresse lisible d'une destination : l'adresse actuelle de la page, ou l'adresse libre. */
function showTarget(context: RedirectContext, target: RedirectTarget) {
  if (target.kind === 'url') return target.url
  const def = findDef(target.type)
  return context.liveKeys.get(pageId(target.id, target.locale)) ?? `${def?.label ?? 'page'} (hors ligne)`
}

// ───────────── Enregistrement ─────────────

export type RuleBody = { source?: unknown; target?: unknown; status?: unknown; /** Pointer droit sur la destination finale quand la destination est elle-même redirigée. */ flatten?: unknown }

type Prepared =
  | { ok: false; error: string; code: string; chain?: { via: string[]; final: string; upstream: string[] } }
  | { ok: true; source: string; target: RedirectTarget; notes: string[]; upstream: { id: string; source: string }[] }

/** Lit et vérifie une destination envoyée par le formulaire, l'import ou l'outil en ligne de commande. */
function readTarget(context: RedirectContext, raw: unknown, notes: string[]): { target: RedirectTarget } | { error: string } {
  const input = (typeof raw === 'string' ? { kind: 'url', url: raw } : raw ?? {}) as { kind?: unknown; type?: unknown; id?: unknown; locale?: unknown; url?: unknown }
  if (input.kind === 'page') {
    const type = String(input.type ?? '')
    const def = findDef(type)
    if (!def?.path) return { error: 'Choisissez une page du site comme destination.' }
    const id = def.kind === 'singleton' ? type : String(input.id ?? '')
    const locale = input.locale ? String(input.locale) : cmsConfig.site.defaultLocale
    if (!cmsConfig.site.locales.includes(locale)) return { error: `Langue inconnue : « ${locale} ».` }
    if (!id || context.entryTypes.get(id) !== type) return { error: def.kind === 'singleton' ? `La page « ${def.label} » n'existe pas encore.` : 'Choisissez la page de destination.' }
    if (!context.liveKeys.has(pageId(id, locale))) notes.push('La page de destination n\'est pas en ligne : la redirection s\'appliquera dès qu\'elle sera publiée.')
    return { target: { kind: 'page', type, id, locale } }
  }
  const url = normalizeUrlTarget(input.url, cmsConfig.site.url)
  if (!url.ok) return { error: url.error }
  // Une adresse libre qui est celle d'une page en ligne devient un lien vers cette page : elle la suivra si elle change d'adresse.
  const page = !url.external && !/[?#]/.test(url.url) ? context.pages.get(pathKey(url.url) ?? '') : undefined
  if (page) return { target: { kind: 'page', type: page.type, id: page.id, locale: page.locale } }
  return { target: { kind: 'url', url: url.url } }
}

/**
 * Vérifie une redirection par rapport à l'état du site. `id` : la redirection modifiée (elle est d'abord retirée de
 * l'état). Avec `flatten`, une chaîne est aplatie ; sinon elle est renvoyée pour que la personne décide.
 */
function prepareRule(context: RedirectContext, body: RuleBody, flatten: boolean, id?: string): Prepared {
  if (id) for (const [key, hop] of context.rules) if (hop.id === id) context.rules.delete(key)
  const notes: string[] = []
  const read = readTarget(context, body.target, notes)
  if ('error' in read) return { ok: false, code: 'invalid', error: read.error }
  let target = read.target
  const check = checkRule(context, { source: body.source, target, targetKey: keyOfTarget(context, target) })
  if (!check.ok) return check
  notes.unshift(...check.notes)
  if (check.chain || check.upstream.length) {
    const final = check.chain ? showTarget(context, check.chain.final) : showTarget(context, target)
    if (!flatten) {
      const parts: string[] = []
      if (check.chain) parts.push(`la destination est elle-même redirigée (${[check.source, ...check.chain.via, final].map(a => `« ${a} »`).join(' → ')})`)
      if (check.upstream.length) parts.push(`${check.upstream.map(u => `« ${u.source} »`).join(', ')} ${check.upstream.length > 1 ? 'mènent' : 'mène'} déjà à « ${check.source} »`)
      return {
        ok: false, code: 'chain', error: `Chaîne de redirections : ${parts.join(' ; ')}. Les visiteurs feraient plusieurs sauts.`,
        chain: { via: check.chain?.via ?? [], final, upstream: check.upstream.map(u => u.source) },
      }
    }
    if (check.chain) {
      target = check.chain.final
      notes.push(`Chaîne aplatie : la redirection mène directement à « ${final} ».`)
    }
    if (check.upstream.length) notes.push(`Chaîne aplatie : ${check.upstream.map(u => `« ${u.source} »`).join(', ')} ${check.upstream.length > 1 ? 'mènent' : 'mène'} maintenant directement à « ${final} ».`)
  }
  return { ok: true, source: check.source, target, notes, upstream: check.upstream }
}

/** Inscrit dans l'état en mémoire une redirection acceptée, pour que la suivante (import) soit vérifiée par rapport à elle. */
function remember(context: RedirectContext, id: string, prepared: Extract<Prepared, { ok: true }>) {
  const hop: Hop = { id, key: keyOfTarget(context, prepared.target), target: prepared.target }
  context.rules.set(prepared.source, hop)
  for (const up of prepared.upstream) context.rules.set(up.source, { ...hop, id: up.id })
}

/** Écritures d'une redirection acceptée : elle-même, les redirections en amont réorientées, l'adresse introuvable effacée. */
function statementsFor(event: H3Event, id: string, prepared: Extract<Prepared, { ok: true }>, status: RedirectStatus, existing: boolean) {
  const db = useDb(event)
  const { redirectRules, notFound } = schema
  const now = new Date()
  const columns = targetColumns(prepared.target)
  return [
    existing
      ? db.update(redirectRules).set({ source: prepared.source, ...columns, status, updatedAt: now }).where(eq(redirectRules.id, id))
      : db.insert(redirectRules).values({ id, source: prepared.source, ...columns, status, createdAt: now, updatedAt: now }),
    ...prepared.upstream.map(up => db.update(redirectRules).set({ ...columns, updatedAt: now }).where(eq(redirectRules.id, up.id))),
    db.delete(notFound).where(eq(notFound.path, prepared.source)),
  ]
}

const readStatus = (value: unknown): RedirectStatus | null => (value === undefined || value === null || value === '' ? 301 : isRedirectStatus(Number(value)) ? Number(value) as RedirectStatus : null)

/** Crée (`id` absent) ou modifie une redirection manuelle. */
export async function saveRedirect(event: H3Event, id?: string) {
  const user = await requireRedirectsAccess(event)
  const body = (await readBody<RuleBody>(event)) ?? {}
  const status = readStatus(body.status)
  if (!status) throw createError({ statusCode: 422, message: 'Type de redirection inconnu : choisissez définitive (301) ou provisoire (302).' })
  const context = await loadRedirectContext(event)
  const current = id ? context.rows.find(r => r.id === id) : undefined
  if (id && !current) throw createError({ statusCode: 404, message: 'Redirection introuvable.' })
  await nameLivePages(event, context, [body.source])
  const prepared = prepareRule(context, body, body.flatten === true, id)
  if (!prepared.ok) throw createError({ statusCode: prepared.code === 'chain' ? 409 : 422, message: prepared.error, data: { code: prepared.code, chain: prepared.chain } })

  const ruleId = id ?? crypto.randomUUID()
  await useDb(event).batch(statementsFor(event, ruleId, prepared, status, !!current) as [any, ...any[]])
  remember(context, ruleId, prepared)
  const to = showTarget(context, prepared.target)
  logActivity(event, {
    action: current ? 'redirect.updated' : 'redirect.created', category: 'settings', actor: user,
    phrase: `a ${current ? 'modifié' : 'créé'} la redirection « ${prepared.source} » → « ${to} »`, target: { kind: 'redirects', id: ruleId },
  })
  return { id: ruleId, source: prepared.source, to, status, notes: prepared.notes, purgeFailed: !(await purgeSiteCache(event)) }
}

export async function deleteRedirect(event: H3Event, id: string) {
  const user = await requireRedirectsAccess(event)
  const db = useDb(event)
  const [row] = await db.select().from(schema.redirectRules).where(eq(schema.redirectRules.id, id))
  if (!row) throw createError({ statusCode: 404, message: 'Redirection introuvable.' })
  await db.delete(schema.redirectRules).where(eq(schema.redirectRules.id, id))
  logActivity(event, { action: 'redirect.deleted', category: 'settings', actor: user, phrase: `a supprimé la redirection de « ${row.source} »`, target: { kind: 'redirects' } })
  return { ok: true, purgeFailed: !(await purgeSiteCache(event)) }
}

/** Supprime une redirection automatique (ancienne adresse d'un contenu) : l'ancienne adresse redevient introuvable. */
export async function deleteAutoRedirect(event: H3Event) {
  const user = await requireRedirectsAccess(event)
  const query = getQuery(event)
  const [type, locale, slug] = [String(query.type ?? ''), String(query.locale ?? ''), String(query.slug ?? '')]
  const { redirects } = schema
  const where = and(eq(redirects.type, type), eq(redirects.locale, locale), eq(redirects.slug, slug))
  const db = useDb(event)
  const [row] = await db.select().from(redirects).where(where)
  if (!row) throw createError({ statusCode: 404, message: 'Redirection introuvable.' })
  await db.delete(redirects).where(where)
  const def = findDef(type)
  logActivity(event, { action: 'redirect.deleted', category: 'settings', actor: user, phrase: `a supprimé la redirection automatique de « ${(def && publicPath(def, locale, slug)) ?? slug} »`, target: { kind: 'redirects' } })
  return { ok: true, purgeFailed: !(await purgeSiteCache(event)) }
}

// ───────────── Import en lot ─────────────

export type ImportLine = { line: number; source: string; target: string; result: 'created' | 'updated' | 'unchanged' | 'error'; message: string }
type ImportBody = {
  /** Liste collée ou contenu d'un fichier CSV : « ancienne ; nouvelle » par ligne. */
  text?: unknown
  /** Ou une liste déjà découpée (outil d'import) : la destination peut être une page du site. */
  rules?: unknown
  /** Type des lignes qui n'en précisent pas. */
  status?: unknown
  /** Remplacer une redirection existante qui part de la même adresse (sinon la ligne est refusée). */
  replace?: unknown
  /** Tout vérifier sans rien enregistrer. */
  dryRun?: unknown
}

/** Import en lot : chaque ligne est vérifiée comme un ajout à la main (et par rapport aux lignes qui la précèdent). Les chaînes sont aplaties. */
export async function importRedirects(event: H3Event) {
  const user = await requireRedirectsAccess(event)
  const body = (await readBody<ImportBody>(event)) ?? {}
  const fallback = readStatus(body.status)
  if (!fallback) throw createError({ statusCode: 422, message: 'Type de redirection inconnu : choisissez définitive (301) ou provisoire (302).' })
  const dryRun = body.dryRun === true

  type Wanted = { line: number; source: unknown; target: unknown; status?: unknown; error?: string; text?: string }
  let wanted: Wanted[]
  if (Array.isArray(body.rules)) {
    wanted = body.rules.map((raw, i) => {
      const rule = (raw ?? {}) as { from?: unknown; source?: unknown; to?: unknown; target?: unknown; status?: unknown }
      return { line: i + 1, source: rule.from ?? rule.source, target: rule.to ?? rule.target, status: rule.status }
    })
  }
  else if (typeof body.text === 'string') wanted = parseRedirectBatch(body.text).map(l => ('error' in l ? { line: l.line, source: '', target: '', error: l.error, text: l.text } : l))
  else throw createError({ statusCode: 422, message: 'Collez une liste de redirections, une par ligne : « ancienne adresse ; nouvelle adresse ».' })
  if (!wanted.length) throw createError({ statusCode: 422, message: 'Aucune redirection à importer : la liste est vide.' })
  if (wanted.length > REDIRECT_BATCH_MAX) throw createError({ statusCode: 422, message: `Trop de lignes (${wanted.length}) : ${REDIRECT_BATCH_MAX} au maximum par import. Découpez la liste.` })

  const context = await loadRedirectContext(event)
  await nameLivePages(event, context, wanted.map(w => w.source))
  const byId = new Map(context.rows.map(r => [r.id, r]))
  const report: ImportLine[] = []
  const statements: unknown[] = []
  for (const item of wanted) {
    const shown = { line: item.line, source: (typeof item.source === 'string' && item.source) || item.text || '', target: typeof item.target === 'string' ? item.target : '' }
    if (item.error) { report.push({ ...shown, result: 'error', message: item.error }); continue }
    const status = item.status === undefined ? fallback : readStatus(item.status)
    if (!status) { report.push({ ...shown, result: 'error', message: 'Type de redirection inconnu : attendu 301 ou 302.' }); continue }

    // Une redirection manuelle part-elle déjà de cette adresse ?
    const source = normalizeSource(item.source)
    const known = source.ok ? context.rules.get(source.path) : undefined
    const existing = known?.id ? byId.get(known.id) : undefined
    // La redirection existante est retirée de l'état le temps de la vérification, puis comparée au résultat.
    const prepared = prepareRule(context, { source: item.source, target: item.target }, true, existing?.id)
    const restore = () => { if (existing && known) context.rules.set(existing.source, known) }
    if (!prepared.ok) {
      restore()
      report.push({ ...shown, result: 'error', message: prepared.error })
      continue
    }
    const to = showTarget(context, prepared.target)
    if (existing && known) {
      if (sameTarget(prepared.target, known.target) && existing.status === status && !prepared.upstream.length) {
        restore()
        report.push({ ...shown, source: prepared.source, target: to, result: 'unchanged', message: 'Déjà enregistrée.' })
        continue
      }
      if (body.replace !== true) {
        restore()
        report.push({ ...shown, source: existing.source, result: 'error', message: `« ${existing.source} » est déjà redirigée vers « ${showTarget(context, known.target)} ». Cochez « Remplacer les redirections existantes » pour la modifier.` })
        continue
      }
    }
    const id = existing?.id ?? crypto.randomUUID()
    statements.push(...statementsFor(event, id, prepared, status, byId.has(id)))
    remember(context, id, prepared)
    // Une ligne suivante qui reprend la même adresse la retrouve comme existante.
    byId.set(id, { ...(existing ?? { id, createdAt: new Date() }), source: prepared.source, ...targetColumns(prepared.target), status, updatedAt: new Date() } as RuleRow)
    report.push({ ...shown, source: prepared.source, target: to, result: existing ? 'updated' : 'created', message: [`${status === 301 ? 'Définitive' : 'Provisoire'} vers « ${to} ».`, ...prepared.notes].join(' ') })
  }

  const count = (result: ImportLine['result']) => report.filter(r => r.result === result).length
  const summary = { created: count('created'), updated: count('updated'), unchanged: count('unchanged'), errors: count('error') }
  if (dryRun || !statements.length) return { dryRun, lines: report, ...summary }
  const db = useDb(event)
  for (let i = 0; i < statements.length; i += 40) await db.batch(statements.slice(i, i + 40) as [any, ...any[]])
  const changed = summary.created + summary.updated
  logActivity(event, { action: 'redirect.imported', category: 'settings', actor: user, phrase: `a importé ${changed} redirection${changed > 1 ? 's' : ''}`, target: { kind: 'redirects' } })
  return { dryRun, lines: report, ...summary, purgeFailed: !(await purgeSiteCache(event)) }
}

// ───────────── Liste (écran « Redirections ») ─────────────

/** Toutes les redirections, manuelles et automatiques, avec ce qui les empêche éventuellement de fonctionner. */
export async function listRedirects(event: H3Event) {
  const db = useDb(event)
  const { entries, entryLocales, redirects, trash } = schema
  const [context, autos, trashed] = await Promise.all([
    loadRedirectContext(event),
    db.select().from(redirects),
    db.select({ itemId: trash.itemId }).from(trash).where(eq(trash.kind, 'entry')),
  ])
  const inTrash = new Set(trashed.map(t => t.itemId))

  // Titres des contenus visés, lus par paquets.
  const ids = [...new Set([...context.rows.flatMap(r => (r.targetId ? [r.targetId] : [])), ...autos.map(a => a.entryId)])].filter(id => context.entryTypes.has(id))
  const titles = new Map<string, string>()
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80)
    const [docs, rows] = await Promise.all([
      db.select({ id: entries.id, type: entries.type, shared: entries.sharedDraft }).from(entries).where(inArray(entries.id, chunk)),
      db.select({ entryId: entryLocales.entryId, locale: entryLocales.locale, draft: entryLocales.draft }).from(entryLocales).where(inArray(entryLocales.entryId, chunk)),
    ])
    for (const doc of docs) {
      const def = findDef(doc.type)
      if (!def) continue
      const mine = rows.filter(r => r.entryId === doc.id)
      const main = mine.find(r => r.locale === cmsConfig.site.defaultLocale) ?? mine[0]
      const values = { ...doc.shared, ...main?.draft } as Record<string, unknown>
      titles.set(doc.id, def.kind === 'collection' ? String(values[def.titleField] ?? '') || 'Sans titre' : def.label)
    }
  }

  const describe = (target: RedirectTarget, source: string) => {
    let to: string | null
    let title: string | null = null
    let issue: string | null = null
    if (target.kind === 'url') to = target.url
    else {
      to = context.liveKeys.get(pageId(target.id, target.locale)) ?? null
      title = titles.get(target.id) ?? null
      if (!to) {
        issue = inTrash.has(target.id) ? 'La page visée est dans la corbeille : la redirection reprendra si elle est restaurée.'
          : context.entryTypes.has(target.id) ? 'La page visée n\'est pas en ligne : la redirection reprendra dès sa publication.'
          : 'La page visée n\'existe plus : choisissez une autre destination ou supprimez cette redirection.'
      }
    }
    const key = keyOfTarget(context, target)
    const page = context.pages.get(source)
    if (!issue && page) issue = 'Une page en ligne occupe maintenant cette adresse : elle répond en premier et la redirection ne s\'applique pas.'
    if (!issue && key && (context.rules.has(key) || context.autos.has(key))) issue = `La destination « ${key} » est elle-même redirigée : les visiteurs font deux sauts. Modifiez la destination.`
    return { to, title, issue }
  }

  const manual = context.rows.map((row) => {
    const target = targetOf(row)
    return { id: row.id, kind: 'manual' as const, source: row.source, status: row.status, target, ...describe(target, row.source), createdAt: row.createdAt }
  })
  const automatic = autos.flatMap((auto) => {
    const def = findDef(auto.type)
    const source = def?.path ? pathKey(publicPath(def, auto.locale, auto.slug)) : null
    if (!source) return []
    const target: RedirectTarget = { kind: 'page', type: auto.type, id: auto.entryId, locale: auto.locale }
    return [{ id: `auto:${auto.type}:${auto.locale}:${auto.slug}`, kind: 'auto' as const, source, status: 301, target, ...describe(target, source), createdAt: auto.createdAt, auto: { type: auto.type, locale: auto.locale, slug: auto.slug } }]
  })
  const items = [...manual, ...automatic].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  return { items, locales: cmsConfig.site.locales, defaultLocale: cmsConfig.site.defaultLocale }
}
