/**
 * Sauvegardes : tout ce qui se décide sans toucher à la base ni au stockage (format du fichier, nom des fichiers,
 * tables et colonnes sensibles, durée de conservation, état affiché, requêtes de restauration).
 * Utilisé par le serveur (`server/utils/backup.ts`) et par l'outil en ligne de commande (`cli/export.ts`).
 *
 * Une sauvegarde est un seul fichier texte compressé (gzip), une valeur JSON par ligne :
 *
 *   {"format":"backoffice-sauvegarde","version":1,"createdAt":"…","kind":"auto",…}     ← en-tête
 *   {"table":"cms_entries","columns":[{"name":"id","type":"TEXT","notnull":true,"pk":1},…],"sql":"CREATE TABLE …"}
 *   ["a1b2","services",0,"{…}",…]                                                        ← une ligne de la table
 *   …
 *   {"end":true,"rows":1234,"tables":{"cms_entries":12,…}}                               ← fin : le fichier est complet
 *
 * Les valeurs sont celles de SQLite, telles quelles (texte, nombre, null). Deux exceptions, écrites comme des objets :
 * `{"$sealed":"…"}` pour une valeur sensible, chiffrée avec le secret du site, et `{"$blob":"…"}` pour des octets (base64).
 */

export const BACKUP_FORMAT = 'backoffice-sauvegarde'
export const BACKUP_VERSION = 1
/** Dossier des sauvegardes dans le bucket. Le site ne sert jamais ce qui s'y trouve (voir `isPrivateKey`). */
export const BACKUP_PREFIX = '_sauvegardes/'
/** Mot à saisir pour confirmer une restauration. */
export const RESTORE_WORD = 'RESTAURER'
/** Durée de conservation par défaut, en jours. */
export const DEFAULT_RETENTION_DAYS = 30
/** Quelle que soit leur date, les sauvegardes les plus récentes ne sont jamais effacées. */
export const KEEP_AT_LEAST = 3
/** Au-delà de ce délai sans sauvegarde automatique réussie, le back-office alerte. */
export const LATE_AFTER_MS = 48 * 3600_000
/** Taille (décompressée) au-delà de laquelle une sauvegarde ne se restaure plus depuis le back-office. */
export const MAX_RESTORE_BYTES = 25 * 1024 * 1024

/** `auto` : chaque nuit ; `manual` : bouton « Sauvegarder maintenant » ; `pre-restore` : faite juste avant une restauration. */
export type BackupKind = 'auto' | 'manual' | 'pre-restore'
export const BACKUP_KIND_LABELS: Record<BackupKind, string> = { 'auto': 'Automatique', 'manual': 'Manuelle', 'pre-restore': 'Avant restauration' }

// ───────────── Nom des fichiers ─────────────

const NAME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})Z_(auto|manual|pre-restore)_([a-z0-9]{6})\.ndjson\.gz$/

/** Nom du fichier d'une sauvegarde : sa date (UTC), son origine, quelques caractères au hasard. Les noms se trient par date. */
export function backupName(date: Date, kind: BackupKind, random: string) {
  return `${date.toISOString().slice(0, 19).replace(/:/g, '-')}Z_${kind}_${random}.ndjson.gz`
}

/** Date et origine d'une sauvegarde d'après son nom ; null si ce n'est pas un nom de sauvegarde. */
export function parseBackupName(name: string): { createdAt: Date; kind: BackupKind } | null {
  const m = NAME.exec(name)
  if (!m) return null
  const createdAt = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`)
  return Number.isNaN(createdAt.getTime()) ? null : { createdAt, kind: m[7] as BackupKind }
}

/** Une clé du bucket que le site ne doit jamais servir : les sauvegardes. */
export const isPrivateKey = (key: string) => key.replace(/^\/+/, '').startsWith(BACKUP_PREFIX)

// ───────────── Ce qui est sauvegardé, protégé, restauré ─────────────

/**
 * Tables laissées hors des sauvegardes : elles ne servent pas à reconstruire le site et contiennent de quoi entrer.
 * - `session` : les connexions en cours (un jeton de session suffit à se faire passer pour quelqu'un) ;
 * - `verification`, `cms_invites` : liens à usage unique, valables quelques jours ;
 * - `cms_rate_limits` : compteurs de tentatives de connexion ;
 * - `d1_migrations` : tenue par wrangler (la liste des migrations appliquées est notée dans l'en-tête).
 */
export const EXCLUDED_TABLES = ['session', 'verification', 'cms_invites', 'cms_rate_limits', 'd1_migrations']

/** Toute table présente dans la base est sauvegardée, sauf celles de la liste ci-dessus et les tables internes. */
export const isBackupTable = (name: string) =>
  !name.startsWith('sqlite_') && !name.startsWith('_cf_') && !EXCLUDED_TABLES.includes(name)

/** Colonnes dont le nom évoque un secret mais qui n'en sont pas un lisible : déjà chiffrées avec le secret du site. */
const NOT_SEALED = ['cms_module_settings.secrets']

/**
 * Une colonne sensible est chiffrée dans la sauvegarde avec le secret du site (NUXT_AUTH_SECRET) : mots de passe
 * (même hachés), jetons, codes de secours, clés. La règle porte sur le nom de la colonne pour couvrir aussi les
 * tables ajoutées plus tard. Ne sont pas concernées : les empreintes (`_hash`) et les dates (`_at`).
 */
export function isSealedColumn(table: string, column: string) {
  if (NOT_SEALED.includes(`${table}.${column}`)) return false
  if (/_(hash|at)$/i.test(column)) return false
  return /password|secret|token|backup_?codes|api_?key|private_?key/i.test(column)
}

/**
 * Tables que la restauration depuis le back-office ne touche pas.
 * - Les comptes : chacun garde son accès, son mot de passe et son rôle d'aujourd'hui ; les comptes créés depuis la
 *   sauvegarde restent. Les tables de Better Auth n'ont pas le préfixe `cms_`.
 * - Ce qui s'est réellement passé et ne doit pas être effacé en revenant en arrière : le journal d'activité,
 *   le journal des workflows, les paiements reçus (pièces comptables) et les messages envoyés par les visiteurs.
 */
const KEPT_ON_RESTORE = ['cms_user_access', 'cms_roles', 'cms_invites', 'cms_activity', 'cms_workflow_runs', 'cms_payments', 'cms_form_submissions']
export const isKeptOnRestore = (table: string) => !table.startsWith('cms_') || KEPT_ON_RESTORE.includes(table)

/**
 * Tables complétées plutôt que remplacées : la médiathèque. Les fichiers envoyés depuis la sauvegarde restent
 * visibles (leurs objets sont toujours dans le stockage) ; ceux de la sauvegarde retrouvent leur fiche.
 */
export const MERGED_ON_RESTORE = ['cms_media', 'cms_media_folders']

/** Réglage où le back-office note l'état des sauvegardes : une restauration ne le ramène pas en arrière. */
export const STATE_KEY = 'backup.state'

// ───────────── Format ─────────────

export type BackupColumn = { name: string; type: string; notnull: boolean; pk: number }
export type BackupHeader = {
  format: typeof BACKUP_FORMAT
  version: number
  createdAt: string
  kind: BackupKind
  site: { name: string; url: string | null }
  /** Version du core qui a écrit la sauvegarde. */
  core: string
  /** Migrations de la base appliquées à ce moment-là. */
  migrations: string[]
  /** Tables laissées de côté (voir EXCLUDED_TABLES). */
  excluded: string[]
  /** Comment les valeurs sensibles sont protégées. */
  sealed: string
}
export type BackupValue = string | number | null | { $sealed: string } | { $blob: string }
export type BackupLine =
  | { type: 'header'; header: BackupHeader }
  | { type: 'table'; table: string; columns: BackupColumn[]; sql: string }
  | { type: 'row'; values: BackupValue[] }
  | { type: 'end'; rows: number; tables: Record<string, number> }

const toBase64 = (bytes: Uint8Array) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s) }
export const fromBase64 = (text: string) => Uint8Array.from(atob(text), c => c.charCodeAt(0))

/** Une valeur lue dans la base, telle qu'elle s'écrit dans le fichier. Les octets (BLOB) passent en base64. */
export function encodeValue(value: unknown): BackupValue {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'bigint') return Number(value)
  if (value instanceof ArrayBuffer) return { $blob: toBase64(new Uint8Array(value)) }
  if (ArrayBuffer.isView(value)) return { $blob: toBase64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) }
  if (Array.isArray(value)) return { $blob: toBase64(Uint8Array.from(value as number[])) }
  return JSON.stringify(value)
}

export const isSealed = (value: BackupValue): value is { $sealed: string } => typeof value === 'object' && value !== null && '$sealed' in value
export const isBlob = (value: BackupValue): value is { $blob: string } => typeof value === 'object' && value !== null && '$blob' in value

export const headerLine = (header: BackupHeader) => JSON.stringify(header)
export const tableLine = (table: string, columns: BackupColumn[], sql: string) => JSON.stringify({ table, columns, sql })
export const rowLine = (values: BackupValue[]) => JSON.stringify(values)
export const endLine = (tables: Record<string, number>) =>
  JSON.stringify({ end: true, rows: Object.values(tables).reduce((a, b) => a + b, 0), tables })

/** Lit une ligne du fichier. Lève une erreur si elle n'est pas comprise : un fichier abîmé ne se restaure pas à moitié. */
export function parseLine(line: string): BackupLine {
  let value: any
  try { value = JSON.parse(line) }
  catch { throw new Error('Le fichier de sauvegarde est abîmé (ligne illisible).') }
  if (Array.isArray(value)) return { type: 'row', values: value }
  if (value?.format === BACKUP_FORMAT) {
    if (value.version !== BACKUP_VERSION) throw new Error(`Cette sauvegarde est dans un format plus récent (version ${value.version}) : mettez le back-office à jour pour la lire.`)
    return { type: 'header', header: value }
  }
  if (typeof value?.table === 'string' && Array.isArray(value.columns)) return { type: 'table', table: value.table, columns: value.columns, sql: String(value.sql ?? '') }
  if (value?.end === true) return { type: 'end', rows: Number(value.rows) || 0, tables: value.tables ?? {} }
  throw new Error('Le fichier de sauvegarde est abîmé (ligne inattendue).')
}

export type ParsedBackup = { header: BackupHeader; tables: { table: string; columns: BackupColumn[]; sql: string; rows: BackupValue[][] }[] }

/** Assemble les lignes d'un fichier. Refuse un fichier sans en-tête, incomplet, ou dont le compte de lignes ne tombe pas juste. */
export function assembleBackup(lines: Iterable<string>): ParsedBackup {
  let header: BackupHeader | undefined
  let ended = false
  const tables: ParsedBackup['tables'] = []
  for (const text of lines) {
    if (!text.trim()) continue
    if (ended) throw new Error('Le fichier de sauvegarde est abîmé (contenu après la fin).')
    // La première ligne dit si le fichier est bien une sauvegarde : tout autre contenu est refusé d'emblée.
    if (!header && !text.includes(`"format":"${BACKUP_FORMAT}"`)) throw new Error('Ce fichier n\'est pas une sauvegarde du back-office.')
    const line = parseLine(text)
    if (line.type === 'header') header = line.header
    else if (!header) throw new Error('Ce fichier n\'est pas une sauvegarde du back-office.')
    else if (line.type === 'table') tables.push({ table: line.table, columns: line.columns, sql: line.sql, rows: [] })
    else if (line.type === 'row') {
      const current = tables.at(-1)
      if (!current || line.values.length !== current.columns.length) throw new Error('Le fichier de sauvegarde est abîmé (ligne hors table).')
      current.rows.push(line.values)
    }
    else {
      for (const t of tables) if ((line.tables[t.table] ?? -1) !== t.rows.length) throw new Error(`Le fichier de sauvegarde est incomplet (table ${t.table}).`)
      ended = true
    }
  }
  if (!header) throw new Error('Ce fichier n\'est pas une sauvegarde du back-office.')
  if (!ended) throw new Error('Le fichier de sauvegarde est incomplet : il s\'arrête avant la fin.')
  return { header, tables }
}

// ───────────── Conservation ─────────────

/**
 * Sauvegardes à effacer : celles qui ont dépassé la durée de conservation, sauf les `keep` plus récentes,
 * gardées quoi qu'il arrive (un site sans sauvegarde récente garde ainsi toujours de quoi revenir en arrière).
 */
export function expiredBackups<T extends { name: string; createdAt: Date }>(items: T[], now: Date, retentionDays: number, keep = KEEP_AT_LEAST): T[] {
  const limit = now.getTime() - retentionDays * 86400_000
  return [...items].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(keep).filter(i => i.createdAt.getTime() < limit)
}

/** Durée de conservation réglée par le développeur : un nombre entier de jours, entre 1 et 3650 ; sinon la valeur par défaut. */
export function retentionDays(setting: unknown) {
  const n = Number(setting)
  return Number.isInteger(n) && n >= 1 && n <= 3650 ? n : DEFAULT_RETENTION_DAYS
}

// ───────────── État affiché ─────────────

export type BackupFailure = { at: string; kind: BackupKind; error: string }
export type BackupState = {
  /** Première fois que le back-office s'est occupé des sauvegardes sur ce site. */
  since?: string
  lastAutoSuccessAt?: string
  lastAutoAttemptAt?: string
  /** Dernier passage du déclencheur planifié de Cloudflare. */
  cronSeenAt?: string
  /** Les dix derniers échecs. */
  failures?: BackupFailure[]
}

export type BackupStatus = {
  level: 'ok' | 'warning' | 'error'
  code: 'ok' | 'never' | 'late' | 'failed'
  title: string
  message: string
  /** Le déclencheur planifié ne tourne pas : les sauvegardes dépendent des visites d'un administrateur. */
  cronMissing: boolean
}

const when = (date: Date) => date.toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' })

/** L'état des sauvegardes automatiques, en mots simples. `lastAuto` : date de la dernière sauvegarde automatique présente. */
export function backupStatus(input: { now: Date; lastAuto: Date | null; state: BackupState }): BackupStatus {
  const { now, lastAuto, state } = input
  const failure = (state.failures ?? []).filter(f => f.kind === 'auto').at(-1)
  const cronSeen = state.cronSeenAt ? new Date(state.cronSeenAt).getTime() : 0
  const since = state.since ? new Date(state.since).getTime() : now.getTime()
  const cronMissing = now.getTime() - cronSeen > LATE_AFTER_MS && now.getTime() - since > LATE_AFTER_MS
  const base = { cronMissing }
  if (failure && (!lastAuto || new Date(failure.at) > lastAuto)) {
    return { ...base, level: 'error', code: 'failed', title: 'La dernière sauvegarde automatique a échoué',
      message: `Tentative du ${when(new Date(failure.at))} : ${failure.error} ${lastAuto ? `La dernière sauvegarde automatique réussie date du ${when(lastAuto)}.` : 'Aucune sauvegarde automatique n\'a encore réussi.'} Lancez « Sauvegarder maintenant » et prévenez la personne qui s'occupe du site.` }
  }
  if (!lastAuto) {
    return { ...base, level: 'warning', code: 'never', title: 'Aucune sauvegarde automatique pour l\'instant',
      message: 'La première se fait dans la nuit qui suit la mise en ligne. Vous pouvez en lancer une tout de suite avec « Sauvegarder maintenant ».' }
  }
  if (now.getTime() - lastAuto.getTime() > LATE_AFTER_MS) {
    return { ...base, level: 'error', code: 'late', title: 'Les sauvegardes automatiques sont en retard',
      message: `La dernière date du ${when(lastAuto)}, il y a plus de 48 heures. Lancez « Sauvegarder maintenant » et prévenez la personne qui s'occupe du site.` }
  }
  return { ...base, level: 'ok', code: 'ok', title: cronMissing ? 'Le site est sauvegardé' : 'Le site est sauvegardé chaque jour', message: `Dernière sauvegarde automatique : ${when(lastAuto)}.` }
}

/** Ajoute un échec à la liste, limitée aux dix derniers ; le message est raccourci. */
export function withFailure(state: BackupState, failure: BackupFailure): BackupState {
  return { ...state, failures: [...(state.failures ?? []), { ...failure, error: failure.error.slice(0, 300) }].slice(-10) }
}

// ───────────── Restauration : requêtes ─────────────

export type Statement = { sql: string; params: unknown[] }
const q = (name: string) => `"${name.replace(/"/g, '""')}"`

/**
 * Requêtes d'insertion d'une table, plusieurs lignes par requête sans dépasser `maxParams` valeurs
 * (D1 accepte 100 valeurs par requête). `replace` : une ligne déjà présente (même clé) est remplacée.
 */
export function insertStatements(table: string, columns: string[], rows: unknown[][], options: { replace?: boolean; maxParams?: number } = {}): Statement[] {
  if (!columns.length || !rows.length) return []
  const perStatement = Math.max(1, Math.floor((options.maxParams ?? 100) / columns.length))
  const head = `INSERT ${options.replace ? 'OR REPLACE ' : ''}INTO ${q(table)} (${columns.map(q).join(', ')}) VALUES `
  const tuple = `(${columns.map(() => '?').join(', ')})`
  const out: Statement[] = []
  for (let i = 0; i < rows.length; i += perStatement) {
    const slice = rows.slice(i, i + perStatement)
    out.push({ sql: head + slice.map(() => tuple).join(', '), params: slice.flat() })
  }
  return out
}

export type ForeignKey = { table: string; from: string; parent: string; to: string; nullable: boolean }

/**
 * Après une restauration, des lignes peuvent désigner quelque chose qui n'existe plus (un lien d'aperçu créé par un
 * compte supprimé depuis, un fichier rangé dans un dossier disparu). Ces requêtes les retirent, ou vident la
 * référence quand elle est facultative, pour que la base reste cohérente.
 */
export function orphanStatements(keys: ForeignKey[]): Statement[] {
  return keys.map((k) => {
    const missing = `${q(k.from)} IS NOT NULL AND ${q(k.from)} NOT IN (SELECT ${q(k.to)} FROM ${q(k.parent)} WHERE ${q(k.to)} IS NOT NULL)`
    return { sql: k.nullable ? `UPDATE ${q(k.table)} SET ${q(k.from)} = NULL WHERE ${missing}` : `DELETE FROM ${q(k.table)} WHERE ${missing}`, params: [] }
  })
}

// ───────────── Fichier SQL (outil en ligne de commande) ─────────────

/** Longueur maximale d'une requête SQL dans D1 : 100 000 octets. On reste nettement en dessous. */
const MAX_STATEMENT = 80_000
/** Morceaux d'un long texte : 20 000 caractères font au plus 60 000 octets. */
const TEXT_CHUNK = 20_000
/** Dans une ligne trop longue, tout texte plus long que cela est posé en plusieurs fois. */
const LONG_TEXT = 2_000
const bytes = (text: string) => (text.length * 3 < MAX_STATEMENT ? text.length : new TextEncoder().encode(text).length)

/** Une valeur écrite dans une requête SQL. */
export function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  if (value instanceof Uint8Array) return `X'${[...value].map(b => b.toString(16).padStart(2, '0')).join('')}'`
  return `'${String(value).replace(/'/g, '\'\'')}'`
}

/** Coupe un texte en morceaux sans séparer les deux moitiés d'un caractère hors du plan de base (émojis). */
export function chunkText(text: string, size = TEXT_CHUNK): string[] {
  const out: string[] = []
  for (let i = 0; i < text.length;) {
    let end = Math.min(text.length, i + size)
    const code = text.charCodeAt(end - 1)
    if (end < text.length && code >= 0xD800 && code <= 0xDBFF) end--
    out.push(text.slice(i, end))
    i = end
  }
  return out
}

/**
 * Requêtes SQL qui recréent les lignes d'une table, pour `wrangler d1 execute --file`.
 * Une ligne trop longue pour une seule requête (un long texte) est insérée avec le début du texte, puis complétée
 * morceau par morceau ; il faut pour cela que la table ait une clé primaire.
 */
export function sqlDump(table: string, columns: BackupColumn[], rows: unknown[][]): string[] {
  const names = columns.map(c => q(c.name))
  const head = `INSERT INTO ${q(table)} (${names.join(', ')}) VALUES `
  const pk = columns.map((c, i) => ({ c, i })).filter(x => x.c.pk > 0)
  const out: string[] = []
  let pending: string[] = []
  let size = 0
  const flush = () => { if (pending.length) out.push(`${head}${pending.join(', ')};`); pending = []; size = 0 }
  for (const row of rows) {
    const tuple = `(${row.map(sqlLiteral).join(', ')})`
    const length = bytes(tuple)
    if (head.length + length <= MAX_STATEMENT || !pk.length) {
      if (size + length > MAX_STATEMENT - head.length) flush()
      pending.push(tuple)
      size += length + 2
      continue
    }
    flush()
    // Ligne trop longue : les longs textes sont posés en plusieurs fois.
    const rest: { column: string; chunks: string[] }[] = []
    const first = row.map((value, i) => {
      if (typeof value !== 'string' || value.length <= LONG_TEXT || columns[i]!.pk > 0) return value
      const start = chunkText(value, LONG_TEXT)[0]!
      rest.push({ column: names[i]!, chunks: chunkText(value.slice(start.length)) })
      return start
    })
    out.push(`${head}(${first.map(sqlLiteral).join(', ')});`)
    const where = pk.map(x => `${q(x.c.name)} = ${sqlLiteral(row[x.i])}`).join(' AND ')
    for (const { column, chunks } of rest)
      for (const chunk of chunks) out.push(`UPDATE ${q(table)} SET ${column} = ${column} || ${sqlLiteral(chunk)} WHERE ${where};`)
  }
  flush()
  return out
}

/**
 * Ordre dans lequel recréer les tables : une table vient après celles qu'elle désigne (`REFERENCES`), pour que
 * chaque ligne trouve déjà en place ce à quoi elle se rattache. Les liens sont lus dans le `CREATE TABLE` gardé
 * dans la sauvegarde. Un cycle éventuel est laissé dans l'ordre d'origine.
 */
export function creationOrder<T extends { table: string; sql: string }>(tables: T[]): T[] {
  const names = new Set(tables.map(t => t.table))
  const parents = new Map(tables.map(t => [t.table, [...t.sql.matchAll(/REFERENCES\s+[`"'[]?(\w+)/gi)].map(m => m[1]!).filter(p => p !== t.table && names.has(p))]))
  const out: T[] = []
  const state = new Map<string, 'visiting' | 'done'>()
  const visit = (t: T) => {
    if (state.has(t.table)) return
    state.set(t.table, 'visiting')
    for (const parent of parents.get(t.table) ?? []) {
      if (state.get(parent) !== 'visiting') visit(tables.find(x => x.table === parent)!)
    }
    state.set(t.table, 'done')
    out.push(t)
  }
  tables.forEach(visit)
  return out
}

/** Taille lisible : « 12 Ko », « 3,4 Mo ». */
export function formatBackupSize(size: number) {
  if (size < 1024) return `${size} o`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} Ko`
  return `${(size / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`
}
