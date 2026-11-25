import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import migrations from '#cms-migrations'
import type { SqlDatabase, SqlResult, SqlStatement } from '../types'

/**
 * Base SQLite dans un fichier, pour un site hébergé sur un serveur Node. Elle se présente au core sous la forme
 * de D1 (`prepare`, `bind`, `all`, `run`, `raw`, `batch`) : même dialecte, mêmes requêtes, mêmes migrations.
 *
 * - Les migrations du core sont appliquées à l'ouverture du fichier, dans la table que tient wrangler chez
 *   Cloudflare (`d1_migrations`) : une base exportée de D1 se reprend telle quelle.
 * - `node:sqlite` est synchrone : un lot (`batch`) s'exécute d'un seul tenant, dans une transaction.
 * - Demande Node 24 ou plus récent.
 */

type Sqlite = { db: DatabaseSync; statements: Map<string, StatementSync> }

/** Requêtes préparées gardées en mémoire, par connexion. */
const MAX_STATEMENTS = 400

function toParam(value: unknown) {
  if (value === undefined) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  return value as null | number | bigint | string | Uint8Array
}

function migrate(db: DatabaseSync) {
  db.exec('CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)')
  const applied = new Set(db.prepare('SELECT name FROM d1_migrations').all().map(r => String(r.name)))
  for (const migration of migrations) {
    if (applied.has(migration.name)) continue
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(migration.sql)
      db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(migration.name)
      db.exec('COMMIT')
    }
    catch (error) {
      db.exec('ROLLBACK')
      throw new Error(`[cms] la migration ${migration.name} a échoué : la base n'a pas été modifiée par elle.`, { cause: error })
    }
    console.info(`[cms] base de données : migration ${migration.name} appliquée`)
  }
}

function open(file: string): Sqlite {
  mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  // WAL : les lectures ne bloquent pas les écritures. Les clés étrangères sont vérifiées, comme chez D1.
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON')
  migrate(db)
  return { db, statements: new Map() }
}

function prepared(sqlite: Sqlite, sql: string) {
  let statement = sqlite.statements.get(sql)
  if (!statement) {
    statement = sqlite.db.prepare(sql)
    if (sqlite.statements.size >= MAX_STATEMENTS) sqlite.statements.delete(sqlite.statements.keys().next().value!)
    sqlite.statements.set(sql, statement)
  }
  return statement
}

/** Exécute une requête. Avec `arrays`, chaque ligne est un tableau de valeurs ; sinon un objet par colonne. */
function execute(sqlite: Sqlite, sql: string, params: unknown[], arrays: boolean): { rows: unknown[]; changes: number } {
  const statement = prepared(sqlite, sql)
  const values = params as Parameters<StatementSync['run']>
  // Une requête sans colonne de résultat (écriture sans RETURNING) : seul le nombre de lignes touchées compte.
  if (!statement.columns().length) return { rows: [], changes: Number(statement.run(...values).changes) }
  statement.setReturnArrays(arrays)
  const rows = statement.all(...values)
  // Écriture avec RETURNING : une ligne rendue par ligne touchée.
  return { rows, changes: /^\s*(insert|update|delete|replace)\b/i.test(sql) ? rows.length : 0 }
}

function statementOf(sqlite: Sqlite, sql: string, params: unknown[] = []): SqlStatement & { execute: () => SqlResult } {
  const result = (): SqlResult => {
    const { rows, changes } = execute(sqlite, sql, params, false)
    return {
      results: rows as Record<string, unknown>[],
      meta: {
        changes,
        // Taille du fichier de la base, calculée seulement si on la demande.
        get size_after() {
          const one = (pragma: string) => Number(Object.values(sqlite.db.prepare(`PRAGMA ${pragma}`).get() ?? {})[0] ?? 0)
          return one('page_count') * one('page_size')
        },
      },
    }
  }
  return {
    bind: (...values) => statementOf(sqlite, sql, values.map(toParam)),
    all: async () => result(),
    run: async () => result(),
    raw: async () => execute(sqlite, sql, params, true).rows as unknown[][],
    execute: result,
  }
}

function wrap(sqlite: Sqlite): SqlDatabase {
  return {
    prepare: sql => statementOf(sqlite, sql),
    async batch(statements) {
      sqlite.db.exec('BEGIN IMMEDIATE')
      try {
        const results = statements.map(s => (s as ReturnType<typeof statementOf>).execute())
        sqlite.db.exec('COMMIT')
        return results
      }
      catch (error) {
        sqlite.db.exec('ROLLBACK')
        throw error
      }
    },
  }
}

/**
 * La base du site. Une seule connexion par fichier, gardée d'un rechargement du serveur de développement à l'autre.
 */
export function sqliteDatabase(file: string): SqlDatabase {
  const store = ((globalThis as { __cmsSqlite?: Map<string, SqlDatabase> }).__cmsSqlite ??= new Map())
  let database = store.get(file)
  if (!database) store.set(file, database = wrap(open(file)))
  return database
}
