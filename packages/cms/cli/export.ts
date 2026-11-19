/**
 * Export complet d'un site : `backoffice-export`, lancé depuis le projet client.
 *
 * Il sert à deux choses :
 * - remettre ses données à un client qui part (réversibilité) : la base, les fichiers de la médiathèque, et de quoi
 *   tout réimporter dans un site neuf ;
 * - restaurer entièrement un site (comptes compris) à partir d'une sauvegarde, ce que le back-office ne fait pas
 *   lui-même : il produit le fichier SQL à passer à `wrangler d1 execute`.
 *
 * Avec `--url`, il se connecte au back-office avec un compte administrateur, demande une sauvegarde fraîche, la
 * télécharge, puis télécharge les fichiers par leur adresse publique. Avec `--from`, il part d'un fichier de
 * sauvegarde déjà téléchargé, sans connexion.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { gunzipSync } from 'node:zlib'
import { type BackupValue, type ParsedBackup, assembleBackup, creationOrder, formatBackupSize, fromBase64, isBlob, isSealed, sqlDump } from '../shared/backup'
import { decryptSecret } from '../shared/secrets'

export const EXPORT_HELP = `
Exporte tout un site : la base, les fichiers de la médiathèque, et de quoi les réimporter ailleurs.

  pnpm cms:export [options]

Options
  --url <adresse>    Adresse du back-office (défaut : variable CMS_URL, sinon http://localhost:3000)
  --from <fichier>   Partir d'une sauvegarde déjà téléchargée (.ndjson.gz) au lieu de se connecter au site
  --out <dossier>    Dossier à créer (défaut : export-AAAA-MM-JJ)
  --no-files         Ne pas télécharger les fichiers de la médiathèque (leur liste est quand même écrite)
  -h, --help         Affiche cette aide

Compte utilisé : variables CMS_EMAIL et CMS_PASSWORD (un compte administrateur) ; demandées dans le terminal si elles manquent.
Mots de passe des comptes : ils sont chiffrés dans la sauvegarde. Pour qu'ils soient repris, donnez le secret du site
d'origine dans la variable NUXT_AUTH_SECRET ; sinon chaque personne devra choisir un nouveau mot de passe.

Le dossier produit contient un fichier LISEZMOI.txt avec les commandes de réimport.
`

type Env = Record<string, string | undefined>
export type ExportOptions = {
  cwd: string
  args: string[]
  env: Env
  out?: (line: string) => void
  ask?: (question: string, hidden: boolean) => Promise<string>
}
class Refusal extends Error {}

/** Client HTTP qui garde le cookie de session. */
function client(base: string) {
  const jar = new Map<string, string>()
  return async function call(url: string, init: { method?: string; json?: unknown } = {}): Promise<Response> {
    let response: Response
    try {
      response = await fetch(base + url, {
        method: init.method ?? 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(300_000),
        headers: {
          origin: base,
          ...(jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
          ...(init.json !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
      })
    }
    catch (e) {
      throw new Refusal(`pas de réponse de ${base} (${(e as Error).cause instanceof Error ? ((e as Error).cause as Error).message : (e as Error).message})`)
    }
    for (const line of response.headers.getSetCookie()) {
      const pair = line.split(';')[0]!
      const i = pair.indexOf('=')
      jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim())
    }
    if (!response.ok) {
      const data = await response.json().catch(() => null) as { message?: string } | null
      const error = new Refusal(data?.message || `réponse ${response.status}`) as Refusal & { status?: number }
      error.status = response.status
      throw error
    }
    return response
  }
}

/** Lit un fichier de sauvegarde compressé. */
export function readBackupFile(bytes: Uint8Array): ParsedBackup {
  let text: string
  try { text = gunzipSync(bytes).toString('utf8') }
  catch { throw new Refusal('Ce fichier n\'est pas une sauvegarde du back-office (il n\'est pas compressé comme attendu).') }
  try { return assembleBackup(text.split('\n')) }
  catch (e) { throw new Refusal((e as Error).message) }
}

/**
 * Le fichier SQL qui remet une base dans l'état de la sauvegarde : il vide les tables sauvegardées puis les remplit,
 * dans un ordre qui respecte les liens entre tables. Les valeurs chiffrées sont déchiffrées avec `secret` ;
 * sans lui (ou s'il n'est pas le bon), elles sont laissées vides et comptées dans `unreadable`.
 */
export async function backupToSql(backup: ParsedBackup, secret: string | undefined): Promise<{ sql: string; rows: number; unreadable: Record<string, number> }> {
  const ordered = creationOrder(backup.tables)
  const unreadable: Record<string, number> = {}
  const lines = [
    `-- Sauvegarde du site « ${backup.header.site.name} » du ${backup.header.createdAt} (back-office ${backup.header.core}).`,
    '-- À exécuter sur une base dont la structure existe déjà (wrangler d1 migrations apply), avec wrangler d1 execute --file.',
    '-- Remplace le contenu des tables ci-dessous. Les connexions en cours ne sont pas dans la sauvegarde : chacun devra se reconnecter.',
    'PRAGMA defer_foreign_keys = on;',
    ...[...ordered].reverse().map(t => `DELETE FROM "${t.table}";`),
  ]
  let count = 0
  for (const t of ordered) {
    const rows: unknown[][] = []
    for (const row of t.rows) {
      const values: unknown[] = []
      for (const [i, raw] of row.entries()) {
        let value: unknown = raw
        if (isSealed(raw)) {
          const plain = secret ? await decryptSecret(secret, raw.$sealed) : null
          if (plain === null) {
            const column = `${t.table}.${t.columns[i]!.name}`
            unreadable[column] = (unreadable[column] ?? 0) + 1
            value = t.columns[i]!.notnull ? '' : null
          }
          else value = JSON.parse(plain) as BackupValue
        }
        if (value !== null && typeof value === 'object' && isBlob(value as BackupValue)) value = fromBase64((value as { $blob: string }).$blob)
        values.push(value)
      }
      rows.push(values)
    }
    count += rows.length
    lines.push(`-- ${t.table} : ${rows.length} ligne${rows.length > 1 ? 's' : ''}`, ...sqlDump(t.table, t.columns, rows))
  }
  return { sql: lines.join('\n') + '\n', rows: count, unreadable }
}

type MediaFile = { key: string; name: string; mime: string; size: number; url: string }

/** Les fichiers de la médiathèque d'après la sauvegarde, avec leur adresse publique. */
export function mediaFiles(backup: ParsedBackup, base: string | null): MediaFile[] {
  const table = backup.tables.find(t => t.table === 'cms_media')
  if (!table) return []
  const at = (name: string) => table.columns.findIndex(c => c.name === name)
  const [key, name, mime, size] = [at('key'), at('name'), at('mime'), at('size')]
  const origin = (base ?? backup.header.site.url ?? '').replace(/\/$/, '')
  return table.rows.map(r => ({ key: String(r[key]), name: String(r[name] ?? ''), mime: String(r[mime] ?? ''), size: Number(r[size]) || 0, url: `${origin}/media/${String(r[key]).split('/').map(encodeURIComponent).join('/')}` }))
}

const shell = (text: string) => `'${text.replace(/'/g, '\'\\\'\'')}'`

function readme(backup: ParsedBackup, info: { files: MediaFile[]; downloaded: number; unreadable: Record<string, number>; rows: number }) {
  const lost = Object.entries(info.unreadable)
  return `Export du site « ${backup.header.site.name} »
Sauvegarde du ${backup.header.createdAt}, écrite par le back-office ${backup.header.core}.

CONTENU DU DOSSIER
  sauvegarde.ndjson.gz   La base, telle que le back-office la sauvegarde : un fichier texte compressé, une valeur JSON
                         par ligne (en-tête, puis pour chaque table sa description et ses lignes). Lisible sans outil
                         particulier : gunzip -c sauvegarde.ndjson.gz | less
  restauration.sql       La même chose en SQL (${info.rows} lignes), prête à être chargée dans une base D1 ou SQLite.
  fichiers.json          Les ${info.files.length} fichiers de la médiathèque : nom, type, taille, adresse publique.
  fichiers/              ${info.downloaded} fichier${info.downloaded > 1 ? 's' : ''} téléchargé${info.downloaded > 1 ? 's' : ''}, rangé${info.downloaded > 1 ? 's' : ''} sous ${info.downloaded > 1 ? 'leur' : 'sa'} clé de stockage.
  envoyer-fichiers.sh    Envoie ces fichiers dans le stockage (R2) d'un autre site.

CE QUI N'EST PAS DANS L'EXPORT
  - Les connexions en cours et les liens d'invitation : chacun se reconnecte avec son mot de passe.
${lost.length
    ? `  - Les valeurs chiffrées n'ont pas pu être lues (secret du site d'origine non fourni ou différent) :\n${lost.map(([c, n]) => `      ${c} : ${n}`).join('\n')}\n    Pour les mots de passe (account.password) : chaque personne devra en choisir un nouveau (lien « Mot de passe\n    oublié » ou nouvelle invitation). Relancez l'export avec NUXT_AUTH_SECRET=<secret du site d'origine> pour les reprendre.`
    : '  - Rien d\'autre : les mots de passe (hachés) sont repris, chacun garde le sien.'}
  - Les clés d'API des modules (Brevo, Stripe…) restent chiffrées avec le secret du site d'origine. Elles ne sont
    lisibles que si le nouveau site a le même NUXT_AUTH_SECRET ; sinon, saisissez-les à nouveau dans « Modules ».

RÉIMPORTER DANS UN SITE NEUF
  Le site doit utiliser la même version du back-office (${backup.header.core}) ou une version plus récente, mise à jour
  APRÈS l'import. Depuis le dossier du site, une fois sa base et son stockage créés (voir son README) :

    npx wrangler d1 migrations apply DB --remote
    npx wrangler d1 execute DB --remote --file ${shell('restauration.sql')}
    sh envoyer-fichiers.sh <nom-du-bucket> --remote

  Pour essayer d'abord en local, remplacez --remote par --local dans les trois commandes.
  L'import REMPLACE le contenu de la base de destination (contenus, réglages, comptes).

Migrations de la base appliquées au moment de la sauvegarde :
${backup.header.migrations.map(m => `  ${m}`).join('\n') || '  (inconnues)'}
`
}

export async function runExport(options: ExportOptions): Promise<number> {
  const out = options.out ?? (line => console.log(line))
  let parsed
  try {
    parsed = parseArgs({
      args: options.args,
      options: { 'url': { type: 'string' }, 'from': { type: 'string' }, 'out': { type: 'string' }, 'no-files': { type: 'boolean' }, 'help': { type: 'boolean', short: 'h' } },
    })
  }
  catch (e) {
    out(`${(e as Error).message}\n${EXPORT_HELP}`)
    return 2
  }
  if (parsed.values.help) { out(EXPORT_HELP); return 0 }
  const { env, cwd } = options
  try {
    const target = resolve(cwd, parsed.values.out ?? `export-${new Date().toISOString().slice(0, 10)}`)
    if (existsSync(target)) throw new Refusal(`Le dossier ${relative(cwd, target) || target} existe déjà : choisissez-en un autre avec --out, ou supprimez-le.`)

    let bytes: Uint8Array
    let base: string | null = null
    if (parsed.values.from) {
      const file = resolve(cwd, parsed.values.from)
      if (!existsSync(file)) throw new Refusal(`Fichier introuvable : ${file}`)
      bytes = readFileSync(file)
      out(`Sauvegarde lue : ${relative(cwd, file)}`)
    }
    else {
      base = (parsed.values.url ?? env.CMS_URL ?? 'http://localhost:3000').replace(/\/$/, '')
      const email = env.CMS_EMAIL || await options.ask?.('E-mail du compte administrateur : ', false)
      const password = env.CMS_PASSWORD || await options.ask?.('Mot de passe : ', true)
      if (!email || !password) throw new Refusal('Compte manquant : renseignez les variables CMS_EMAIL et CMS_PASSWORD.')
      const call = client(base)
      await call('/api/auth/sign-in/email', { method: 'POST', json: { email, password } }).catch((e: Error & { status?: number }) => {
        throw new Refusal(e.status ? `Connexion refusée par ${base} : vérifiez l'e-mail et le mot de passe.` : e.message)
      })
      out(`Connecté à ${base}. Sauvegarde en cours…`)
      const made = await (await call('/api/cms/backups', { method: 'POST', json: {} }).catch((e: Error & { status?: number }) => {
        throw new Refusal(e.status === 403 ? 'Ce compte n\'est pas administrateur : l\'export complet lui est refusé.' : `La sauvegarde a échoué : ${e.message}`)
      })).json() as { name: string }
      bytes = new Uint8Array(await (await call(`/api/cms/backups/${made.name}/download`)).arrayBuffer())
      out(`Sauvegarde téléchargée (${formatBackupSize(bytes.length)}).`)
    }

    const backup = readBackupFile(bytes)
    const secret = env.NUXT_AUTH_SECRET || undefined
    const { sql, rows, unreadable } = await backupToSql(backup, secret)
    const files = mediaFiles(backup, base)

    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'sauvegarde.ndjson.gz'), bytes)
    writeFileSync(join(target, 'restauration.sql'), sql)
    writeFileSync(join(target, 'fichiers.json'), JSON.stringify(files, null, 2) + '\n')
    out(`${rows} lignes dans ${backup.tables.length} tables → restauration.sql`)

    let downloaded = 0
    const failed: string[] = []
    if (!parsed.values['no-files'] && files.length) {
      if (!files[0]!.url.startsWith('http')) out('Fichiers non téléchargés : l\'adresse du site est inconnue (utilisez --url).')
      else {
        const root = join(target, 'fichiers')
        const queue = [...files]
        await Promise.all(Array.from({ length: 4 }, async () => {
          for (let file = queue.shift(); file; file = queue.shift()) {
            const path = resolve(root, ...file.key.split('/'))
            // Une clé ne doit jamais faire écrire hors du dossier.
            if (!path.startsWith(root + sep)) { failed.push(file.key); continue }
            const response = await fetch(file.url, { signal: AbortSignal.timeout(300_000) }).catch(() => null)
            if (!response?.ok) { failed.push(file.key); continue }
            mkdirSync(dirname(path), { recursive: true })
            writeFileSync(path, new Uint8Array(await response.arrayBuffer()))
            downloaded++
          }
        }))
        out(`${downloaded} fichier${downloaded > 1 ? 's' : ''} de la médiathèque téléchargé${downloaded > 1 ? 's' : ''} sur ${files.length}.`)
        for (const key of failed) out(`  ! introuvable : ${key}`)
      }
    }
    writeFileSync(join(target, 'envoyer-fichiers.sh'), [
      '#!/bin/sh',
      '# Envoie les fichiers de la médiathèque dans un bucket R2 : sh envoyer-fichiers.sh <nom-du-bucket> [--remote|--local]',
      'set -e',
      'BUCKET="$1"; MODE="${2:---remote}"',
      '[ -n "$BUCKET" ] || { echo "Indiquez le nom du bucket."; exit 2; }',
      'cd "$(dirname "$0")"',
      ...files.filter(f => !failed.includes(f.key)).map(f => `npx wrangler r2 object put "$BUCKET"/${shell(f.key)} --file ${shell(`fichiers/${f.key}`)} --content-type ${shell(f.mime || 'application/octet-stream')} "$MODE"`),
      '',
    ].join('\n'))
    writeFileSync(join(target, 'LISEZMOI.txt'), readme(backup, { files, downloaded, unreadable, rows }))

    const lost = Object.values(unreadable).reduce((a, b) => a + b, 0)
    if (lost) out(`Attention : ${lost} valeur${lost > 1 ? 's' : ''} chiffrée${lost > 1 ? 's' : ''} non reprise${lost > 1 ? 's' : ''} (mots de passe) : donnez NUXT_AUTH_SECRET pour les reprendre. Voir LISEZMOI.txt.`)
    out(`Export terminé : ${relative(cwd, target) || target} (lire LISEZMOI.txt).`)
    return failed.length ? 1 : 0
  }
  catch (e) {
    if (e instanceof Refusal) { out(`Erreur : ${e.message}`); return 1 }
    throw e
  }
}
