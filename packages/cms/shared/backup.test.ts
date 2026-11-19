import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  type BackupColumn, BACKUP_PREFIX, assembleBackup, backupName, backupStatus, chunkText, creationOrder, encodeValue, endLine, expiredBackups, headerLine,
  insertStatements, isBackupTable, isKeptOnRestore, isPrivateKey, isSealedColumn, orphanStatements, parseBackupName, parseLine, retentionDays,
  rowLine, sqlDump, sqlLiteral, tableLine, withFailure,
} from './backup'

const day = 86400_000
const now = new Date('2026-11-20T10:00:00Z')
const ago = (ms: number) => new Date(now.getTime() - ms)

test('nom d\'une sauvegarde : daté, trié par date, relu à l\'identique', () => {
  const name = backupName(new Date('2026-11-20T03:17:05.123Z'), 'auto', 'ab12cd')
  assert.equal(name, '2026-11-20T03-17-05Z_auto_ab12cd.ndjson.gz')
  assert.deepEqual(parseBackupName(name), { createdAt: new Date('2026-11-20T03:17:05Z'), kind: 'auto' })
  assert.equal(parseBackupName(backupName(now, 'pre-restore', 'zzzzzz'))?.kind, 'pre-restore')
  assert.ok(backupName(ago(day), 'manual', 'zzzzzz') < backupName(now, 'auto', 'aaaaaa'))
})

test('un nom qui n\'est pas celui d\'une sauvegarde est refusé (pas de chemin détourné)', () => {
  for (const name of ['', 'x.gz', '../2026-11-20T03-17-05Z_auto_ab12cd.ndjson.gz', '2026-11-20T03-17-05Z_auto_ab12cd.ndjson.gz/../x',
    '2026-11-20T03-17-05Z_autre_ab12cd.ndjson.gz', '2026-13-45T03-17-05Z_auto_ab12cd.ndjson.gz', '2026-11-20T03-17-05Z_auto_AB12CD.ndjson.gz'])
    assert.equal(parseBackupName(name), null, name)
})

test('le dossier des sauvegardes n\'est jamais servi comme un fichier de la médiathèque', () => {
  assert.ok(isPrivateKey(`${BACKUP_PREFIX}2026-11-20T03-17-05Z_auto_ab12cd.ndjson.gz`))
  assert.ok(isPrivateKey(`/${BACKUP_PREFIX}x`))
  assert.ok(!isPrivateKey('a1b2c3/photo.png'))
  assert.ok(!isPrivateKey('a1b2c3/_sauvegardes/photo.png'))
})

test('tables : tout est sauvegardé, sauf les connexions, les liens à usage unique et les tables internes', () => {
  for (const t of ['cms_entries', 'cms_media', 'user', 'account', 'cms_payments', 'cms_une_table_ajoutee_plus_tard', 'two_factor']) assert.ok(isBackupTable(t), t)
  for (const t of ['session', 'verification', 'cms_invites', 'cms_rate_limits', 'd1_migrations', 'sqlite_sequence', '_cf_KV']) assert.ok(!isBackupTable(t), t)
})

test('colonnes sensibles : chiffrées d\'après leur nom, y compris dans une table inconnue', () => {
  for (const [t, c] of [['account', 'password'], ['account', 'access_token'], ['account', 'refresh_token'], ['account', 'id_token'],
    ['two_factor', 'secret'], ['two_factor', 'backup_codes'], ['cms_autre', 'api_key'], ['cms_autre', 'apiKey']] as const)
    assert.ok(isSealedColumn(t, c), `${t}.${c}`)
  for (const [t, c] of [['account', 'access_token_expires_at'], ['cms_preview_links', 'token_hash'], ['cms_module_settings', 'secrets'],
    ['user', 'email'], ['cms_entries', 'shared_draft'], ['cms_payments', 'session_id']] as const)
    assert.ok(!isSealedColumn(t, c), `${t}.${c}`)
})

test('restauration : les comptes ne sont pas touchés, les contenus et réglages le sont', () => {
  for (const t of ['user', 'account', 'session', 'two_factor', 'cms_user_access', 'cms_roles', 'cms_invites']) assert.ok(isKeptOnRestore(t), t)
  for (const t of ['cms_entries', 'cms_entry_locales', 'cms_media', 'cms_settings', 'cms_workflows', 'cms_form_submissions', 'cms_payments']) assert.ok(!isKeptOnRestore(t), t)
})

test('valeurs : texte et nombres tels quels, octets en base64', () => {
  assert.equal(encodeValue('é"\n'), 'é"\n')
  assert.equal(encodeValue(12.5), 12.5)
  assert.equal(encodeValue(null), null)
  assert.equal(encodeValue(undefined), null)
  assert.equal(encodeValue(true), 1)
  assert.deepEqual(encodeValue(new Uint8Array([1, 2, 255])), { $blob: 'AQL/' })
  assert.deepEqual(encodeValue([1, 2, 255]), { $blob: 'AQL/' })
})

const columns: BackupColumn[] = [{ name: 'id', type: 'TEXT', notnull: true, pk: 1 }, { name: 'body', type: 'TEXT', notnull: false, pk: 0 }]
const header = { format: 'backoffice-sauvegarde' as const, version: 1, createdAt: now.toISOString(), kind: 'auto' as const, site: { name: 'Site', url: null }, core: '0.5.0', migrations: [], excluded: [], sealed: '' }
const file = () => [headerLine(header), tableLine('cms_a', columns, 'CREATE TABLE cms_a (…)'), rowLine(['1', 'un\ndeux']), rowLine(['2', null]), tableLine('cms_b', columns, ''), endLine({ cms_a: 2, cms_b: 0 })]

test('format : un fichier écrit se relit à l\'identique', () => {
  const read = assembleBackup(file())
  assert.equal(read.header.kind, 'auto')
  assert.deepEqual(read.tables.map(t => [t.table, t.rows]), [['cms_a', [['1', 'un\ndeux'], ['2', null]]], ['cms_b', []]])
  assert.deepEqual(parseLine(endLine({ a: 2, b: 3 })), { type: 'end', rows: 5, tables: { a: 2, b: 3 } })
})

test('format : un fichier tronqué, abîmé ou étranger est refusé', () => {
  assert.throws(() => assembleBackup(file().slice(0, -1)), /incomplet/)
  assert.throws(() => assembleBackup(file().filter((_, i) => i !== 2)), /incomplet \(table cms_a\)/)
  assert.throws(() => assembleBackup(['{"autre":1}']), /pas une sauvegarde/)
  assert.throws(() => assembleBackup([file()[0]!, '{"table"']), /abîmé/)
  assert.throws(() => assembleBackup([file()[0]!, rowLine(['1'])]), /hors table/)
  assert.throws(() => assembleBackup([headerLine({ ...header, version: 2 })]), /plus récent/)
})

test('conservation : les sauvegardes trop anciennes s\'effacent, sauf les trois plus récentes', () => {
  const items = [1, 2, 10, 31, 45, 90].map(d => ({ name: `j-${d}`, createdAt: ago(d * day) }))
  assert.deepEqual(expiredBackups(items, now, 30).map(i => i.name), ['j-31', 'j-45', 'j-90'])
  assert.deepEqual(expiredBackups(items, now, 7).map(i => i.name), ['j-31', 'j-45', 'j-90'])
  assert.deepEqual(expiredBackups(items, now, 1).map(i => i.name), ['j-31', 'j-45', 'j-90'])
  // Un site abandonné quelque temps garde toujours ses trois dernières sauvegardes.
  assert.deepEqual(expiredBackups(items.slice(3), now, 30).map(i => i.name), [])
  assert.deepEqual(expiredBackups(items.slice(2), now, 30).map(i => i.name), ['j-90'])
  assert.deepEqual(expiredBackups([], now, 30), [])
})

test('durée de conservation : un réglage invalide revient à 30 jours', () => {
  assert.equal(retentionDays('45'), 45)
  assert.equal(retentionDays(7), 7)
  for (const bad of [undefined, '', 'abc', 0, -3, 1.5, 100000]) assert.equal(retentionDays(bad), 30)
})

test('état : à jour, jamais faite, en retard de plus de 48 h, échec', () => {
  const state = { since: ago(10 * day).toISOString(), cronSeenAt: ago(3600_000).toISOString() }
  assert.equal(backupStatus({ now, lastAuto: ago(7 * 3600_000), state }).code, 'ok')
  assert.equal(backupStatus({ now, lastAuto: ago(47 * 3600_000), state }).level, 'ok')
  const late = backupStatus({ now, lastAuto: ago(49 * 3600_000), state })
  assert.deepEqual([late.code, late.level], ['late', 'error'])
  assert.deepEqual([backupStatus({ now, lastAuto: null, state: {} }).code, backupStatus({ now, lastAuto: null, state: {} }).level], ['never', 'warning'])

  const failure = { at: ago(3600_000).toISOString(), kind: 'auto' as const, error: 'Le stockage n\'a pas répondu.' }
  const failed = backupStatus({ now, lastAuto: ago(26 * 3600_000), state: { ...state, failures: [failure] } })
  assert.deepEqual([failed.code, failed.level], ['failed', 'error'])
  assert.match(failed.message, /Le stockage n'a pas répondu\./)
  // Une réussite plus récente que l'échec lève l'alerte ; l'échec d'une sauvegarde manuelle ne la déclenche pas.
  assert.equal(backupStatus({ now, lastAuto: ago(60_000), state: { ...state, failures: [failure] } }).code, 'ok')
  assert.equal(backupStatus({ now, lastAuto: ago(3 * 3600_000), state: { ...state, failures: [{ ...failure, kind: 'manual' }] } }).code, 'ok')
})

test('état : le déclencheur planifié absent est signalé après deux jours, pas le premier jour', () => {
  const lastAuto = ago(3600_000)
  assert.equal(backupStatus({ now, lastAuto, state: { since: ago(3600_000).toISOString() } }).cronMissing, false)
  assert.equal(backupStatus({ now, lastAuto, state: { since: ago(5 * day).toISOString() } }).cronMissing, true)
  assert.equal(backupStatus({ now, lastAuto, state: { since: ago(5 * day).toISOString(), cronSeenAt: ago(3 * day).toISOString() } }).cronMissing, true)
  assert.equal(backupStatus({ now, lastAuto, state: { since: ago(5 * day).toISOString(), cronSeenAt: ago(7 * 3600_000).toISOString() } }).cronMissing, false)
})

test('échecs : dix au plus, message raccourci', () => {
  let state = {}
  for (let i = 0; i < 12; i++) state = withFailure(state, { at: `t${i}`, kind: 'auto', error: 'x'.repeat(1000) })
  const { failures } = state as { failures: { at: string; error: string }[] }
  assert.equal(failures.length, 10)
  assert.equal(failures[0]!.at, 't2')
  assert.equal(failures[9]!.error.length, 300)
})

test('insertions : plusieurs lignes par requête, jamais plus de 100 valeurs', () => {
  const rows = Array.from({ length: 25 }, (_, i) => [i, 'a', 'b', 'c', 'd', 'e', 'f'])
  const statements = insertStatements('cms_a', ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'], rows)
  assert.deepEqual(statements.map(s => s.params.length), [98, 77])
  assert.ok(statements.every(s => s.params.length <= 100 && (s.sql.match(/\?/g) ?? []).length === s.params.length))
  assert.match(statements[0]!.sql, /^INSERT INTO "cms_a" \("c1", "c2"/)
  assert.match(insertStatements('cms_a', ['id'], [[1]], { replace: true })[0]!.sql, /^INSERT OR REPLACE INTO/)
  assert.deepEqual(insertStatements('cms_a', ['id'], []), [])
  // Une table de 100 colonnes : une ligne par requête.
  assert.equal(insertStatements('t', Array.from({ length: 100 }, (_, i) => `c${i}`), [Array(100).fill(1), Array(100).fill(2)]).length, 2)
})

test('lignes orphelines : retirées, ou référence vidée quand elle est facultative', () => {
  const [del, upd] = orphanStatements([
    { table: 'cms_preview_links', from: 'created_by', parent: 'user', to: 'id', nullable: false },
    { table: 'cms_media', from: 'folder_id', parent: 'cms_media_folders', to: 'id', nullable: true },
  ])
  assert.equal(del!.sql, 'DELETE FROM "cms_preview_links" WHERE "created_by" IS NOT NULL AND "created_by" NOT IN (SELECT "id" FROM "user" WHERE "id" IS NOT NULL)')
  assert.match(upd!.sql, /^UPDATE "cms_media" SET "folder_id" = NULL WHERE "folder_id" IS NOT NULL AND "folder_id" NOT IN/)
})

test('fichier SQL : valeurs protégées', () => {
  assert.equal(sqlLiteral('l\'été'), '\'l\'\'été\'')
  assert.equal(sqlLiteral(null), 'NULL')
  assert.equal(sqlLiteral(12), '12')
  assert.equal(sqlLiteral(new Uint8Array([0, 255])), 'X\'00ff\'')
})

test('fichier SQL : aucune requête ne dépasse la limite de D1, les longs textes sont posés en plusieurs fois', () => {
  const long = 'é😀'.repeat(60_000) // 180 000 caractères, 360 000 octets
  const rows = [['1', 'court'], ['2', long], ['3', 'x'.repeat(30_000)], ['4', null]]
  const statements = sqlDump('cms_a', columns, rows)
  const size = (s: string) => new TextEncoder().encode(s).length
  assert.ok(statements.every(s => size(s) < 100_000), `la plus longue : ${Math.max(...statements.map(size))}`)
  assert.ok(statements.every(s => !/[\uD800-\uDBFF]'/.test(s)), 'un émoji a été coupé en deux')
  // Rejouées dans l'ordre, les requêtes redonnent exactement le texte d'origine.
  const updates = statements.filter(s => s.startsWith('UPDATE "cms_a" SET "body" = "body" || '))
  assert.ok(updates.length > 3 && updates.every(s => s.endsWith(' WHERE "id" = \'2\';')))
  const start = /VALUES \('2', '(.*)'\);$/s.exec(statements.find(s => s.includes('(\'2\','))!)![1]!
  assert.equal(start + updates.map(s => /\|\| '(.*)' WHERE/s.exec(s)![1]).join(''), long)
  assert.equal(statements.filter(s => s.startsWith('INSERT')).length, 3)
})

test('découpage d\'un texte : rien de perdu', () => {
  const text = '😀'.repeat(25)
  assert.equal(chunkText(text, 7).join(''), text)
  assert.ok(chunkText(text, 7).every(c => c.length <= 7 && c.length % 2 === 0))
})

test('ordre de recréation : une table après celles qu\'elle désigne', () => {
  const tables = [
    { table: 'account', sql: 'CREATE TABLE `account` (`user_id` text NOT NULL, FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade)' },
    { table: 'cms_entry_locales', sql: 'CREATE TABLE cms_entry_locales (entry_id text REFERENCES "cms_entries"(id))' },
    { table: 'cms_entries', sql: 'CREATE TABLE cms_entries (id text)' },
    { table: 'cms_media', sql: 'CREATE TABLE `cms_media` (`folder_id` text, FOREIGN KEY (`folder_id`) REFERENCES `cms_media_folders`(`id`))' },
    { table: 'cms_media_folders', sql: 'CREATE TABLE `cms_media_folders` (`id` text, `parent_id` text REFERENCES cms_media_folders(id))' },
    { table: 'cms_preview_links', sql: 'CREATE TABLE x (created_by text REFERENCES user(id), autre text REFERENCES table_absente(id))' },
    { table: 'user', sql: 'CREATE TABLE `user` (`id` text)' },
  ]
  const order = creationOrder(tables).map(t => t.table)
  assert.equal(order.length, tables.length)
  for (const [child, parent] of [['account', 'user'], ['cms_entry_locales', 'cms_entries'], ['cms_media', 'cms_media_folders'], ['cms_preview_links', 'user']])
    assert.ok(order.indexOf(parent!) < order.indexOf(child!), `${parent} doit précéder ${child} : ${order}`)
  // Deux tables qui se désignent l'une l'autre : aucune n'est perdue.
  assert.equal(creationOrder([{ table: 'a', sql: 'REFERENCES b(id)' }, { table: 'b', sql: 'REFERENCES a(id)' }]).length, 2)
})
