// Étapes Cloudflare : vérifications, création de la base D1 et du bucket R2, migrations, premier déploiement.
// Toutes les commandes passent par le wrangler du projet créé (`pnpm exec wrangler`), lancé dans son dossier.

import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run, shellLine } from './run.mjs'
import { bucketName, setDatabaseId } from './template.mjs'

/** Europe de l'Ouest. */
export const LOCATION = 'weur'
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/** Commande à taper à la main pour déployer avec un secret de session tout neuf (reprise après un échec, ou déploiement manuel). */
export const MANUAL_DEPLOY = [
  'printf \'NUXT_AUTH_SECRET=%s\\n\' "$(openssl rand -hex 32)" > .secrets.env',
  'pnpm exec wrangler deploy --secrets-file .secrets.env',
  'rm .secrets.env',
]

// ───────────── Lecture défensive des sorties de wrangler ─────────────

/** Retire les couleurs et autres séquences de terminal. */
export const stripAnsi = text => String(text ?? '').replace(/\u001B\[[0-9;?]*[A-Za-z]/g, '')

/** Premier bloc JSON (objet ou tableau) trouvé dans une sortie, ou undefined : wrangler ajoute parfois des avertissements autour. */
export function findJson(output) {
  const text = stripAnsi(output)
  for (const [open, close] of [['[', ']'], ['{', '}']]) {
    const starts = [...text.matchAll(open === '[' ? /^\s*\[/gm : /^\s*\{/gm)].map(m => m.index + m[0].length - 1)
    for (const start of starts) {
      const end = text.lastIndexOf(close)
      if (end <= start) continue
      try {
        return JSON.parse(text.slice(start, end + 1))
      }
      catch { /* on essaie le début suivant */ }
    }
  }
}

/**
 * Identifiant de la base dans la sortie de `wrangler d1 create`.
 * Wrangler affiche un extrait de configuration (JSON ou TOML selon les versions) contenant `database_id`.
 * À défaut, on accepte un identifiant s'il est le seul de toute la sortie ; sinon on ne devine pas.
 */
export function parseD1CreateOutput(output) {
  const text = stripAnsi(output)
  const labelled = text.match(new RegExp(`["']?(?:database_id|uuid)["']?\\s*[:=]\\s*["']?(${UUID.source})`, 'i'))
  if (labelled) return labelled[1].toLowerCase()
  const all = [...new Set((text.match(new RegExp(UUID.source, 'gi')) ?? []).map(id => id.toLowerCase()))]
  return all.length === 1 ? all[0] : undefined
}

/** Bases D1 du compte, d'après `wrangler d1 list --json` : [{ name, id }], ou undefined si la sortie est illisible. */
export function parseD1List(output) {
  const json = findJson(output)
  const list = Array.isArray(json) ? json : Array.isArray(json?.result) ? json.result : undefined
  if (!list) return
  return list.filter(db => db && typeof db.name === 'string').map(db => ({ name: db.name, id: db.uuid ?? db.database_id ?? db.id }))
}

/** Noms des buckets, d'après `wrangler r2 bucket list` (lignes « name: … »). */
export function parseR2List(output) {
  return [...stripAnsi(output).matchAll(/^\s*name:\s*(\S+)\s*$/gm)].map(m => m[1])
}

/** Réponse de `wrangler whoami --json` : { loggedIn, email, accounts: [{ id, name }] }. */
export function parseWhoami(output) {
  const json = findJson(output)
  if (!json || typeof json !== 'object' || Array.isArray(json)) return
  return {
    loggedIn: json.loggedIn !== false,
    email: typeof json.email === 'string' ? json.email : undefined,
    accounts: Array.isArray(json.accounts) ? json.accounts.filter(a => a?.id).map(a => ({ id: String(a.id), name: String(a.name ?? a.id) })) : [],
  }
}

/** La sortie d'une commande en échec dit-elle que le Worker n'existe pas ? (code 10007 de l'API Cloudflare) */
export const saysWorkerMissing = output => /\b10007\b|does not exist|not found|n'existe pas/i.test(stripAnsi(output))

/** Adresse du site déployé, lue dans la sortie de `wrangler deploy`. */
export const parseDeployUrl = output => stripAnsi(output).match(/https:\/\/[a-z0-9.-]+\.workers\.dev/i)?.[0]

// ───────────── Plan ─────────────

const wrangler = (...args) => ({ command: 'pnpm', args: ['exec', 'wrangler', ...args] })

/** Les vérifications et les étapes, dans l'ordre. `line` est ce qu'on affiche ; `manual` ce qu'on taperait à la main. */
export function plan(answers) {
  const { id } = answers
  const bucket = bucketName(id)
  const cmd = (key, title, spec, extra = {}) => ({ key, title, ...spec, line: shellLine(spec.command, spec.args), manual: [shellLine(spec.command, spec.args)], ...extra })
  return {
    checks: [
      cmd('whoami', 'Connexion à Cloudflare', wrangler('whoami', '--json')),
      cmd('d1-list', `Aucune base D1 nommée « ${id} »`, wrangler('d1', 'list', '--json')),
      cmd('r2-list', `Aucun bucket R2 nommé « ${bucket} »`, wrangler('r2', 'bucket', 'list')),
      cmd('worker', `Aucun Worker nommé « ${id} »`, wrangler('deployments', 'list', '--name', id)),
    ],
    steps: [
      cmd('d1-create', `Création de la base D1 « ${id} » (Europe de l'Ouest)`, wrangler('d1', 'create', id, '--location', LOCATION, '--no-update-config'), {
        manual: [shellLine('pnpm', ['exec', 'wrangler', 'd1', 'create', id, '--location', LOCATION, '--no-update-config']), '# puis reporter le database_id affiché dans wrangler.jsonc'],
      }),
      { key: 'd1-id', title: 'Report de l\'identifiant de la base dans wrangler.jsonc', line: 'wrangler.jsonc : "database_id" ← identifiant renvoyé par la commande précédente', manual: [] },
      cmd('r2-create', `Création du bucket R2 « ${bucket} » (Europe de l'Ouest)`, wrangler('r2', 'bucket', 'create', bucket, '--location', LOCATION)),
      cmd('migrate', 'Création des tables dans la base distante', wrangler('d1', 'migrations', 'apply', 'DB', '--remote')),
      cmd('build', 'Construction du site', { command: 'pnpm', args: ['build'] }),
      {
        key: 'deploy',
        title: 'Premier déploiement, avec un secret de session NUXT_AUTH_SECRET tiré au hasard',
        line: 'pnpm exec wrangler deploy --secrets-file <fichier temporaire contenant NUXT_AUTH_SECRET, supprimé ensuite>',
        manual: MANUAL_DEPLOY,
      },
    ],
  }
}

/** Les commandes à taper à la main à partir d'une étape donnée (reprise après un échec, ou étapes non demandées). */
export function manualCommands(answers, fromKey) {
  const { steps } = plan(answers)
  const from = fromKey ? Math.max(0, steps.findIndex(s => s.key === fromKey)) : 0
  return steps.slice(from).flatMap(s => s.manual)
}

// ───────────── Exécution ─────────────

/** Arrêt propre : le message dit ce qui a échoué, `resumeFrom` l'étape à partir de laquelle reprendre à la main. */
export class StepError extends Error {
  constructor(message, { resumeFrom, created = [] } = {}) {
    super(message)
    this.resumeFrom = resumeFrom
    this.created = created
  }
}

/**
 * Enchaîne les vérifications puis les étapes.
 * `ui` : { step(titre, ligne), info(texte), warn(texte), pickAccount(comptes) → id, confirm(question) → booléen }.
 * En `dryRun`, rien n'est exécuté : chaque commande est seulement affichée.
 * Renvoie { databaseId, url, created } ; lève StepError au premier échec.
 */
export async function runCloudflare(answers, ui, { dryRun = false, exec = run } = {}) {
  const { checks, steps } = plan(answers)
  const cwd = answers.dir
  const bucket = bucketName(answers.id)

  if (dryRun) {
    ui.info('Mode --dry-run : aucune commande Cloudflare n\'est exécutée. Voici ce qui serait fait, dans l\'ordre.')
    for (const s of [...checks, ...steps]) ui.step(`${checks.includes(s) ? 'Vérification' : 'Étape'} : ${s.title}`, s.line)
    return { dryRun: true, created: [] }
  }

  const env = answers.accountId ? { CLOUDFLARE_ACCOUNT_ID: answers.accountId } : {}
  const created = []
  const byKey = Object.fromEntries([...checks, ...steps].map(s => [s.key, s]))
  const launch = async (key, { quiet = false, extraEnv = {} } = {}) => {
    const s = byKey[key]
    ui.step(s.title, s.line)
    return exec(s.command, s.args, { cwd, env: { ...env, ...extraEnv }, quiet })
  }
  const stop = (message, resumeFrom) => new StepError(message, { resumeFrom, created: [...created] })

  // 1. Connecté ? Sur quel compte ?
  const who = await launch('whoami', { quiet: true })
  const user = parseWhoami(who.output)
  if (who.code !== 0 || user?.loggedIn === false)
    throw stop('Wrangler n\'est pas connecté à Cloudflare. Lancer `pnpm exec wrangler login` dans le dossier du projet, puis reprendre.', 'd1-create')
  if (user?.email) ui.info(`Connecté à Cloudflare : ${user.email}`)
  if (!env.CLOUDFLARE_ACCOUNT_ID && !process.env.CLOUDFLARE_ACCOUNT_ID && (user?.accounts.length ?? 0) > 1) {
    const picked = await ui.pickAccount(user.accounts)
    if (!picked) {
      throw stop(
        `Plusieurs comptes Cloudflare sont disponibles : préciser lequel avec --account-id.\n${user.accounts.map(a => `  ${a.name} : ${a.id}`).join('\n')}`,
        'd1-create',
      )
    }
    env.CLOUDFLARE_ACCOUNT_ID = picked
  }
  else if (user?.accounts.length === 1) {
    ui.info(`Compte : ${user.accounts[0].name}`)
  }

  // 2. Rien ne doit déjà porter ces noms : on ne touche jamais à une ressource existante.
  const d1List = await launch('d1-list', { quiet: true })
  const databases = d1List.code === 0 ? parseD1List(d1List.output) : undefined
  if (!databases) throw stop(`Impossible de lire la liste des bases D1 :\n${stripAnsi(d1List.output).trim()}`, 'd1-create')
  if (databases.some(db => db.name === answers.id))
    throw stop(`Une base D1 nommée « ${answers.id} » existe déjà sur ce compte. Choisir un autre identifiant.`, 'd1-create')

  const r2List = await launch('r2-list', { quiet: true })
  if (r2List.code !== 0) {
    throw stop(
      `Impossible de lire la liste des buckets R2 (R2 est-il activé sur ce compte ? Il s'active dans le tableau de bord Cloudflare) :\n${stripAnsi(r2List.output).trim()}`,
      'd1-create',
    )
  }
  if (parseR2List(r2List.output).includes(bucket))
    throw stop(`Un bucket R2 nommé « ${bucket} » existe déjà sur ce compte. Choisir un autre identifiant.`, 'd1-create')

  const worker = await launch('worker', { quiet: true })
  if (worker.code === 0)
    throw stop(`Un Worker nommé « ${answers.id} » existe déjà sur ce compte : le déploiement le remplacerait. Choisir un autre identifiant.`, 'd1-create')
  if (!saysWorkerMissing(worker.output)) {
    // Échec inattendu : on ne sait pas si le Worker existe. On ne continue que sur accord explicite.
    ui.warn(`Impossible de savoir si un Worker « ${answers.id} » existe déjà :\n${stripAnsi(worker.output).trim()}`)
    if (!(await ui.confirm(`Continuer quand même ? Si un Worker « ${answers.id} » existe, le déploiement le remplacera.`)))
      throw stop(`Vérification du Worker « ${answers.id} » impossible : arrêt par précaution, rien n'a été créé.`, 'd1-create')
  }
  ui.info('Vérifications terminées : les noms sont libres.')

  // 3. Base D1.
  const d1 = await launch('d1-create')
  if (d1.code !== 0) throw stop(`La création de la base D1 a échoué (voir le message de wrangler ci-dessus).`, 'd1-create')
  created.push(`base D1 « ${answers.id} »`)
  let databaseId = parseD1CreateOutput(d1.output)
  if (!databaseId) {
    // Sortie non reconnue : on demande l'identifiant à Cloudflare plutôt que de deviner.
    ui.warn('Identifiant de la base introuvable dans la sortie de wrangler : lecture de la liste des bases.')
    const again = await exec('pnpm', ['exec', 'wrangler', 'd1', 'list', '--json'], { cwd, env, quiet: true })
    databaseId = parseD1List(again.output)?.find(db => db.name === answers.id)?.id
  }
  ui.step(byKey['d1-id'].title, byKey['d1-id'].line)
  if (!databaseId || !UUID.test(databaseId) || !setDatabaseId(cwd, databaseId)) {
    throw stop(
      `La base « ${answers.id} » est créée, mais son identifiant n'a pas pu être reporté dans wrangler.jsonc.\nLe lire avec \`pnpm exec wrangler d1 list\` et l'écrire à la ligne "database_id".`,
      'r2-create',
    )
  }
  ui.info(`database_id : ${databaseId}`)

  // 4. Bucket R2.
  const r2 = await launch('r2-create')
  if (r2.code !== 0) throw stop('La création du bucket R2 a échoué (voir le message de wrangler ci-dessus).', 'r2-create')
  created.push(`bucket R2 « ${bucket} »`)

  // 5. Tables.
  const migrate = await launch('migrate')
  if (migrate.code !== 0) throw stop('Les migrations de la base distante ont échoué (voir le message de wrangler ci-dessus).', 'migrate')

  // 6. Construction.
  const build = await launch('build')
  if (build.code !== 0) throw stop('La construction du site a échoué (voir le message ci-dessus).', 'build')

  // 7. Déploiement. Le secret est fourni avec le premier déploiement : le site n'est jamais en ligne sans lui.
  const secretDir = mkdtempSync(join(tmpdir(), 'create-site-'))
  const secretFile = join(secretDir, 'secrets.json')
  let deploy
  try {
    writeFileSync(secretFile, JSON.stringify({ NUXT_AUTH_SECRET: randomBytes(32).toString('hex') }), { mode: 0o600 })
    ui.step(byKey.deploy.title, byKey.deploy.line)
    deploy = await exec('pnpm', ['exec', 'wrangler', 'deploy', '--secrets-file', secretFile], { cwd, env })
  }
  finally {
    rmSync(secretDir, { recursive: true, force: true })
  }
  if (deploy.code !== 0) throw stop('Le déploiement a échoué (voir le message de wrangler ci-dessus).', 'deploy')
  created.push(`Worker « ${answers.id} »`, 'secret NUXT_AUTH_SECRET')

  return { databaseId, url: parseDeployUrl(deploy.output), created }
}
