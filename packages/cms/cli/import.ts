/**
 * Outil d'import de contenus : `backoffice-import [fichier]`, lancé depuis le projet client.
 *
 * Il lit le `cms.config.ts` du projet et un fichier d'import (format décrit dans `import-plan.ts`), vérifie le fichier,
 * puis passe par l'API d'un back-office qui tourne (en local ou en ligne), connecté avec un compte : les droits et la
 * validation sont donc ceux du back-office. Relancé, il met à jour ce qu'il a déjà importé au lieu de le recréer.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, extname, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { createJiti } from 'jiti'
import type { CmsConfig } from '../shared/format'
import { canHaveFocus, normalizeFocus } from '../shared/media'
import { type MediaFolder, folderKey } from '../shared/media-folders'
import { imageSize } from './image-size'
import { type PlannedEntry, type PlannedFile, type Status, mediaId, mediaOf, planImport, requestBody } from './import-plan'

export const HELP = `
Importe des contenus dans le back-office à partir d'un fichier.

  pnpm cms:import [fichier] [options]

  fichier            Fichier d'import, JSON ou module JS/TS (défaut : cms.import.json, .mjs, .js ou .ts)

Options
  --url <adresse>    Adresse du back-office (défaut : variable CMS_URL, sinon http://localhost:3000)
  --dry-run          Simulation : dit ce qui serait créé ou mis à jour, sans rien écrire
  --draft            Importe en brouillon au lieu de publier (un "status" écrit dans le fichier garde la priorité)
  -h, --help         Affiche cette aide

Compte utilisé : variables d'environnement CMS_EMAIL et CMS_PASSWORD (un compte du back-office).
Si elles manquent et que la commande est lancée dans un terminal, elles sont demandées ; le mot de passe n'est pas affiché.
Ne les passez pas en option : la ligne de commande reste dans l'historique du terminal.

  CMS_EMAIL=claire@exemple.fr pnpm cms:import --url https://monsite.fr --dry-run

Relancer l'import après avoir corrigé le fichier met à jour les éléments déjà importés (retrouvés par leur "id").
Format du fichier : voir le README du projet.
`

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
  '.avif': 'image/avif', '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
}
const MAX_SIZE = 20 * 1024 * 1024

type Out = (line: string) => void
type Env = Record<string, string | undefined>
export type ImportOptions = {
  /** Dossier du projet client (celui de `cms.config.ts`). */
  cwd: string
  args: string[]
  env: Env
  out?: Out
  /** Demande une valeur manquante dans le terminal ; absent : la commande n'est pas interactive. */
  ask?: (question: string, hidden: boolean) => Promise<string>
}

class Refusal extends Error {}

/** Un chemin tel qu'on l'affiche : relatif au projet s'il est dedans, complet sinon. */
const shown = (cwd: string, file: string) => (relative(cwd, file).startsWith('..') ? file : relative(cwd, file) || file)

// ───────────────────────── Appels à l'API ─────────────────────────

type ApiError = Error & { status?: number; fields?: Record<string, Record<string, string>> }

/** Client HTTP qui garde le cookie de session. */
function client(base: string) {
  const jar = new Map<string, string>()
  return async function call<T = any>(url: string, init: { method?: string; json?: unknown; form?: FormData } = {}): Promise<T> {
    let response: Response
    try {
      response = await fetch(base + url, {
        method: init.method ?? 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(120_000),
        headers: {
          // Le back-office refuse les écritures sans en-tête Origin.
          origin: base,
          ...(jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
          ...(init.json !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: init.json !== undefined ? JSON.stringify(init.json) : init.form,
      })
    }
    catch (e) {
      throw new Error(`pas de réponse de ${base} (${(e as Error).cause instanceof Error ? ((e as Error).cause as Error).message : (e as Error).message})`)
    }
    for (const line of response.headers.getSetCookie()) {
      const pair = line.split(';')[0]!
      const i = pair.indexOf('=')
      jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim())
    }
    const text = await response.text()
    let data: any = null
    try { data = text ? JSON.parse(text) : null }
    catch { /* pas du JSON */ }
    if (!response.ok) {
      const error: ApiError = new Error(data?.message || data?.statusMessage || `réponse ${response.status}`)
      error.status = response.status
      error.fields = data?.data?.errors
      throw error
    }
    return data as T
  }
}

/** Les erreurs d'un envoi, une par ligne : « champ (langue) : message ». */
function describe(error: ApiError): string[] {
  const lines: string[] = []
  for (const [part, fields] of Object.entries(error.fields ?? {}))
    for (const [field, message] of Object.entries(fields)) lines.push(field === '_' ? `(${part}) ${message}` : `${field}${part === 'shared' ? '' : ` (${part})`} : ${message}`)
  return lines.length ? lines : [error.message]
}

// ───────────────────────── Lecture du projet ─────────────────────────

async function loadConfig(cwd: string): Promise<CmsConfig> {
  const file = resolve(cwd, 'cms.config.ts')
  if (!existsSync(file)) throw new Refusal(`cms.config.ts introuvable dans ${cwd}. Lancez la commande depuis le dossier du site.`)
  try {
    return await createJiti(cwd).import<CmsConfig>(file, { default: true })
  }
  catch (e) {
    throw new Refusal(`cms.config.ts n'a pas pu être lu : ${(e as Error).message}`)
  }
}

async function loadData(cwd: string, given: string | undefined): Promise<{ file: string; data: unknown }> {
  const file = given
    ? resolve(cwd, given)
    : ['cms.import.json', 'cms.import.mjs', 'cms.import.js', 'cms.import.ts'].map(name => resolve(cwd, name)).find(existsSync)
  if (!file) throw new Refusal('Aucun fichier d\'import : indiquez-le (pnpm cms:import contenus.json) ou créez cms.import.json à la racine du projet.')
  if (!existsSync(file)) throw new Refusal(`Fichier d'import introuvable : ${file}`)
  try {
    if (extname(file) === '.json') return { file, data: JSON.parse(readFileSync(file, 'utf8')) }
    // Module : son export par défaut est l'objet, ou une fonction (éventuellement asynchrone) qui le renvoie.
    const loaded = await createJiti(cwd, { moduleCache: false }).import<unknown>(file, { default: true })
    return { file, data: typeof loaded === 'function' ? await loaded() : loaded }
  }
  catch (e) {
    throw new Refusal(`Le fichier d'import n'a pas pu être lu (${shown(cwd, file)}) : ${(e as Error).message}`)
  }
}

type ReadFile = PlannedFile & { id: string; content: Buffer; mime: string }

/** Lit les fichiers cités. Toute anomalie est une erreur du fichier d'import : rien n'est envoyé. */
function readFiles(files: PlannedFile[], errors: string[]): ReadFile[] {
  const out: ReadFile[] = []
  for (const file of files) {
    const mime = MIME[extname(file.path).toLowerCase()]
    if (!existsSync(file.path) || !statSync(file.path).isFile()) errors.push(`${file.where} : fichier introuvable (${file.path}).`)
    else if (!mime) errors.push(`${file.where} : type de fichier non accepté (${file.cited}). Formats possibles : JPEG, PNG, WebP, GIF, AVIF, SVG, PDF.`)
    else if (file.image && !mime.startsWith('image/')) errors.push(`${file.where} : une image est attendue (${file.cited}).`)
    else if (statSync(file.path).size > MAX_SIZE) errors.push(`${file.where} : fichier trop lourd (${file.cited}), 20 Mo au maximum.`)
    else {
      const content = readFileSync(file.path)
      out.push({ ...file, content, mime, id: mediaId(content) })
    }
  }
  return out
}

// ───────────────────────── Import ─────────────────────────

type Outcome = 'created' | 'updated' | 'unchanged' | 'error'
const LABELS: Record<Outcome, [done: string, planned: string]> = {
  created: ['créé', 'à créer'], updated: ['mis à jour', 'à mettre à jour'], unchanged: ['inchangé', 'inchangé'], error: ['ERREUR', 'ERREUR'],
}
/** Largeur de la colonne des résultats dans le compte rendu. */
const WIDTH = 18
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`

/** Lance l'import. Renvoie le code de sortie : 0 si tout s'est bien passé, 1 à la moindre erreur. */
export async function runImport(options: ImportOptions): Promise<number> {
  const out = options.out ?? (line => console.log(line))
  let parsed
  try {
    parsed = parseArgs({
      args: options.args,
      allowPositionals: true,
      options: { 'url': { type: 'string' }, 'dry-run': { type: 'boolean' }, 'draft': { type: 'boolean' }, 'help': { type: 'boolean', short: 'h' } },
    })
  }
  catch (e) {
    out(`${(e as Error).message}\n${HELP}`)
    return 1
  }
  if (parsed.values.help) { out(HELP); return 0 }
  if (parsed.positionals.length > 1) { out(`Un seul fichier d'import à la fois (reçu : ${parsed.positionals.join(', ')}).`); return 1 }
  const dryRun = !!parsed.values['dry-run']
  const status: Status | undefined = parsed.values.draft ? 'draft' : undefined

  try {
    const config = await loadConfig(options.cwd)
    const { file, data } = await loadData(options.cwd, parsed.positionals[0])
    const base = (parsed.values.url ?? options.env.CMS_URL ?? 'http://localhost:3000').replace(/\/+$/, '')
    out(`Import de ${shown(options.cwd, file)} vers ${base}${dryRun ? ' — simulation, rien ne sera écrit' : ''}`)

    // 1. Le fichier est vérifié en entier avant le premier envoi.
    const plan = planImport(config, data, { baseDir: dirname(file), publicDir: resolve(options.cwd, 'public'), status })
    const files = readFiles(plan.files, plan.errors)
    if (plan.errors.length) {
      out(`\nLe fichier d'import contient ${plural(plan.errors.length, 'erreur', 'erreurs')} ; rien n'a été envoyé.`)
      for (const error of plan.errors) out(`  - ${error}`)
      return 1
    }
    for (const warning of plan.warnings) out(`  attention : ${warning}`)
    if (!plan.entries.length) { out('Le fichier ne contient aucun élément : rien à faire.'); return 0 }

    // 2. Connexion.
    const ask = async (name: string, question: string, hidden: boolean) => {
      const value = options.env[name] || (options.ask ? await options.ask(question, hidden) : '')
      if (!value) throw new Refusal(`${name} manquant : indiquez le compte du back-office par les variables d'environnement CMS_EMAIL et CMS_PASSWORD.`)
      return value
    }
    const email = await ask('CMS_EMAIL', 'E-mail du compte : ', false)
    const password = await ask('CMS_PASSWORD', 'Mot de passe : ', true)
    const call = client(base)
    try {
      await call('/api/auth/sign-in/email', { method: 'POST', json: { email, password } })
    }
    catch (e) {
      const { status: code, message } = e as ApiError
      throw new Refusal(code === 401 || code === 403 ? `Connexion refusée à ${base} pour ${email} : e-mail ou mot de passe incorrect.` : `Connexion impossible à ${base} : ${message}`)
    }

    const counts: Record<Outcome, number> = { created: 0, updated: 0, unchanged: 0, error: 0 }
    const line = (outcome: Outcome, name: string, details: string[] = []) => {
      counts[outcome]++
      out(`  ${LABELS[outcome][dryRun ? 1 : 0].padEnd(WIDTH)}${name}${details.length === 1 ? ` › ${details[0]}` : ''}`)
      if (details.length > 1) for (const detail of details) out(`  ${''.padEnd(WIDTH)}  › ${detail}`)
    }

    // 3. Dossiers de la médiathèque : ceux qui manquent sont créés, niveau par niveau. Un dossier existant est
    //    retrouvé par son nom (sans tenir compte des majuscules) : relancer l'import ne crée pas de doublon.
    //    Les chemins se comparent sans tenir compte des majuscules : « chantiers/charpente » est « Chantiers/Charpente ».
    const keyOf = (names: string[]) => names.map(folderKey).join('/')
    const folderIds = new Map<string, string | undefined>()
    const folderFailed = new Map<string, string>()
    /** Chaque dossier voulu, à tous les niveaux, tel qu'il est écrit la première fois dans le fichier. */
    const wanted = new Map<string, string[]>()
    for (const f of files) f.folder?.forEach((_, i) => { const names = f.folder!.slice(0, i + 1); if (!wanted.has(keyOf(names))) wanted.set(keyOf(names), names) })
    if (wanted.size) {
      out('\nDossiers de la médiathèque')
      const folders = await call<MediaFolder[]>('/api/cms/media/folders')
      // Du moins profond au plus profond : un parent est toujours traité avant ses sous-dossiers.
      for (const [key, names] of [...wanted].sort(([, a], [, b]) => a.length - b.length)) {
        const parentKey = names.length > 1 ? keyOf(names.slice(0, -1)) : null
        if (parentKey && folderFailed.has(parentKey)) { folderFailed.set(key, folderFailed.get(parentKey)!); continue }
        const parentId = parentKey ? folderIds.get(parentKey) : null
        const name = names.at(-1)!
        // Parent encore à créer (simulation) : rien n'existe dessous.
        const found = parentId === undefined ? undefined : folders.find(f => (f.parentId ?? null) === parentId && folderKey(f.name) === folderKey(name))
        try {
          if (found) folderIds.set(key, found.id)
          else if (dryRun) folderIds.set(key, undefined)
          else {
            const created = await call<MediaFolder>('/api/cms/media/folders', { method: 'POST', json: { name, parentId } })
            folders.push(created)
            folderIds.set(key, created.id)
          }
          out(`  ${(found ? 'déjà présent' : dryRun ? 'à créer' : 'créé').padEnd(WIDTH)}${names.join('/')}`)
        }
        catch (e) {
          folderFailed.set(key, (e as Error).message)
          counts.error++
          out(`  ${'ERREUR'.padEnd(WIDTH)}${names.join('/')} › ${(e as Error).message}`)
        }
      }
    }

    // 4. Médiathèque : seuls les fichiers qui n'y sont pas encore sont envoyés.
    const ids = new Map<string, string>()
    const failed = new Map<string, string>()
    let sent = 0
    type Known = { id: string; mime?: string; alt: Record<string, string>; folderId?: string | null; focus?: { x: number; y: number } | null }
    if (files.length) {
      out('\nMédiathèque')
      const known = new Map((await call<Known[]>('/api/cms/media')).map(m => [m.id, m]))
      for (const file of files) {
        const name = file.cited
        try {
          const folderPath = file.folder?.join('/')
          const folderKeyed = file.folder ? keyOf(file.folder) : undefined
          if (folderKeyed && folderFailed.has(folderKeyed)) throw new Error(`dossier non créé : ${folderPath}`)
          const folderId = folderKeyed ? folderIds.get(folderKeyed) : undefined
          let current = known.get(file.id)
          const isNew = !current
          if (isNew && !dryRun) {
            const form = new FormData()
            form.append('file', new Blob([new Uint8Array(file.content)], { type: file.mime }), basename(file.path))
            form.append('id', file.id)
            if (folderId) form.append('folder', folderId)
            const size = file.mime === 'image/svg+xml' ? null : imageSize(file.content)
            if (size) { form.append('width', String(size.width)); form.append('height', String(size.height)) }
            current = await call<Known>('/api/cms/media', { method: 'POST', form })
            known.set(file.id, current)
          }
          // Le texte alternatif du fichier d'import complète celui de la médiathèque, langue par langue.
          const alt = { ...current?.alt, ...file.alt }
          const altChanged = Object.entries(file.alt).some(([locale, text]) => (current?.alt?.[locale] ?? '') !== text)
          if (altChanged && !dryRun) await call(`/api/cms/media/${file.id}`, { method: 'PATCH', json: { alt } })
          // Point d'intérêt : celui du fichier d'import, s'il en donne un (sans effet sur un SVG, un GIF ou un PDF).
          const wanted = canHaveFocus(file.mime) ? normalizeFocus(file.focus) : null
          const focusChanged = !!file.focus && canHaveFocus(file.mime) && (wanted?.x !== current?.focus?.x || wanted?.y !== current?.focus?.y)
          if (focusChanged && !dryRun) await call(`/api/cms/media/${file.id}`, { method: 'PATCH', json: { focus: wanted } })
          // Un fichier déjà présent est rangé dans le dossier demandé ; sans « folder », il reste où il est.
          const moved = !!folderPath && !isNew && (folderId === undefined || (current?.folderId ?? null) !== folderId)
          if (moved && !dryRun) await call('/api/cms/media/move', { method: 'POST', json: { ids: [file.id], folderId } })
          if (isNew) sent++
          ids.set(file.path, file.id)
          const changes = [altChanged ? (dryRun ? 'texte à corriger' : 'texte corrigé') : '', focusChanged ? (dryRun ? 'point à régler' : 'point réglé') : '', moved ? (dryRun ? 'à ranger' : 'rangé') : ''].filter(Boolean).join(', ')
          out(`  ${(isNew ? (dryRun ? 'à envoyer' : 'envoyé') : changes || 'déjà présent').padEnd(WIDTH)}${name}${folderPath ? ` › ${folderPath}` : ''}`)
        }
        catch (e) {
          failed.set(file.path, (e as Error).message)
          counts.error++
          out(`  ${'ERREUR'.padEnd(WIDTH)}${name} › ${(e as Error).message}`)
        }
      }
    }

    // 5. Contenus, type par type, dans l'ordre du fichier. Une erreur sur un élément n'arrête pas les autres.
    const byType = new Map<string, PlannedEntry[]>()
    for (const entry of plan.entries) byType.set(entry.type, [...(byType.get(entry.type) ?? []), entry])
    for (const [type, entries] of byType) {
      const def = (config.collections?.[type] ?? config.singletons?.[type])!
      out(`\n${def.label} (${type})`)
      let existing = new Set<string>()
      if (def.kind === 'collection') {
        try {
          existing = new Set((await call<{ id: string }[]>(`/api/cms/entries/${type}`)).map(item => item.id))
        }
        catch (e) {
          for (const entry of entries) line('error', `« ${entry.name} »`, describe(e as ApiError))
          continue
        }
      }
      for (const entry of entries) {
        const name = def.kind === 'collection' ? `« ${entry.name} »` : entry.name
        const missing = [...mediaOf([entry.values, entry.translations])].filter(path => failed.has(path))
        if (missing.length) { line('error', name, missing.map(path => `fichier non envoyé : ${files.find(f => f.path === path)?.cited ?? path}`)); continue }
        const create = def.kind === 'collection' && !existing.has(entry.id)
        const url = create ? `/api/cms/entries/${type}` : `/api/cms/entries/${type}/${entry.id}`
        const method = create ? 'POST' : 'PUT'
        try {
          // D'abord une simulation côté serveur : elle vérifie tout et dit si quelque chose changerait.
          // Un élément identique n'est donc pas réécrit (ni republié, ni annoncé aux automatisations).
          const check = await call<{ created: boolean; changed: string[] }>(url, { method, json: requestBody(entry, ids, { create, dryRun: true }) })
          const outcome: Outcome = check.created ? 'created' : check.changed.length ? 'updated' : 'unchanged'
          if (outcome !== 'unchanged' && !dryRun) await call(url, { method, json: requestBody(entry, ids, { create, dryRun: false }) })
          line(outcome, name)
        }
        catch (e) {
          line('error', name, describe(e as ApiError))
        }
      }
    }

    // 6. Compte rendu.
    const total = [
      dryRun ? `${counts.created} à créer` : plural(counts.created, 'créé', 'créés'),
      dryRun ? `${counts.updated} à mettre à jour` : `${counts.updated} mis à jour`,
      plural(counts.unchanged, 'inchangé', 'inchangés'),
      plural(counts.error, 'erreur', 'erreurs'),
    ].join(', ')
    out(`\n${dryRun ? 'Simulation terminée' : 'Import terminé'}${counts.error ? ' avec des erreurs' : ''} : ${total}.${files.length ? ` Fichiers : ${sent} ${dryRun ? 'à envoyer' : sent > 1 ? 'envoyés' : 'envoyé'} sur ${files.length}.` : ''}`)
    if (dryRun) out('Rien n\'a été écrit. Relancez sans --dry-run pour importer.')
    return counts.error ? 1 : 0
  }
  catch (e) {
    if (!(e instanceof Refusal)) throw e
    out(e.message)
    return 1
  }
}

// ───────────────────────── Terminal ─────────────────────────

/** Pose une question dans le terminal. `hidden` : la saisie n'est pas affichée (mot de passe). */
export function askInTerminal(question: string, hidden: boolean): Promise<string> {
  const { stdin, stdout } = process
  return new Promise((done) => {
    stdout.write(question)
    let answer = ''
    if (hidden) stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    const finish = () => {
      stdin.off('data', onData)
      if (hidden) { stdin.setRawMode(false); stdout.write('\n') }
      stdin.pause()
      done(answer.trim())
    }
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\n' || char === '\r' || char === '\u0004') return finish()
        if (char === '\u0003') { if (hidden) stdin.setRawMode(false); process.exit(130) }
        if (char === '\u007f' || char === '\b') answer = answer.slice(0, -1)
        else answer += char
      }
    }
    stdin.on('data', onData)
  })
}
