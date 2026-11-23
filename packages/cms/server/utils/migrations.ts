import { eq, inArray } from 'drizzle-orm'
import type { H3Event } from 'h3'
import {
  type Doc, type PlannedOp, type Snapshot, assumedBaseline, diffSchema, hashOf, planMigration, runMigration, shapeOf,
} from '../../shared/migrate'

/**
 * Migrations de contenu : la logique est dans `shared/migrate.ts`, ce fichier la branche sur la base.
 *
 * L'état est une ligne de `cms_settings` (clé `schema`) : la dernière structure appliquée, l'empreinte du
 * fichier de configuration déjà examiné, le nombre de points en attente et un court journal.
 * Sur Cloudflare Workers rien ne s'exécute au déploiement : la vérification a lieu à la première requête
 * de chaque instance du serveur, puis n'est plus refaite tant que le code déployé ne change pas.
 */
const KEY = 'schema'
/** Taille maximale du JSON passé à une requête d'écriture groupée (D1 limite une valeur à 2 Mo). */
const CHUNK_BYTES = 400_000

export type MigrationLogEntry = { at: string; by: string | null; lines: string[] }
type State = {
  rev: number
  /** Empreinte de la configuration déjà examinée. */
  target: string
  /** Nombre de points qui attendent un administrateur. */
  pending: number
  snapshot: Snapshot
  /** Déplacements trouvés au tout premier examen d'un site existant : jamais automatiques. */
  held?: string[]
  log: MigrationLogEntry[]
}

export type MigrationItem = Pick<PlannedOp, 'level' | 'title' | 'text' | 'warning' | 'choices' | 'stats'> & { id: string }
export type MigrationReport = {
  /** Ce qui reste à valider ou à régler. */
  pending: MigrationItem[]
  /** Ce que cet appel vient d'appliquer. */
  applied: string[]
  log: MigrationLogEntry[]
  /** Des contenus publiés ont changé. */
  siteChanged: boolean
}

/** Ce que ce fichier utilise de la liaison D1. */
type D1Like = { prepare: (text: string) => { bind: (...params: unknown[]) => unknown }; batch: (statements: unknown[]) => Promise<unknown> }

type Options = { apply: boolean; confirmed?: string[]; choices?: Record<string, string>; by?: string | null }

let cached: { target: Snapshot; hash: string } | undefined
/** Structure décrite par le fichier de configuration, et son empreinte. Fixes pour un déploiement donné. */
function current() {
  if (!cached) { const target = shapeOf(cmsConfig); cached = { target, hash: hashOf(target) } }
  return cached
}

const item = (p: PlannedOp): MigrationItem => ({ id: p.op.id, level: p.level, title: p.title, text: p.text, warning: p.warning, choices: p.choices, stats: p.stats })
/** Les changements de libellé n'intéressent personne : ils ne sont ni affichés ni consignés. */
const visible = (p: PlannedOp) => p.op.kind !== 'meta'

/** Découpe une liste en paquets dont le JSON reste sous la limite de taille. */
function chunks<T>(items: T[]): T[][] {
  const out: T[][] = []
  let size = 0
  for (const it of items) {
    const bytes = JSON.stringify(it).length * 2
    if (!out.length || size + bytes > CHUNK_BYTES) { out.push([]); size = 0 }
    out.at(-1)!.push(it)
    size += bytes
  }
  return out
}

async function loadDocs(event: H3Event) {
  const db = useDb(event)
  const [entries, rows] = await Promise.all([db.select().from(schema.entries), db.select().from(schema.entryLocales)])
  const byEntry = new Map<string, typeof rows>()
  for (const row of rows) byEntry.set(row.entryId, [...(byEntry.get(row.entryId) ?? []), row])
  const docs: Doc[] = entries.map(e => ({
    id: e.id,
    type: e.type,
    shared: { draft: e.sharedDraft, published: e.sharedPublished },
    locales: (byEntry.get(e.id) ?? []).map(r => ({ locale: r.locale, status: r.status, draft: r.draft, published: r.published })),
  }))
  return { docs, stamps: new Map(entries.map(e => [e.id, e.updatedAt.getTime()])) }
}

/**
 * Compare la configuration à la structure mémorisée et, si `apply`, exécute ce qui peut l'être :
 * tout ce qui est sans risque, plus ce que l'administrateur a validé (`confirmed`, `choices`).
 * Les écritures partent en un seul lot : soit tout est appliqué et mémorisé, soit rien.
 */
export async function migrateContent(event: H3Event, options: Options): Promise<MigrationReport> {
  const db = useDb(event)
  const { settings, entries, workflows } = schema
  const { target, hash } = current()
  const site = cmsConfig.site

  for (let attempt = 1; ; attempt++) {
    const [row] = await db.select().from(settings).where(eq(settings.key, KEY))
    const state = (row?.value ?? null) as State | null
    const base = state?.snapshot ?? assumedBaseline(target)
    const ops = diffSchema(base, target)
    // Les contenus ne sont lus que si une opération les concerne.
    const { docs, stamps } = ops.some(o => !['add', 'meta', 'restore'].includes(o.kind)) ? await loadDocs(event) : { docs: [], stamps: new Map<string, number>() }
    const planOptions = { site, firstRun: !state, held: state?.held, confirmed: options.confirmed, choices: options.choices }
    const log = state?.log ?? []

    if (!options.apply) return { pending: planMigration(docs, ops, planOptions).filter(visible).map(item), applied: [], log, siteChanged: false }

    const run = runMigration(docs, base, ops, planOptions)
    const pending = run.pending.filter(visible)
    const report: MigrationReport = { pending: pending.map(item), applied: run.applied.filter(visible).map(p => p.text), log, siteChanged: false }
    if (state && !run.applied.length && state.target === hash && state.pending === pending.length) return report

    // Ce qui a réellement changé, contenu par contenu.
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
    const sharedUpdates: [string, { d: unknown; p: unknown }][] = []
    const localeUpdates: { e: string; l: string; d: unknown; p: unknown; s: string }[] = []
    const touched = new Set<string>()
    const gone: string[] = []
    docs.forEach((before, i) => {
      const after = run.docs[i]!
      if (after.gone) { gone.push(before.id); touched.add(before.id); return }
      if (!same(before.shared, after.shared)) {
        sharedUpdates.push([before.id, { d: after.shared.draft, p: after.shared.published }])
        touched.add(before.id)
        if (!same(before.shared.published, after.shared.published)) report.siteChanged = true
      }
      after.locales.forEach((l, j) => {
        if (same(before.locales[j], l)) return
        localeUpdates.push({ e: before.id, l: l.locale, d: l.draft, p: l.published, s: l.status })
        touched.add(before.id)
        if (!same(before.locales[j]!.published, l.published)) report.siteChanged = true
      })
    })
    if (run.typeRenames.length) report.siteChanged = true

    // Journal : ce qui a été fait, avec l'avertissement accepté et le choix retenu le cas échéant.
    // Au premier examen, la structure de départ est supposée : seuls les vrais déplacements méritent une ligne.
    const lines = run.applied.filter(p => visible(p) && (state || p.stats.entries)).map((p) => {
      const choice = p.choices.find(c => c.id === options.choices?.[p.op.id])
      return [p.text, p.warning, choice && `Choix retenu : ${choice.label.toLowerCase()}.`].filter(Boolean).join(' ')
    })
    const next: State = {
      rev: (state?.rev ?? 0) + 1,
      target: hash,
      pending: pending.length,
      snapshot: run.snapshot,
      held: pending.filter(p => p.op.kind === 'rename' && p.level === 'confirm').map(p => p.op.id),
      log: lines.length ? [{ at: new Date().toISOString(), by: options.by ?? null, lines }, ...log].slice(0, 30) : log,
    }

    // Les requêtes d'écriture groupée passent directement par D1 : le lot de Drizzle n'accepte pas le SQL libre avec paramètres.
    const d1 = usePlatform().database(event) as D1Like
    const raw = (text: string, ...params: unknown[]) => d1.prepare(text).bind(...params)
    const built = (query: { toSQL: () => { sql: string; params: unknown[] } }) => raw(query.toSQL().sql, ...query.toSQL().params)
    const statements: unknown[] = []
    // Garde-fou : si la structure mémorisée ou l'un des contenus a changé depuis la lecture (autre instance du
    // serveur, enregistrement au même moment), cette insertion viole une contrainte et annule tout le lot.
    const stampChunks = chunks([...touched].map(id => [id, stamps.get(id)] as const))
    for (const [i, part] of (stampChunks.length ? stampChunks : [[]]).entries()) {
      const stale = `exists (select 1 from json_each(?) as j left join cms_entries as e on e.id = j.key where e.id is null or e.updated_at <> j.value)`
      const stamped = JSON.stringify(Object.fromEntries(part))
      statements.push(i === 0
        ? raw(`insert into cms_settings (key, value, updated_at) select 'schema:conflit', null, 0
            where coalesce((select json_extract(value, '$.rev') from cms_settings where key = ?), 0) <> ? or ${stale}`, KEY, state?.rev ?? 0, stamped)
        : raw(`insert into cms_settings (key, value, updated_at) select 'schema:conflit', null, 0 where ${stale}`, stamped))
    }
    // Écritures groupées : une requête par paquet de contenus, quel que soit leur nombre.
    for (const part of chunks(sharedUpdates)) {
      statements.push(raw(`update cms_entries set shared_draft = json_extract(j.value, '$.d'), shared_published = json_extract(j.value, '$.p')
        from json_each(?) as j where cms_entries.id = j.key`, JSON.stringify(Object.fromEntries(part))))
    }
    for (const part of chunks(localeUpdates)) {
      statements.push(raw(`update cms_entry_locales set draft = json_extract(j.value, '$.d'), published = json_extract(j.value, '$.p'), status = json_extract(j.value, '$.s')
        from json_each(?) as j
        where cms_entry_locales.entry_id = json_extract(j.value, '$.e') and cms_entry_locales.locale = json_extract(j.value, '$.l')`, JSON.stringify(part)))
    }
    for (let i = 0; i < gone.length; i += 80) statements.push(built(db.delete(entries).where(inArray(entries.id, gone.slice(i, i + 80)))))
    for (const { from, to, singleton } of run.typeRenames) {
      statements.push(
        raw('update cms_entries set type = ? where type = ?', to, from),
        raw('update cms_entry_locales set type = ? where type = ?', to, from),
        // Les anciennes adresses continuent de rediriger vers les contenus renommés.
        raw('update or replace cms_redirects set type = ? where type = ?', to, from),
      )
      // L'identifiant d'un singleton est son nom : le contenu est recopié sous le nouveau, ses langues le suivent.
      if (singleton) {
        statements.push(
          raw(`insert into cms_entries (id, type, position, shared_draft, shared_published, created_at, updated_at)
            select ?, type, position, shared_draft, shared_published, created_at, updated_at from cms_entries where id = ? and type = ?`, to, from, to),
          raw('update cms_entry_locales set entry_id = ? where entry_id = ? and type = ?', to, from, to),
          raw('update cms_redirects set entry_id = ? where entry_id = ? and type = ?', to, from, to),
          raw('delete from cms_entries where id = ? and type = ?', from, to),
        )
      }
    }
    // Les workflows limités à un type de contenu suivent son nouveau nom.
    if (run.typeRenames.length) {
      const renamed = new Map(run.typeRenames.map(r => [r.from, r.to]))
      for (const w of await db.select().from(workflows)) {
        if (w.trigger.types.some(t => renamed.has(t)))
          statements.push(built(db.update(workflows).set({ trigger: { ...w.trigger, types: w.trigger.types.map(t => renamed.get(t) ?? t) } }).where(eq(workflows.id, w.id))))
      }
    }
    const now = new Date()
    statements.push(built(db.insert(settings).values({ key: KEY, value: next, updatedAt: now }).onConflictDoUpdate({ target: settings.key, set: { value: next, updatedAt: now } })))

    try {
      await d1.batch(statements)
    }
    catch (error) {
      // Rien n'a été écrit. On relit et on recommence : la situation a changé entre-temps.
      if (attempt < 3) { console.warn('[cms] migration des contenus : la base a changé entre-temps, nouvelle tentative'); continue }
      throw error
    }
    if (report.siteChanged) await purgeSiteCache(event)
    return { ...report, log: next.log }
  }
}

let synced = false
let nextCheck = 0

/**
 * À appeler au début de chaque requête : applique les migrations sans risque dès le premier accès qui suit un
 * déploiement. Une fois la structure à jour, la vérification ne coûte plus rien pour cette instance du serveur.
 * Une erreur ici ne doit jamais empêcher le site de répondre.
 */
export async function ensureContentSchema(event: H3Event) {
  if (synced || Date.now() < nextCheck) return
  // Chez Cloudflare, certaines requêtes n'ont pas de base (pré-rendu) ; sur un serveur Node, elle est toujours là.
  if (usePlatform().name === 'cloudflare' && !event.context.cloudflare?.env?.DB) return
  try {
    const [row] = await useDb(event).select().from(schema.settings).where(eq(schema.settings.key, KEY))
    let state = row?.value as Pick<State, 'target' | 'pending'> | undefined
    if (state?.target !== current().hash) {
      const report = await migrateContent(event, { apply: true })
      state = { target: current().hash, pending: report.pending.length }
    }
    if (state.pending === 0) synced = true
    // Des points attendent un administrateur : inutile de relire l'état à chaque requête.
    else nextCheck = Date.now() + 10_000
  }
  catch (error) {
    nextCheck = Date.now() + 30_000
    console.error('[cms] vérification de la structure des contenus impossible', error)
  }
}

/** Nombre de points en attente d'un administrateur, d'après le dernier examen. */
export async function pendingMigrations(event: H3Event) {
  const [row] = await useDb(event).select().from(schema.settings).where(eq(schema.settings.key, KEY))
  const state = row?.value as State | undefined
  return state?.target === current().hash ? state.pending : 0
}
