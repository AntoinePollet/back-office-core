import type { H3Event } from 'h3'
import {
  type BackupColumn, type BackupFailure, type BackupHeader, type BackupKind, type BackupState, type BackupValue, type ForeignKey, type Statement,
  BACKUP_FORMAT, BACKUP_KIND_LABELS, BACKUP_PREFIX, BACKUP_VERSION, EXCLUDED_TABLES, MAX_RESTORE_BYTES, MERGED_ON_RESTORE, STATE_KEY,
  assembleBackup, backupName, backupStatus, encodeValue, endLine, expiredBackups, formatBackupSize, fromBase64, headerLine, insertStatements,
  isBackupTable, isBlob, isKeptOnRestore, isSealed, isSealedColumn, orphanStatements, parseBackupName, retentionDays, rowLine, tableLine, withFailure,
} from '../../shared/backup'
import { decryptSecret, encryptSecret } from '../../shared/secrets'
import type { Bucket, BucketPart, SqlDatabase } from '../platform/types'
import type { ModuleWorkflowEvent } from './modules'

/**
 * Sauvegardes de la base et restauration.
 *
 * Une sauvegarde est un fichier compressé rangé dans le stockage R2 du site, sous un dossier que le site ne sert
 * jamais (`_sauvegardes/`), ou dans un bucket à part si la liaison `BACKUPS` existe. Format : `shared/backup.ts`.
 * Elle contient toutes les tables présentes dans la base au moment où elle tourne (leur liste est lue dans la base),
 * sauf les connexions en cours et les liens à usage unique. Les valeurs sensibles sont chiffrées avec le secret du site.
 *
 * Limites de Cloudflare prises en compte : 128 Mo de mémoire par Worker (la base est lue par pages et le fichier
 * envoyé par morceaux), 100 valeurs par requête D1, 50 Mo par résultat de requête.
 */

// La base et le stockage sont ceux de l'hébergement, sous la forme de D1 et de R2 (server/platform/types.ts).
type D1 = SqlDatabase
type R2Part = BucketPart

/** En dessous de cette taille, la base est lue en une seule transaction : la copie est parfaitement cohérente. */
const SNAPSHOT_MAX_BYTES = 8 * 1024 * 1024
/** Au-delà, elle est lue table par table, par pages de ce nombre de lignes (réduit si une page est trop lourde). */
const PAGE_ROWS = 500
/** Taille des morceaux envoyés à R2 pour un gros fichier. R2 demande des morceaux égaux d'au moins 5 Mo. */
const PART_BYTES = 8 * 1024 * 1024
/** Une sauvegarde automatique par jour : pas de nouvelle si la dernière réussie a moins de 20 heures. */
const AUTO_EVERY_MS = 20 * 3600_000
/** Sans déclencheur planifié, la visite d'un administrateur lance la sauvegarde si la dernière a plus de 26 heures. */
const FALLBACK_AFTER_MS = 26 * 3600_000
/** Après une tentative (réussie ou non), pas de nouvelle tentative automatique pendant une heure. */
const RETRY_AFTER_MS = 3600_000

const q = (name: string) => `"${name.replace(/"/g, '""')}"`

const d1Of = (event: H3Event) => usePlatform().database(event)

/** Où vont les sauvegardes : un stockage à part si le site en déclare un, sinon celui de la médiathèque. */
export const backupBucket = (event: H3Event) => usePlatform().backupBucket(event)

function siteSecret(event: H3Event) {
  const secret = useRuntimeConfig(event).authSecret || (import.meta.dev ? 'secret-de-developpement-a-ne-pas-utiliser-en-production' : '')
  if (!secret) throw createError({ statusCode: 500, message: 'Variable NUXT_AUTH_SECRET manquante.' })
  return secret
}

export const backupRetentionDays = (event: H3Event) => retentionDays((useRuntimeConfig(event) as { backupRetentionDays?: unknown }).backupRetentionDays)

// ───────────── Structure de la base ─────────────

type TableInfo = { table: string; sql: string; columns: BackupColumn[]; foreignKeys: ForeignKey[] }

/** Les tables présentes dans la base, avec leurs colonnes et leurs liens. Renvoie aussi la taille de la base. */
async function readSchema(d1: D1): Promise<{ tables: TableInfo[]; size: number }> {
  const master = await d1.prepare('SELECT name, sql FROM sqlite_master WHERE type = \'table\' ORDER BY name').all()
  const names = (master.results ?? []).map(r => ({ table: String(r.name), sql: String(r.sql ?? '') })).filter(t => !t.table.startsWith('sqlite_') && !t.table.startsWith('_cf_'))
  if (!names.length) return { tables: [], size: 0 }
  const info = await d1.batch(names.flatMap(t => [d1.prepare(`PRAGMA table_info(${q(t.table)})`), d1.prepare(`PRAGMA foreign_key_list(${q(t.table)})`)]))
  const tables = names.map((t, i) => {
    const columns = (info[i * 2]!.results ?? []).map(c => ({ name: String(c.name), type: String(c.type ?? ''), notnull: !!c.notnull, pk: Number(c.pk) || 0 }))
    const raw = info[i * 2 + 1]!.results ?? []
    // Un lien sur plusieurs colonnes a plusieurs lignes du même `id` : seuls les liens simples sont suivis.
    const single = raw.filter(k => raw.filter(o => o.id === k.id).length === 1 && k.to)
    const foreignKeys = single.map(k => ({ table: t.table, from: String(k.from), parent: String(k.table), to: String(k.to), nullable: !columns.find(c => c.name === k.from)?.notnull }))
    return { ...t, columns, foreignKeys }
  })
  // Taille inconnue : on fait comme si la base était grosse (lecture par pages, sans risque pour la mémoire).
  return { tables, size: master.meta?.size_after ?? Number.POSITIVE_INFINITY }
}

// ───────────── Écriture du fichier ─────────────

/** Reçoit les octets compressés et les range dans R2 : en une fois si le fichier est petit, par morceaux égaux sinon. */
function r2Sink(bucket: Bucket, key: string) {
  const options = { httpMetadata: { contentType: 'application/gzip' } }
  let buffered: Uint8Array[] = []
  let size = 0
  let total = 0
  let upload: Awaited<ReturnType<Bucket['createMultipartUpload']>> | undefined
  const parts: R2Part[] = []
  const take = (length: number) => {
    const out = new Uint8Array(length)
    let offset = 0
    while (offset < length) {
      const head = buffered[0]!
      const n = Math.min(head.length, length - offset)
      out.set(head.subarray(0, n), offset)
      offset += n
      if (n === head.length) buffered.shift()
      else buffered[0] = head.subarray(n)
    }
    size -= length
    return out
  }
  return {
    async write(chunk: Uint8Array) {
      buffered.push(chunk)
      size += chunk.length
      total += chunk.length
      while (size >= PART_BYTES) {
        upload ??= await bucket.createMultipartUpload(key, options)
        parts.push(await upload.uploadPart(parts.length + 1, take(PART_BYTES)))
      }
    },
    async close() {
      if (!upload) await bucket.put(key, take(size), options)
      else {
        if (size) parts.push(await upload.uploadPart(parts.length + 1, take(size)))
        await upload.complete(parts)
      }
      return total
    },
    /** Un envoi par morceaux abandonné ne laisse rien de visible dans le bucket. */
    async abort() { buffered = []; await upload?.abort().catch(() => {}) },
  }
}

/** Écrit dans R2 un fichier compressé dont les lignes sont fournies au fur et à mesure. Renvoie sa taille. */
async function writeCompressed(bucket: Bucket, key: string, produce: (emit: (line: string) => Promise<void>) => Promise<void>) {
  const gzip = new CompressionStream('gzip')
  const writer = gzip.writable.getWriter()
  const sink = r2Sink(bucket, key)
  const pump = (async () => {
    const reader = (gzip.readable as ReadableStream<Uint8Array>).getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      await sink.write(value)
    }
  })()
  const encoder = new TextEncoder()
  let pending = ''
  const flush = async () => { if (pending) { const text = pending; pending = ''; await writer.write(encoder.encode(text)) } }
  try {
    await produce(async (line) => {
      pending += line + '\n'
      if (pending.length > 256 * 1024) await flush()
    })
    await flush()
    await writer.close()
    await pump
    return await sink.close()
  }
  catch (error) {
    await writer.abort(error).catch(() => {})
    await pump.catch(() => {})
    await sink.abort()
    throw error
  }
}

/** Lit les lignes d'une table par pages. Une page trop lourde pour D1 est redemandée deux fois plus petite. */
async function* pagedRows(d1: D1, table: string): AsyncGenerator<Record<string, unknown>[]> {
  let after = 0
  let limit = PAGE_ROWS
  for (;;) {
    let rows: Record<string, unknown>[]
    try {
      rows = (await d1.prepare(`SELECT rowid AS "__rowid", * FROM ${q(table)} WHERE rowid > ? ORDER BY rowid LIMIT ?`).bind(after, limit).all()).results ?? []
    }
    catch (error) {
      if (limit === 1) throw error
      limit = Math.max(1, Math.floor(limit / 2))
      continue
    }
    if (!rows.length) return
    after = Number(rows.at(-1)!.__rowid)
    yield rows
    if (rows.length < limit) return
  }
}

export type BackupResult = { name: string; size: number; rows: number; tables: Record<string, number>; createdAt: string; kind: BackupKind }

/** Écrit une sauvegarde complète de la base dans le stockage. Lève une erreur si elle n'a pas pu être menée au bout. */
export async function createBackup(event: H3Event, options: { kind: BackupKind; now?: Date }): Promise<BackupResult> {
  const d1 = d1Of(event)
  const { bucket } = backupBucket(event)
  const secret = siteSecret(event)
  const now = options.now ?? new Date()
  const { tables: all, size } = await readSchema(d1)
  const tables = all.filter(t => isBackupTable(t.table))
  const migrations = all.some(t => t.table === 'd1_migrations')
    ? ((await d1.prepare('SELECT name FROM d1_migrations ORDER BY id').all().catch(() => ({ results: [] }))).results ?? []).map(r => String(r.name))
    : []
  const header: BackupHeader = {
    format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: now.toISOString(), kind: options.kind,
    site: { name: cmsConfig.site.name, url: cmsConfig.site.url ?? null },
    core: String(useRuntimeConfig(event).public.cmsVersion ?? ''),
    migrations,
    excluded: EXCLUDED_TABLES.filter(name => all.some(t => t.table === name)),
    sealed: 'AES-GCM, clé dérivée du secret du site (NUXT_AUTH_SECRET)',
  }
  // Petite base : tout est lu dans une seule transaction, la copie est celle d'un instant précis.
  const snapshot = size <= SNAPSHOT_MAX_BYTES && tables.length
    ? await d1.batch(tables.map(t => d1.prepare(`SELECT * FROM ${q(t.table)}`)))
    : null

  const name = backupName(now, options.kind, crypto.randomUUID().replace(/-/g, '').slice(0, 6))
  const counts: Record<string, number> = {}
  const bytes = await writeCompressed(bucket, BACKUP_PREFIX + name, async (emit) => {
    await emit(headerLine(header))
    for (const [i, t] of tables.entries()) {
      await emit(tableLine(t.table, t.columns, t.sql))
      const sealed = t.columns.map(c => isSealedColumn(t.table, c.name))
      let count = 0
      const write = async (rows: Record<string, unknown>[]) => {
        for (const row of rows) {
          const values: BackupValue[] = []
          for (const [c, column] of t.columns.entries()) {
            const value = encodeValue(row[column.name])
            values.push(sealed[c] && value !== null ? { $sealed: await encryptSecret(secret, JSON.stringify(value)) } : value)
          }
          await emit(rowLine(values))
          count++
        }
      }
      if (snapshot) await write(snapshot[i]!.results ?? [])
      else for await (const page of pagedRows(d1, t.table)) await write(page)
      counts[t.table] = count
    }
    await emit(endLine(counts))
  })
  return { name, size: bytes, rows: Object.values(counts).reduce((a, b) => a + b, 0), tables: counts, createdAt: now.toISOString(), kind: options.kind }
}

// ───────────── Liste, conservation ─────────────

export type BackupItem = { name: string; createdAt: Date; kind: BackupKind; size: number }

/** Les sauvegardes présentes dans le stockage, de la plus récente à la plus ancienne. */
export async function listBackups(event: H3Event): Promise<BackupItem[]> {
  const { bucket } = backupBucket(event)
  const out: BackupItem[] = []
  let cursor: string | undefined
  do {
    const page = await bucket.list({ prefix: BACKUP_PREFIX, cursor })
    for (const object of page.objects) {
      const name = object.key.slice(BACKUP_PREFIX.length)
      const parsed = parseBackupName(name)
      if (parsed) out.push({ name, ...parsed, size: object.size })
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return out.sort((a, b) => b.name.localeCompare(a.name))
}

/** Efface les sauvegardes qui ont dépassé la durée de conservation. Renvoie leur nombre. */
export async function pruneBackups(event: H3Event, now = new Date()) {
  const expired = expiredBackups(await listBackups(event), now, backupRetentionDays(event))
  if (expired.length) await backupBucket(event).bucket.delete(expired.map(b => BACKUP_PREFIX + b.name))
  return expired.length
}

/** Le fichier d'une sauvegarde, ou 404. Le nom est vérifié : rien d'autre que des sauvegardes ne se lit par ici. */
export async function openBackup(event: H3Event, name: string) {
  const parsed = parseBackupName(name)
  const object = parsed ? await backupBucket(event).bucket.get(BACKUP_PREFIX + name) : null
  if (!parsed || !object) throw createError({ statusCode: 404, message: 'Sauvegarde introuvable.' })
  return { ...parsed, name, object }
}

// ───────────── État (dernière réussite, échecs) ─────────────

export async function loadBackupState(event: H3Event): Promise<BackupState> {
  const row = (await d1Of(event).prepare('SELECT value FROM cms_settings WHERE key = ?').bind(STATE_KEY).all()).results?.[0]
  try { return row ? JSON.parse(String(row.value)) as BackupState : {} }
  catch { return {} }
}

async function updateBackupState(event: H3Event, change: (state: BackupState) => BackupState) {
  const state = change(await loadBackupState(event))
  await d1Of(event).prepare('INSERT INTO cms_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(STATE_KEY, JSON.stringify(state), Date.now()).run()
  return state
}

/**
 * Réserve la tentative automatique : une seule requête, pour que deux déclenchements simultanés ne lancent pas deux
 * sauvegardes. Renvoie false si une tentative a eu lieu il y a moins d'une heure.
 */
async function claimAutoAttempt(event: H3Event, now: Date) {
  const d1 = d1Of(event)
  const at = now.toISOString()
  await d1.prepare('INSERT OR IGNORE INTO cms_settings (key, value, updated_at) VALUES (?, ?, ?)').bind(STATE_KEY, JSON.stringify({ since: at }), now.getTime()).run()
  const claimed = await d1.prepare(`UPDATE cms_settings SET value = json_set(value, '$.lastAutoAttemptAt', ?1), updated_at = ?2
    WHERE key = ?3 AND (json_extract(value, '$.lastAutoAttemptAt') IS NULL OR json_extract(value, '$.lastAutoAttemptAt') <= ?4 OR json_extract(value, '$.lastAutoAttemptAt') > ?1)`)
    .bind(at, now.getTime(), STATE_KEY, new Date(now.getTime() - RETRY_AFTER_MS).toISOString()).run()
  return (claimed.meta?.changes ?? 0) > 0
}

// ───────────── Sauvegarde avec suivi (état, événements, ménage) ─────────────

/** Déclencheurs de workflow des sauvegardes, proposés sur tous les sites. */
export function backupWorkflowEvents(): ModuleWorkflowEvent[] {
  const variables = [
    { key: 'backup.date', label: 'Date de la sauvegarde' },
    { key: 'backup.kind', label: 'Automatique, manuelle ou avant restauration' },
    { key: 'backup.adminUrl', label: 'Adresse de l\'écran « Sauvegardes »' },
  ]
  const sample = (ok: boolean) => () => ({
    summary: ok ? 'Sauvegarde automatique réussie (12 Ko)' : 'La sauvegarde automatique a échoué',
    context: { backup: { date: new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }), kind: 'Automatique', adminUrl: `${cmsConfig.site.url ?? ''}/admin/backups`, ...(ok ? { size: '12 Ko' } : { error: 'Exemple : le stockage n\'a pas répondu.' }) } },
  })
  return [
    { name: 'backup.failed', label: 'Une sauvegarde a échoué', variables: [...variables, { key: 'backup.error', label: 'Ce qui n\'a pas marché' }], sample: sample(false) },
    { name: 'backup.succeeded', label: 'Une sauvegarde est faite', variables: [...variables, { key: 'backup.size', label: 'Taille du fichier' }], sample: sample(true) },
  ]
}

function backupEvent(event: H3Event, kind: BackupKind, now: Date, outcome: { size: number } | { error: string }) {
  const label = BACKUP_KIND_LABELS[kind].toLowerCase()
  const size = 'size' in outcome ? formatBackupSize(outcome.size) : null
  const backup: Record<string, string> = {
    date: now.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }), kind: BACKUP_KIND_LABELS[kind],
    adminUrl: `${cmsConfig.site.url ?? getRequestURL(event).origin}/admin/backups`,
    ...('size' in outcome ? { size: size! } : { error: outcome.error }),
  }
  return {
    name: size ? 'backup.succeeded' : 'backup.failed', module: 'core',
    summary: size ? `Sauvegarde ${label} réussie (${size})` : `La sauvegarde ${label} a échoué`,
    context: { backup },
  }
}

export type BackupOutcome = { ok: true; backup: BackupResult; pruned: number } | { ok: false; error: string }

/**
 * Fait une sauvegarde et s'occupe du reste : note la réussite ou l'échec, prévient les workflows, efface les
 * sauvegardes trop anciennes. Ne lève pas d'erreur : l'échec est dans le résultat.
 * `cron` : expression du déclencheur planifié, s'il est à l'origine de la sauvegarde.
 */
export async function runBackup(event: H3Event, options: { kind: BackupKind; now?: Date; cron?: string }): Promise<BackupOutcome> {
  const now = options.now ?? new Date()
  const at = now.toISOString()
  try {
    // Pour vérifier l'alerte en développement : CMS_DEV_SIMULATE_BACKUP_FAILURE contient l'expression d'un
    // déclencheur planifié ; les sauvegardes lancées par ce déclencheur échouent. Sans effet en production.
    if (import.meta.dev && options.cron && process.env.CMS_DEV_SIMULATE_BACKUP_FAILURE === options.cron) throw new Error('Échec simulé (CMS_DEV_SIMULATE_BACKUP_FAILURE).')
    const backup = await createBackup(event, { kind: options.kind, now })
    if (options.kind === 'auto') await updateBackupState(event, s => ({ ...s, since: s.since ?? at, lastAutoSuccessAt: at > (s.lastAutoSuccessAt ?? '') ? at : s.lastAutoSuccessAt }))
    // Le ménage ne doit pas faire échouer une sauvegarde réussie.
    const pruned = await pruneBackups(event, now).catch((error) => { console.error('[cms] sauvegardes anciennes non effacées', error); return 0 })
    await emitCmsEvents(event, [backupEvent(event, options.kind, now, { size: backup.size })])
    return { ok: true, backup, pruned }
  }
  catch (e) {
    const error = ((e as Error)?.message || 'Erreur inconnue.').slice(0, 300)
    console.error(`[cms] la sauvegarde (${options.kind}) a échoué`, e)
    const failure: BackupFailure = { at, kind: options.kind, error }
    // Si la base elle-même ne répond plus, l'échec ne peut pas y être noté : l'alerte « en retard » prendra le relais.
    await updateBackupState(event, s => withFailure({ ...s, since: s.since ?? at }, failure)).catch(() => {})
    await emitCmsEvents(event, [backupEvent(event, options.kind, now, { error })]).catch(() => {})
    return { ok: false, error }
  }
}

/**
 * Sauvegarde automatique, si c'est le moment : au plus une par jour, et pas deux tentatives dans la même heure.
 * - `cron` : appelée par le déclencheur planifié de Cloudflare (`now` est l'heure prévue du déclenchement) ;
 * - sans `cron` : repli, à la visite d'un administrateur, quand le déclencheur n'a rien fait depuis plus d'un jour.
 */
export async function runAutoBackup(event: H3Event, options: { now?: Date; cron?: string } = {}): Promise<BackupOutcome | { ok: true; skipped: string }> {
  const now = options.now ?? new Date()
  const state = await loadBackupState(event)
  if (options.cron !== undefined) await updateBackupState(event, s => ({ ...s, since: s.since ?? now.toISOString(), cronSeenAt: now.toISOString() > (s.cronSeenAt ?? '') ? now.toISOString() : s.cronSeenAt }))
  const last = state.lastAutoSuccessAt ? new Date(state.lastAutoSuccessAt).getTime() : null
  const wait = options.cron !== undefined ? AUTO_EVERY_MS : FALLBACK_AFTER_MS
  if (last !== null && now.getTime() - last < wait) return { ok: true, skipped: 'Une sauvegarde automatique a déjà été faite aujourd\'hui.' }
  if (!(await claimAutoAttempt(event, now))) return { ok: true, skipped: 'Une tentative a eu lieu il y a moins d\'une heure.' }
  return runBackup(event, { kind: 'auto', now, cron: options.cron })
}

/** Ce que l'écran « Sauvegardes » affiche. */
export async function describeBackups(event: H3Event) {
  const [items, state] = await Promise.all([listBackups(event), loadBackupState(event)])
  const now = new Date()
  const lastAuto = items.find(i => i.kind === 'auto')?.createdAt ?? null
  return {
    status: backupStatus({ now, lastAuto, state }),
    items: items.map(i => ({ name: i.name, createdAt: i.createdAt.toISOString(), kind: i.kind, size: i.size })),
    failures: [...(state.failures ?? [])].reverse(),
    retentionDays: backupRetentionDays(event),
    /** Les sauvegardes sont dans un bucket à part (liaison BACKUPS) plutôt qu'à côté de la médiathèque. */
    dedicatedBucket: backupBucket(event).dedicated,
  }
}

// ───────────── Restauration ─────────────

/** Lit et décompresse une sauvegarde en mémoire. Refuse un fichier trop gros pour être restauré depuis un Worker. */
async function readBackup(body: ReadableStream<Uint8Array>) {
  const reader = (body.pipeThrough(new DecompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)).getReader()
  const decoder = new TextDecoder()
  let text = ''
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > MAX_RESTORE_BYTES) {
      await reader.cancel().catch(() => {})
      throw createError({ statusCode: 413, message: 'Cette sauvegarde est trop volumineuse pour être restaurée depuis le back-office. La personne qui s\'occupe du site peut la restaurer en ligne de commande (voir le README du site, « Sauvegardes »).' })
    }
    text += decoder.decode(value, { stream: true })
  }
  text += decoder.decode()
  try { return assembleBackup(text.split('\n')) }
  catch (e) { throw createError({ statusCode: 422, message: (e as Error).message }) }
}

/** Les clés des fichiers présents dans le stockage de la médiathèque ; null s'il y en a trop pour les compter ici. */
async function mediaKeys(event: H3Event) {
  const bucket = usePlatform().mediaBucket(event)
  if (!bucket.list) return null
  const keys = new Set<string>()
  let cursor: string | undefined
  for (let page = 0; page < 30; page++) {
    const listed = await bucket.list({ cursor })
    for (const o of listed.objects) keys.add(o.key)
    if (!listed.truncated) return keys
    cursor = listed.cursor
  }
  return null
}

export type RestoreResult = {
  /** Sauvegarde restaurée et sauvegarde de l'état précédent, faite juste avant. */
  restored: string
  safety: string
  rows: number
  tables: Record<string, number>
  /** Fichiers de la médiathèque dont la fiche est revenue mais dont le fichier n'existe plus. */
  missingFiles: string[]
  notes: string[]
}

/**
 * Remet les contenus et les réglages du site dans l'état d'une sauvegarde.
 *
 * - L'état actuel est sauvegardé juste avant : une restauration se défait en restaurant cette sauvegarde-là.
 * - Tout se fait dans une seule transaction (`batch`) : la restauration réussit en entier ou ne change rien.
 * - Les comptes ne sont pas touchés (voir `isKeptOnRestore`) : la personne qui restaure reste connectée, personne
 *   ne perd son accès, les comptes créés depuis restent.
 * - La médiathèque est complétée, pas remplacée (voir `MERGED_ON_RESTORE`).
 */
export async function restoreBackup(event: H3Event, name: string): Promise<RestoreResult> {
  const d1 = d1Of(event)
  const { object } = await openBackup(event, name)
  const backup = await readBackup(object.body)
  const secret = siteSecret(event)

  const safety = await runBackup(event, { kind: 'pre-restore' })
  if (!safety.ok) throw createError({ statusCode: 500, message: `Restauration annulée : l'état actuel n'a pas pu être sauvegardé avant (${safety.error}) Rien n'a été modifié.` })

  const { tables: current } = await readSchema(d1)
  const notes: string[] = []
  const statements: Statement[] = [{ sql: 'PRAGMA defer_foreign_keys = on', params: [] }]
  const inserts: Statement[] = []
  const restored: TableInfo[] = []
  const counts: Record<string, number> = {}
  let mediaRows: { key: string; name: string }[] = []

  for (const saved of backup.tables) {
    if (!isBackupTable(saved.table) || isKeptOnRestore(saved.table)) continue
    const table = current.find(t => t.table === saved.table)
    if (!table) { notes.push(`La table « ${saved.table} » n'existe plus dans cette version du back-office : elle n'a pas été restaurée.`); continue }
    const kept = saved.columns.map((c, i) => ({ c, i })).filter(x => table.columns.some(t => t.name === x.c.name))
    const merged = MERGED_ON_RESTORE.includes(saved.table)
    const keyIndex = saved.table === 'cms_settings' ? saved.columns.findIndex(c => c.name === 'key') : -1
    const rows: unknown[][] = []
    for (const row of saved.rows) {
      if (keyIndex >= 0 && row[keyIndex] === STATE_KEY) continue
      const values: unknown[] = []
      for (const { c, i } of kept) {
        let value: unknown = row[i]!
        if (isSealed(value as BackupValue)) {
          const plain = await decryptSecret(secret, (value as { $sealed: string }).$sealed)
          value = plain === null ? (c.notnull ? '' : null) : JSON.parse(plain) as BackupValue
        }
        if (value !== null && isBlob(value as BackupValue)) value = fromBase64((value as { $blob: string }).$blob).buffer
        values.push(value)
      }
      rows.push(values)
    }
    if (!merged) statements.push(keyIndex >= 0 ? { sql: `DELETE FROM ${q(saved.table)} WHERE "key" != ?`, params: [STATE_KEY] } : { sql: `DELETE FROM ${q(saved.table)}`, params: [] })
    inserts.push(...insertStatements(saved.table, kept.map(x => x.c.name), rows, { replace: merged }))
    restored.push(table)
    counts[saved.table] = rows.length
    if (saved.table === 'cms_media') {
      const key = saved.columns.findIndex(c => c.name === 'key'), label = saved.columns.findIndex(c => c.name === 'name')
      if (key >= 0) mediaRows = saved.rows.map(r => ({ key: String(r[key]), name: String(r[label] ?? r[key]) }))
    }
  }
  if (!restored.length) throw createError({ statusCode: 422, message: 'Cette sauvegarde ne contient rien qui puisse être restauré ici.' })
  // Toutes les suppressions d'abord, puis les insertions, puis le retrait de ce qui ne se rattache plus à rien.
  statements.push(...inserts, ...orphanStatements(restored.flatMap(t => t.foreignKeys)))

  try {
    await d1.batch(statements.map(s => d1.prepare(s.sql).bind(...s.params)))
  }
  catch (e) {
    console.error('[cms] restauration refusée par la base', e)
    throw createError({ statusCode: 500, message: `La restauration n'a pas pu se faire : la base l'a refusée (${((e as Error).message || 'erreur inconnue').slice(0, 200)}). Rien n'a été modifié.` })
  }

  const untouched = current.filter(t => isBackupTable(t.table) && !isKeptOnRestore(t.table) && !backup.tables.some(s => s.table === t.table)).map(t => t.table)
  if (untouched.length) notes.push(`Ajouté au back-office depuis cette sauvegarde, donc laissé tel quel : ${untouched.join(', ')}.`)
  const keys = mediaRows.length ? await mediaKeys(event).catch(() => null) : null
  const missingFiles = keys ? mediaRows.filter(m => !keys.has(m.key)).map(m => m.name) : []
  return { restored: name, safety: safety.backup.name, rows: Object.values(counts).reduce((a, b) => a + b, 0), tables: counts, missingFiles, notes }
}
