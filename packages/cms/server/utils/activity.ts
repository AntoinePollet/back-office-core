/**
 * Journal d'activité : qui a fait quoi et quand (table cms_activity, écran « Activité » réservé à l'administrateur).
 *
 * ── Inscrire une action ──
 * Une seule fonction, à appeler dans la route une fois l'action réussie :
 *
 *   logActivity(event, { action: 'role.created', actor: admin, details: { name: role.name }, target: { kind: 'role', id: role.id } })
 *
 * - `action` : un code du catalogue (shared/activity.ts, `ACTIVITY_ACTIONS`), qui fournit la phrase en français.
 * - `actor` : la personne (l'objet renvoyé par `requireUser` convient). Son nom et son e-mail sont recopiés dans la
 *   ligne : ils restent lisibles si le compte est supprimé. `null` ou absent : action automatique.
 * - `target` : ce sur quoi porte l'action, pour que l'écran propose un lien tant que l'élément existe.
 *
 * Une fonction qui n'est pas au catalogue (sauvegardes, double authentification…) donne elle-même sa phrase, à lire
 * après le nom de la personne, et sa famille (`content`, `media`, `users`, `auth`, `settings`) :
 *
 *   logActivity(event, { action: 'backup.created', category: 'settings', phrase: 'a créé une sauvegarde du site', actor: admin })
 *
 * La fonction ne ralentit pas la réponse et ne la fait jamais échouer : l'écriture part après la réponse
 * (`event.waitUntil`) et une erreur est seulement consignée. Ne jamais y mettre de mot de passe, de jeton, de lien à
 * usage unique ni de valeur de clé d'API.
 *
 * ── Contenus ──
 * Les routes des contenus n'appellent pas `logActivity` : `emitCmsEvents` (server/utils/events.ts) inscrit lui-même au
 * journal les événements qu'il émet pour les workflows. Une action sur un contenu ne peut donc pas figurer dans l'un
 * sans figurer dans l'autre.
 *
 * ── Conservation ──
 * `ACTIVITY_DAYS` jours (180) ; les lignes plus anciennes sont effacées à chaque écriture. Pas d'adresse IP, sauf sur
 * les lignes d'échecs de connexion répétés (c'est ce qui permet de distinguer un oubli d'une attaque).
 */
import { and, desc, eq, gte, inArray, lt, lte, or, sql, type SQL } from 'drizzle-orm'
import type { H3Event } from 'h3'
import {
  ACTIVITY_ACTIONS, ACTIVITY_DAYS, type ActivityAction, type ActivityCategory, type ActivityDetails, type EntryActivityHint,
  activityCategory, activityFromEvents, activityPhrase, activitySentence,
} from '../../shared/activity'
import { adminEntryPath } from '../../shared/admin-paths'

export type ActivityActor = { id?: string | null; name?: string | null; email?: string | null }
export type ActivityTarget = { kind: string; type?: string | null; id?: string | null }
type Common = { actor?: ActivityActor | null; target?: ActivityTarget; /** Seulement pour les échecs de connexion. */ ip?: string }
export type ActivityInput = Common & (
  | { action: ActivityAction; details?: ActivityDetails }
  | { action: string; category: ActivityCategory; /** Ce que la personne a fait : « a créé une sauvegarde du site ». */ phrase: string }
)

type Row = typeof schema.activity.$inferInsert

async function writeActivity(event: H3Event, inputs: ActivityInput[], now: number) {
  const db = useDb(event)
  // Un événement de workflow ne porte que l'identifiant et l'e-mail de la personne : son nom est relu ici.
  const unnamed = [...new Set(inputs.flatMap(i => (i.actor?.id && !i.actor.name ? [i.actor.id] : [])))]
  const names = new Map<string, { name: string; email: string }>()
  if (unnamed.length) {
    const rows = await db.select({ id: schema.user.id, name: schema.user.name, email: schema.user.email }).from(schema.user).where(inArray(schema.user.id, unnamed.slice(0, 80)))
    for (const r of rows) names.set(r.id, r)
  }
  const rows: Row[] = inputs.map((input, i) => {
    const found = input.actor?.id ? names.get(input.actor.id) : undefined
    const actorName = input.actor?.name ?? found?.name ?? input.actor?.email ?? null
    const phrase = 'phrase' in input ? input.phrase : activityPhrase(input.action, input.details)
    return {
      id: crypto.randomUUID(),
      // Les lignes d'un même enregistrement gardent leur ordre.
      at: new Date(now + i),
      action: input.action,
      category: 'phrase' in input ? input.category : activityCategory(input.action) ?? 'settings',
      actorId: input.actor?.id ?? null,
      actorName,
      actorEmail: input.actor?.email ?? found?.email ?? null,
      summary: activitySentence(actorName, phrase).slice(0, 500),
      targetKind: input.target?.kind ?? null,
      targetType: input.target?.type ?? null,
      targetId: input.target?.id ?? null,
      ip: input.ip ?? null,
    }
  })
  await db.batch([
    // Ménage : le journal ne garde que ACTIVITY_DAYS jours.
    db.delete(schema.activity).where(lt(schema.activity.at, new Date(now - ACTIVITY_DAYS * 86_400_000))),
    ...rows.map(row => db.insert(schema.activity).values(row)),
  ])
}

/** Inscrit une ou plusieurs actions au journal d'activité, après la réponse. Voir l'en-tête du fichier. */
export function logActivity(event: H3Event, input: ActivityInput | ActivityInput[]) {
  const inputs = [input].flat()
  if (!inputs.length) return
  const run = writeActivity(event, inputs, Date.now()).catch(error => console.error('[cms] l\'inscription au journal d\'activité a échoué', error))
  event.waitUntil(run)
}

/** Inscrit au journal les événements de contenus émis pour les workflows (appelé par `emitCmsEvents`). */
export function logEntryEvents(event: H3Event, events: { name: string; type?: string; id?: string; title?: string; locale?: string; user?: ActivityActor }[], hint?: EntryActivityHint) {
  const actor = events.find(e => e.user)?.user ?? null
  logActivity(event, activityFromEvents(events, hint).map((line) => {
    const def = findDef(line.type)
    return {
      action: line.action,
      actor,
      details: { title: line.title, typeLabel: def?.label ?? line.type, single: def?.kind === 'singleton', locales: line.locales },
      target: { kind: 'entry', type: line.type, id: line.id },
    }
  }))
}

// ───────────── Lecture (écran « Activité ») ─────────────

export type ActivityFilters = { actor?: string; category?: string; actions?: string[]; from?: number; to?: number; q?: string }

/** Lit les filtres de l'écran dans l'adresse. */
export function parseActivityFilters(event: H3Event): ActivityFilters {
  const query = getQuery(event)
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
  const number = (v: unknown) => (Number.isFinite(Number(v)) && v !== undefined && v !== '' ? Number(v) : undefined)
  return {
    actor: text(query.actor), category: text(query.category), q: text(query.q)?.slice(0, 100),
    actions: text(query.action)?.split(',').filter(a => a in ACTIVITY_ACTIONS).slice(0, 20),
    from: number(query.from), to: number(query.to),
  }
}

function conditions(filters: ActivityFilters): SQL[] {
  const a = schema.activity
  const out: SQL[] = []
  // « — » : les actions automatiques, sans personne.
  if (filters.actor) out.push(filters.actor === '-' ? sql`${a.actorEmail} is null` : eq(a.actorEmail, filters.actor))
  if (filters.category) out.push(eq(a.category, filters.category))
  if (filters.actions?.length) out.push(inArray(a.action, filters.actions))
  if (filters.from !== undefined) out.push(gte(a.at, new Date(filters.from)))
  if (filters.to !== undefined) out.push(lte(a.at, new Date(filters.to)))
  if (filters.q) {
    const needle = `%${filters.q.replace(/[\\%_]/g, c => `\\${c}`)}%`
    out.push(or(sql`${a.summary} like ${needle} escape '\\'`, sql`${a.actorEmail} like ${needle} escape '\\'`)!)
  }
  return out
}

type ActivityRow = typeof schema.activity.$inferSelect

/** Lignes du journal, de la plus récente à la plus ancienne. `before` : curseur « at:id » de la dernière ligne déjà reçue. */
export async function readActivity(event: H3Event, filters: ActivityFilters, limit: number, before?: string): Promise<ActivityRow[]> {
  const a = schema.activity
  const where = conditions(filters)
  const [at, id] = (before ?? '').split(':')
  if (at && id && Number.isFinite(Number(at))) where.push(or(lt(a.at, new Date(Number(at))), and(eq(a.at, new Date(Number(at))), lt(a.id, id)))!)
  return useDb(event).select().from(a).where(and(...where)).orderBy(desc(a.at), desc(a.id)).limit(limit)
}

/** Personnes présentes dans le journal, pour le filtre. */
export async function activityActors(event: H3Event) {
  const a = schema.activity
  const rows = await useDb(event).select({ email: a.actorEmail, name: sql<string>`max(${a.actorName})` }).from(a).where(sql`${a.actorEmail} is not null`).groupBy(a.actorEmail)
  return rows.map(r => ({ email: r.email!, name: r.name || r.email! })).sort((x, y) => x.name.localeCompare(y.name, 'fr'))
}

/** Adresse, dans le back-office, de ce sur quoi porte chaque ligne ; null si l'élément n'existe plus. */
export async function activityLinks(event: H3Event, rows: ActivityRow[]): Promise<Map<string, string | null>> {
  const db = useDb(event)
  const ids = (kind: string) => [...new Set(rows.flatMap(r => (r.targetKind === kind && r.targetId ? [r.targetId] : [])))].slice(0, 80)
  const existing = async (kind: string, table: 'entries' | 'media' | 'user' | 'workflows' | 'roles') => {
    const list = ids(kind)
    if (!list.length) return new Set<string>()
    const column = schema[table].id
    return new Set((await db.select({ id: column }).from(schema[table]).where(inArray(column, list))).map(r => r.id))
  }
  const trashedIds = [...new Set([...ids('entry'), ...ids('media')])].slice(0, 80)
  const [entries, media, users, workflows, roles, trashed] = await Promise.all([
    existing('entry', 'entries'), existing('media', 'media'), existing('user', 'user'), existing('workflow', 'workflows'), existing('role', 'roles'),
    trashedIds.length ? db.select({ itemId: schema.trash.itemId }).from(schema.trash).where(inArray(schema.trash.itemId, trashedIds)) : [],
  ])
  const inTrash = new Set(trashed.map(t => t.itemId))
  const link = (r: ActivityRow): string | null => {
    const id = r.targetId ?? ''
    switch (r.targetKind) {
      case 'entry': return entries.has(id) && r.targetType && findDef(r.targetType) ? adminEntryPath(r.targetType, id) : inTrash.has(id) ? '/admin/trash' : null
      case 'collection': return r.targetType && findDef(r.targetType) ? `/admin/${r.targetType}` : null
      case 'media': return media.has(id) ? '/admin/media' : inTrash.has(id) ? '/admin/trash' : null
      case 'folder': return '/admin/media'
      case 'user': return users.has(id) ? '/admin/users' : null
      case 'role': return roles.has(id) ? '/admin/roles' : null
      case 'workflow': return workflows.has(id) ? `/admin/workflows/${id}` : null
      case 'module': return activeModule(id) ? `/admin/modules/${id}` : null
      case 'theme': return '/admin/appearance'
      case 'migrations': return '/admin/migrations'
      case 'trash': return '/admin/trash'
      default: return null
    }
  }
  return new Map(rows.map(r => [r.id, link(r)]))
}
