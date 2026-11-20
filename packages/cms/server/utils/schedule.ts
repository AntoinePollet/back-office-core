/**
 * Publication programmée (règles et choix : shared/schedule.ts ; table cms_schedules).
 *
 * ── Exécution ──
 * Un Worker ne tourne pas en continu. Deux chemins mènent à `runDueSchedules` :
 * - le **déclencheur planifié** de Cloudflare (`"crons": [..., "*\/5 * * * *"]` dans wrangler.jsonc), par la route
 *   interne /_cms/scheduled : c'est le chemin normal, à 5 minutes près ;
 * - le **repli** (`catchUpSchedules`, appelé par server/middleware/02.schedule.ts) : la première requête qui atteint
 *   le serveur après l'heure prévue exécute ce qui est dû avant de répondre. Il couvre un déclencheur absent ou en
 *   retard. Son coût : une petite requête en base par minute et par instance au plus, rien sinon (l'échéance la plus
 *   proche est gardée en mémoire).
 *
 * L'exécution passe par le même enregistrement qu'une publication à la main (`writeScheduled` → `writeDoc`) : validation
 * des champs, droits de la personne qui a programmé (relus à ce moment-là), historique, redirections, événements des
 * workflows, purge du cache. Un échec laisse la ligne en place avec sa raison, l'inscrit au journal d'activité et émet
 * l'événement `schedule.failed` ; rien n'est retenté tout seul.
 *
 * ── Cache du site ──
 * L'exécution purge le cache. Pour que le repli ne soit pas masqué par une page gardée une heure sur le réseau, une
 * réponse publique n'est jamais mise en cache au-delà de la prochaine échéance (`scheduleCacheSeconds`, lu par
 * `allowSiteCache`), et programmer à moins d'une heure purge le cache (les pages déjà gardées l'étaient pour une heure).
 */
import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { isBuiltinRole } from '../../shared/access'
import { joinFr, languageName } from '../../shared/activity'
import { adminEntryPath } from '../../shared/admin-paths'
import { partition, validateValues } from '../../shared/content'
import type { AnyField, CmsDefinition } from '../../shared/format'
import {
  DEFAULT_TIME_ZONE, SCHEDULE_ACTIONS, SCHEDULE_NOUNS, type ScheduleAction, type ScheduleInfo,
  describeFieldErrors, formatScheduleDate, isValidTimeZone, parseScheduleTime, scheduleProblem, timeZoneLabel,
} from '../../shared/schedule'
import type { ModuleWorkflowEvent } from './modules'

type Row = typeof schema.schedules.$inferSelect
type User = Awaited<ReturnType<typeof requireUser>>
type Author = Parameters<typeof writeScheduled>[4]

/** Fuseau du site : celui des heures saisies et affichées. */
export function siteTimeZone() {
  const zone = (cmsConfig.site as { timeZone?: string }).timeZone
  return isValidTimeZone(zone) ? zone : DEFAULT_TIME_ZONE
}

const hasSlug = (def: CmsDefinition) => def.kind === 'collection' && !!def.path?.includes('[slug]')
const multi = () => cmsConfig.site.locales.length > 1
/** « « Droit social » (Services, français) », ou « la page « Accueil » ». */
function contentName(def: CmsDefinition | undefined, type: string, title: string, locales: string[]) {
  const langs = multi() && locales.length ? joinFr(locales.map(languageName)) : ''
  if (def?.kind === 'singleton') return `la page « ${def.label} »${langs ? ` (${langs})` : ''}`
  return `« ${title || 'Sans titre'} » (${[def?.label ?? type, langs].filter(Boolean).join(', ')})`
}
const whenText = (at: Date) => `${formatScheduleDate(at, siteTimeZone())} (${timeZoneLabel(siteTimeZone())})`
const toInfo = (r: Row): ScheduleInfo => ({
  locale: r.locale, action: r.action, at: r.at.toISOString(), by: r.createdByName, byId: r.createdBy,
  failedAt: r.failedAt?.toISOString() ?? null, error: r.error,
})

// ───────────── Lecture ─────────────

/** Les programmations d'un contenu (en attente ou en échec), pour le formulaire. */
export async function entrySchedules(event: H3Event, entryId: string): Promise<ScheduleInfo[]> {
  const rows = await useDb(event).select().from(schema.schedules).where(eq(schema.schedules.entryId, entryId)).orderBy(asc(schema.schedules.at))
  return rows.map(toInfo)
}

/** Les programmations d'une collection, par contenu, pour le statut « Programmé » de la liste. */
export async function schedulesByEntry(event: H3Event, type: string) {
  const rows = await useDb(event).select().from(schema.schedules).where(eq(schema.schedules.type, type)).orderBy(asc(schema.schedules.at))
  const out = new Map<string, { action: ScheduleAction; at: Date; failed: boolean; locale: string }[]>()
  for (const r of rows) out.set(r.entryId, [...(out.get(r.entryId) ?? []), { action: r.action, at: r.at, failed: !!r.failedAt, locale: r.locale }])
  return out
}

/** Tout ce qui est programmé sur le site, pour ce que la personne peut ouvrir (écran « Programmé »). */
export async function allSchedules(event: H3Event, user: User) {
  const db = useDb(event)
  const rows = (await db.select().from(schema.schedules).orderBy(asc(schema.schedules.at))).filter(r => findDef(r.type) && can(user, r.type, 'edit'))
  const ids = [...new Set(rows.map(r => r.entryId))]
  const owners = new Map<string, { createdBy: string | null }>()
  const titles = new Map<string, string>()
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80)
    for (const e of await db.select({ id: schema.entries.id, createdBy: schema.entries.createdBy }).from(schema.entries).where(inArray(schema.entries.id, chunk))) owners.set(e.id, e)
    for (const [id, title] of await entryTitles(event, chunk)) titles.set(id, title)
  }
  return rows.flatMap((r) => {
    const owner = owners.get(r.entryId)
    if (!owner || !ownsOrFree(user, r.type, owner)) return []
    const def = getDef(r.type)
    return [{ ...toInfo(r), id: r.entryId, type: r.type, typeLabel: def.label, title: titles.get(r.entryId) ?? def.label, canManage: can(user, r.type, 'publish') }]
  })
}

// ───────────── Déclencheur vu ou non ─────────────

const TICK_KEY = 'schedule.tick'
let tickNotedAt = 0

/** Note (une fois par heure au plus) que le déclencheur fréquent passe bien : l'interface peut alors promettre l'heure. */
export async function noteScheduleTick(event: H3Event, now: Date) {
  if (Math.abs(Date.now() - tickNotedAt) < 3600_000) return
  tickNotedAt = Date.now()
  const value = { at: now.toISOString() }
  await useDb(event).insert(schema.settings).values({ key: TICK_KEY, value, updatedAt: now })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: now } })
}

/** `ok` : le déclencheur fréquent est passé depuis moins d'un jour ; `missing` : les échéances reposent sur le repli. */
export async function scheduleTrigger(event: H3Event): Promise<'ok' | 'missing'> {
  const [row] = await useDb(event).select().from(schema.settings).where(eq(schema.settings.key, TICK_KEY))
  const at = Date.parse((row?.value as { at?: string } | undefined)?.at ?? '')
  return Number.isFinite(at) && Date.now() - at < 86_400_000 ? 'ok' : 'missing'
}

// ───────────── Programmer, annuler ─────────────

async function loadTarget(event: H3Event, user: User, type: string, id: string) {
  const def = getDef(type)
  assertAccess(user, type, 'edit')
  if (!def.drafts) throw createError({ statusCode: 400, message: 'Ce contenu n\'a pas de brouillon : ce qui est enregistré est en ligne tout de suite, il n\'y a rien à programmer.' })
  // Programmer, c'est décider d'une mise en ligne : le droit de publier est demandé, comme pour le bouton « Publier ».
  assertAccess(user, type, 'publish')
  const [entry] = await useDb(event).select().from(schema.entries).where(and(eq(schema.entries.id, id), eq(schema.entries.type, type)))
  if (!entry) throw createError({ statusCode: 404, message: 'Contenu introuvable.' })
  assertEntryAccess(user, type, entry, 'publish')
  return { def, entry }
}

/**
 * Programme une mise en ligne ou un retrait. Corps : `{ action: 'publish' | 'unpublish', date: '2026-12-03', time: '09:00' }`
 * (heure du site) ou `{ action, at: '2026-12-03T09:00:00+01:00' }` ; `locales` : les langues (défaut : toutes celles où
 * l'action a un sens). Une programmation de la même action sur la même langue est remplacée.
 */
export async function scheduleEntry(event: H3Event, user: User, type: string, id: string, body: { action?: unknown; locales?: unknown; date?: unknown; time?: unknown; at?: unknown }) {
  const { def, entry } = await loadTarget(event, user, type, id)
  const action = body.action as ScheduleAction
  if (!SCHEDULE_ACTIONS.includes(action)) throw createError({ statusCode: 400, message: 'action : « publish » (mettre en ligne) ou « unpublish » (retirer du site) est attendu.' })
  const time = parseScheduleTime(body, siteTimeZone())
  if ('error' in time) throw createError({ statusCode: 400, message: time.error })
  const at = time.at

  const db = useDb(event)
  const { schedules, entryLocales } = schema
  const [rows, planned] = await Promise.all([
    db.select().from(entryLocales).where(eq(entryLocales.entryId, id)),
    db.select().from(schedules).where(eq(schedules.entryId, id)),
  ])
  const problemFor = (locale: string) => scheduleProblem({
    action, at, status: rows.find(r => r.locale === locale)?.status ?? null,
    others: planned.filter(p => p.locale === locale && !p.failedAt),
  })
  let locales: string[]
  if (body.locales !== undefined) {
    if (!Array.isArray(body.locales) || !body.locales.length || body.locales.some(l => !cmsConfig.site.locales.includes(l as string)))
      throw createError({ statusCode: 400, message: `locales : une liste de langues du site est attendue (${cmsConfig.site.locales.join(', ')}).` })
    locales = [...new Set(body.locales as string[])]
    for (const locale of locales) {
      const problem = problemFor(locale)
      if (problem) throw createError({ statusCode: 400, message: multi() ? `${languageName(locale).replace(/^./, c => c.toUpperCase())} : ${problem}` : problem })
    }
  }
  else {
    locales = cmsConfig.site.locales.filter(l => !problemFor(l))
    if (!locales.length) throw createError({ statusCode: 400, message: problemFor(cmsConfig.site.defaultLocale) ?? 'Il n\'y a rien à programmer.' })
  }

  if (action === 'publish') {
    // Mêmes vérifications qu'une publication : on ne programme pas un contenu qui serait refusé le jour venu.
    const errors: Record<string, Record<string, string>> = {}
    for (const locale of locales) {
      const row = rows.find(r => r.locale === locale)!
      const found = validateValues(def.fields as Record<string, AnyField>, { ...entry.sharedDraft, ...row.draft })
      if (hasSlug(def) && !row.slug) found.slug = 'Une adresse est nécessaire pour publier.'
      if (Object.keys(found).length) errors[locale] = found
    }
    if (Object.keys(errors).length) throw createError({ statusCode: 422, message: 'Certains champs sont à corriger avant de programmer la mise en ligne.', data: { errors } })
  }

  const now = new Date()
  const moved = planned.some(p => p.action === action && locales.includes(p.locale) && !p.failedAt)
  await db.batch(locales.map((locale) => {
    const set = { type, at, createdBy: user.id, createdByName: user.name, createdAt: now, claimedAt: null, failedAt: null, error: null }
    return db.insert(schedules).values({ entryId: id, locale, action, ...set }).onConflictDoUpdate({ target: [schedules.entryId, schedules.locale, schedules.action], set })
  }) as [any, ...any[]])
  noteNextDue(at.getTime())
  // Les pages déjà en cache le sont pour une heure au plus : en deçà, on repart d'un cache vide, limité à l'échéance.
  if (at.getTime() - now.getTime() < 3600_000) await purgeSiteCache(event)

  const title = (await entryTitles(event, [id])).get(id) ?? def.label
  logActivity(event, {
    action: 'schedule.created', category: 'content', actor: user, target: { kind: 'entry', type, id },
    phrase: `a ${moved ? 'reprogrammé' : 'programmé'} ${action === 'publish' ? 'la mise en ligne' : 'le retrait du site'} de ${contentName(def, type, title, locales)} pour ${whenText(at)}`,
  })
  return { schedules: await entrySchedules(event, id), trigger: await scheduleTrigger(event) }
}

/** Annule des programmations d'un contenu : toutes, ou celles d'une action et de certaines langues. */
export async function cancelSchedule(event: H3Event, user: User, type: string, id: string, filter: { action?: string; locales?: string[] }) {
  const { def } = await loadTarget(event, user, type, id)
  if (filter.action !== undefined && !SCHEDULE_ACTIONS.includes(filter.action as ScheduleAction)) throw createError({ statusCode: 400, message: 'action : « publish » ou « unpublish » est attendu.' })
  const db = useDb(event)
  const { schedules } = schema
  const removed = await db.delete(schedules).where(and(
    eq(schedules.entryId, id),
    filter.action ? eq(schedules.action, filter.action as ScheduleAction) : undefined,
    filter.locales?.length ? inArray(schedules.locale, filter.locales.slice(0, 50)) : undefined,
  )).returning()
  if (removed.length) {
    memo = null
    const title = (await entryTitles(event, [id])).get(id) ?? def.label
    for (const action of SCHEDULE_ACTIONS) {
      for (const failed of [false, true]) {
        const rows = removed.filter(r => r.action === action && !!r.failedAt === failed)
        if (!rows.length) continue
        const what = `${action === 'publish' ? 'la mise en ligne programmée' : 'le retrait programmé'} de ${contentName(def, type, title, rows.map(r => r.locale))}`
        logActivity(event, {
          action: 'schedule.cancelled', category: 'content', actor: user, target: { kind: 'entry', type, id },
          phrase: failed ? `a écarté ${what}, qui avait échoué` : `a annulé ${what}, ${action === 'publish' ? 'prévue' : 'prévu'} ${whenText(rows[0]!.at)}`,
        })
      }
    }
  }
  return { schedules: await entrySchedules(event, id), cancelled: removed.length }
}

// ───────────── Accroches de l'enregistrement (server/utils/entries.ts) ─────────────

/**
 * Publier ou retirer une langue à la main répond à ce qui était programmé pour elle : la programmation de la même
 * action n'a plus d'objet et est retirée, dans le même lot que l'enregistrement.
 */
export function scheduleCleanup(event: H3Event, entryId: string, published: string[], unpublished: string[]) {
  const db = useDb(event)
  const { schedules } = schema
  const drop = (action: ScheduleAction, locales: string[]) =>
    (locales.length ? [db.delete(schedules).where(and(eq(schedules.entryId, entryId), eq(schedules.action, action), inArray(schedules.locale, locales.slice(0, 50))))] : [])
  return [...drop('publish', published), ...drop('unpublish', unpublished)]
}

/**
 * Tant qu'une mise en ligne est programmée, le brouillon partira en ligne tel qu'il sera à l'heure dite : une personne
 * qui n'a pas le droit de publier ne peut donc plus le modifier (sinon elle publierait sans relecture).
 */
export async function assertNotScheduled(event: H3Event, entryId: string) {
  const { schedules } = schema
  const [pending] = await useDb(event).select().from(schedules).where(and(eq(schedules.entryId, entryId), eq(schedules.action, 'publish'), isNull(schedules.failedAt))).orderBy(asc(schedules.at)).limit(1)
  if (!pending) return
  throw createError({
    statusCode: 403,
    message: `La mise en ligne de ce contenu est programmée ${whenText(pending.at)} par ${pending.createdByName} : il partira en ligne tel qu'il est. Pour le modifier encore, demandez à ${pending.createdByName} ou à une personne qui peut publier.`,
  })
}

// ───────────── Exécution ─────────────

/** Une exécution réservée mais jamais terminée (instance arrêtée en route) est reprise après ce délai. */
const CLAIM_MS = 10 * 60_000
const pendingAt = (now: number) => and(isNull(schema.schedules.failedAt), or(isNull(schema.schedules.claimedAt), lt(schema.schedules.claimedAt, new Date(now - CLAIM_MS))))
const keyOf = (r: Pick<Row, 'entryId' | 'locale' | 'action'>) => and(eq(schema.schedules.entryId, r.entryId), eq(schema.schedules.locale, r.locale), eq(schema.schedules.action, r.action))

/** La personne qui a programmé, avec ses droits d'aujourd'hui ; null si son compte n'existe plus. */
async function loadAuthor(event: H3Event, userId: string): Promise<Author | null> {
  const [row] = await useDb(event).select().from(schema.user).where(eq(schema.user.id, userId))
  if (!row) return null
  const [types, role] = await Promise.all([loadUserTypes(event, userId), isBuiltinRole(row.role) ? undefined : loadCustomRole(event, row.role)])
  return { id: row.id, name: row.name, email: row.email, role: row.role, types, custom: role === undefined ? undefined : role?.rights ?? null }
}

/** Déclencheur de workflow « Une publication programmée a échoué », proposé sur tous les sites. */
export function scheduleWorkflowEvents(): ModuleWorkflowEvent[] {
  return [{
    name: 'schedule.failed',
    label: 'Une publication programmée a échoué',
    variables: [
      { key: 'entry.title', label: 'Titre du contenu' },
      { key: 'entry.type', label: 'Type de contenu (Services, Accueil…)' },
      { key: 'entry.locale', label: 'Langues concernées' },
      { key: 'entry.adminUrl', label: 'Adresse du contenu dans le back-office' },
      { key: 'schedule.action', label: 'Ce qui était programmé (mise en ligne ou retrait du site)' },
      { key: 'schedule.date', label: 'Date et heure prévues' },
      { key: 'schedule.by', label: 'Nom de la personne qui avait programmé' },
      { key: 'schedule.error', label: 'Ce qui n\'a pas marché' },
    ],
    targets: [...Object.entries(cmsConfig.collections ?? {}), ...Object.entries(cmsConfig.singletons ?? {})].filter(([, def]) => def.drafts).map(([key, def]) => ({ key, label: def.label })),
    targetsLabel: 'Pour quels contenus',
    sample: target => ({
      summary: 'La mise en ligne programmée de « Contenu d\'exemple » a échoué',
      target,
      context: {
        entry: { title: 'Contenu d\'exemple', type: (target && findDef(target)?.label) || 'Services', locale: cmsConfig.site.defaultLocale, adminUrl: `${cmsConfig.site.url ?? ''}/admin` },
        schedule: { action: SCHEDULE_NOUNS.publish, date: whenText(new Date()), by: 'Personne de test', error: 'Exemple : « Titre » : ce champ est obligatoire.' },
      },
    }),
  }]
}

type Outcome = { done: number; failed: number; skipped: number }

async function failGroup(event: H3Event, rows: Row[], def: CmsDefinition | undefined, title: string, message: string, out: Outcome) {
  if (!rows.length) return
  const first = rows[0]!
  const now = new Date()
  const error = message.slice(0, 500)
  await useDb(event).batch(rows.map(r => useDb(event).update(schema.schedules).set({ failedAt: now, error, claimedAt: null }).where(keyOf(r))) as [any, ...any[]])
  out.failed += rows.length
  const locales = rows.map(r => r.locale)
  const what = `${first.action === 'publish' ? 'La mise en ligne programmée' : 'Le retrait programmé'} de ${contentName(def, first.type, title, locales)}`
  logActivity(event, {
    action: 'schedule.failed', category: 'content', actor: null, target: { kind: 'entry', type: first.type, id: first.entryId },
    phrase: `${what} par ${first.createdByName} a échoué : ${error}`,
  })
  await emitCmsEvents(event, [{
    name: 'schedule.failed', module: 'core', target: first.type,
    summary: `${what} a échoué`,
    context: {
      entry: { title, type: def?.label ?? first.type, locale: locales.join(', '), adminUrl: `${getRequestURL(event).origin}${adminEntryPath(first.type, first.entryId)}` },
      schedule: { action: SCHEDULE_NOUNS[first.action], date: whenText(first.at), by: first.createdByName, error },
    },
  }])
}

/** Exécute les programmations d'un même contenu prévues ensemble (même action, même heure) : un seul enregistrement. */
async function runGroup(event: H3Event, group: Row[], out: Outcome) {
  const db = useDb(event)
  const { schedules, entries, entryLocales } = schema
  // Réservation : si deux déclenchements arrivent ensemble (tâche planifiée et repli), un seul obtient chaque ligne.
  const claimedAt = new Date()
  let rows: Row[] = []
  for (const r of group) {
    const claimed = await db.update(schedules).set({ claimedAt }).where(and(keyOf(r), eq(schedules.at, r.at), pendingAt(claimedAt.getTime()))).returning()
    rows.push(...claimed)
  }
  if (!rows.length) return
  const { entryId, type, action } = rows[0]!
  const drop = async (list: Row[]) => {
    if (!list.length) return
    await db.batch(list.map(r => db.delete(schedules).where(keyOf(r))) as [any, ...any[]])
    out.skipped += list.length
  }

  const def = findDef(type)
  const [entry] = await db.select().from(entries).where(eq(entries.id, entryId))
  if (!entry) return drop(rows)
  const title = (await entryTitles(event, [entryId])).get(entryId) ?? def?.label ?? ''
  const fail = (list: Row[], message: string) => failGroup(event, list, def, title, message, out)
  if (!def) return fail(rows, 'Ce type de contenu n\'existe plus dans la configuration du site.')
  if (!def.drafts) return fail(rows, 'Ce type de contenu n\'a plus de brouillon : il n\'y a plus rien à programmer.')

  const by = rows[0]!.createdByName
  const author = await loadAuthor(event, rows[0]!.createdBy)
  const redo = 'Publiez à la main, ou reprogrammez.'
  if (!author) return fail(rows, `Le compte de ${by}, qui avait programmé, n'existe plus. ${redo}`)
  if (!can(author, type, 'publish') || !ownsOrFree(author, type, entry)) return fail(rows, `${by}, qui avait programmé, n'a plus le droit de publier ce contenu. ${redo}`)

  const locales = await db.select().from(entryLocales).where(eq(entryLocales.entryId, entryId))
  const rowOf = (locale: string) => locales.find(l => l.locale === locale)
  await fail(rows.filter(r => !rowOf(r.locale)), 'Cette langue n\'a plus de contenu.')
  rows = rows.filter(r => rowOf(r.locale))
  // Déjà fait entre-temps (tout est en ligne, ou la langue n'y est plus) : il n'y a rien à faire, et rien à signaler.
  const moot = rows.filter(r => (action === 'publish' ? rowOf(r.locale)!.status === 'published' : !rowOf(r.locale)!.published))
  await drop(moot)
  rows = rows.filter(r => !moot.includes(r))

  const attempt = async (list: Row[]): Promise<void> => {
    if (!list.length) return
    const langs = list.map(r => r.locale)
    try {
      // Le brouillon tel qu'il est maintenant : c'est lui qui part en ligne, avec les mêmes vérifications qu'à la main.
      const saved = await writeScheduled(event, type, entryId, action === 'publish'
        ? { locales: Object.fromEntries(langs.map(l => [l, { values: rowOf(l)!.draft }])), publish: langs }
        : { unpublish: langs }, author)
      // L'enregistrement retire lui-même les lignes exécutées (scheduleCleanup) ; par sûreté, on s'en assure.
      await db.batch(list.map(r => db.delete(schedules).where(keyOf(r))) as [any, ...any[]])
      out.done += list.length
      const late = 'purgeFailed' in saved && saved.purgeFailed
      logActivity(event, {
        action: action === 'publish' ? 'schedule.published' : 'schedule.unpublished', category: 'content', actor: null, target: { kind: 'entry', type, id: entryId },
        phrase: `${action === 'publish' ? 'Mise en ligne automatique' : 'Retrait automatique du site'} de ${contentName(def, type, title, langs)}, ${action === 'publish' ? 'programmée' : 'programmé'} par ${by}`
          + (late ? '. Le cache du site n\'a pas pu être vidé : le site peut mettre jusqu\'à une heure à le montrer' : ''),
      })
    }
    catch (error) {
      const e = error as { statusCode?: number; message?: string; data?: { errors?: Record<string, Record<string, string>> } }
      if (e.statusCode === 409) {
        // Quelqu'un enregistrait au même instant : la ligne est libérée, le prochain passage la reprendra.
        await db.batch(list.map(r => db.update(schedules).set({ claimedAt: null }).where(keyOf(r))) as [any, ...any[]])
        return
      }
      const errors = e.statusCode === 422 ? e.data?.errors : undefined
      if (!errors) {
        if (!e.statusCode) console.error('[cms] une publication programmée a échoué', error)
        return fail(list, e.statusCode ? e.message || 'Raison inconnue.' : 'Une erreur inattendue s\'est produite. Publiez à la main, ou reprogrammez.')
      }
      // Les langues en défaut échouent ; les autres, s'il y en a, sont publiées quand même.
      const labels = Object.fromEntries(Object.entries(def.fields as Record<string, AnyField>).map(([key, f]) => [key, f.label ?? key]))
      const bad = list.filter(r => errors[r.locale])
      const shared = Object.keys(partition(def.fields as Record<string, AnyField>).shared)
      for (const r of bad.length ? bad : list)
        await fail([r], `Le contenu n'est plus complet. ${describeFieldErrors(bad.length ? { [r.locale]: errors[r.locale]! } : errors, labels, multi(), shared)} Corrigez, puis publiez ou reprogrammez.`)
      if (bad.length && bad.length < list.length) await attempt(list.filter(r => !bad.includes(r)))
    }
  }
  await attempt(rows)
}

/**
 * Exécute tout ce qui est dû à l'instant `now`. Appelé par la tâche planifiée et par le repli ; peut l'être deux fois
 * en même temps sans dommage.
 */
export async function runDueSchedules(event: H3Event, now: Date = new Date()): Promise<Outcome> {
  const out: Outcome = { done: 0, failed: 0, skipped: 0 }
  const { schedules } = schema
  // Une ligne réservée à l'instant par un autre passage n'est pas reprise : l'heure réelle sert à en juger.
  const due = await useDb(event).select().from(schedules).where(and(lte(schedules.at, now), pendingAt(Date.now()))).orderBy(asc(schedules.at)).limit(60)
  const groups = new Map<string, Row[]>()
  for (const r of due) {
    const key = `${r.entryId}|${r.action}|${r.at.getTime()}`
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  for (const group of groups.values()) {
    try { await runGroup(event, group, out) }
    catch (error) { console.error('[cms] une publication programmée n\'a pas pu être traitée', error) }
  }
  if (due.length) await refreshNextDue(event).catch(() => { memo = null })
  return out
}

// ───────────── Repli et cache ─────────────

/** Durée pendant laquelle une instance fait confiance à sa mémoire avant de relire la prochaine échéance en base. */
const MEMO_MS = 60_000
let memo: { next: number | null; checkedAt: number } | null = null

async function refreshNextDue(event: H3Event) {
  const [row] = await useDb(event).select({ next: sql<number | null>`min(${schema.schedules.at})` }).from(schema.schedules).where(pendingAt(Date.now()))
  memo = { next: row?.next ?? null, checkedAt: Date.now() }
}
function noteNextDue(at: number) {
  if (memo) memo = { ...memo, next: memo.next === null ? at : Math.min(memo.next, at) }
}

/**
 * Repli : exécute ce qui est dû avant de répondre, si une échéance est passée. Ne fait jamais échouer la requête
 * (un site dont la table n'existe pas encore, par exemple, continue de répondre).
 */
export async function catchUpSchedules(event: H3Event) {
  try {
    const now = Date.now()
    if (!memo || now - memo.checkedAt > MEMO_MS) await refreshNextDue(event)
    if (memo!.next !== null && memo!.next <= now) {
      // Les requêtes qui arrivent pendant l'exécution n'attendent pas : une seule s'en charge.
      memo = { next: null, checkedAt: now }
      await runDueSchedules(event, new Date(now))
    }
  }
  catch (error) {
    console.error('[cms] le rattrapage des publications programmées a échoué', error)
    memo = { next: null, checkedAt: Date.now() }
  }
}

/**
 * Durée maximale de mise en cache d'une réponse publique, en secondes : jusqu'à la prochaine échéance connue.
 * null : aucune limite (rien n'est programmé).
 */
export function scheduleCacheSeconds(): number | null {
  if (!memo || memo.next === null) return null
  return Math.max(0, Math.ceil((memo.next - Date.now()) / 1000))
}
