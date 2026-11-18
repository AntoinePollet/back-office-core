import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as p from '@clack/prompts'
import { CORE_REPO, CORE_SUBDIR, HELP, UsageError, readArgs } from './args.mjs'
import { StepError, manualCommands, runCloudflare } from './cloudflare.mjs'
import { run, shellLine } from './run.mjs'
import { coreSpec, generate, defaultCoreRef } from './template.mjs'
import {
  checkCorePath, checkDefaultLocale, checkGitRef, checkId, checkLocales, checkName, checkTargetDir, checkUrl,
  normalizeUrl, parseLocales, slugify,
} from './validate.mjs'

/** Dossier d'où la commande a été lancée (pnpm exécute les scripts depuis la racine du dépôt). */
const START_DIR = process.env.INIT_CWD || process.cwd()
/** Racine du dépôt du core, quand la commande est lancée depuis ce dépôt. */
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const LOCAL_CORE = join(REPO_ROOT, CORE_SUBDIR)
const readJson = file => JSON.parse(readFileSync(file, 'utf8'))
const hasLocalCore = () => !checkCorePath(LOCAL_CORE, readJson)

/** Aide des listes de choix (celle de la bibliothèque est en anglais). */
const ARROWS = '(flèches pour choisir, Entrée pour valider)'

/** Annulation par Ctrl+C ou Échap pendant une question : rien n'a encore été créé. */
class Cancelled extends Error {}

/** Chemin tel qu'on l'affiche : relatif au dossier de départ quand c'est plus court. */
function shortPath(dir) {
  const rel = relative(START_DIR, dir)
  return rel && rel.length < dir.length ? rel : dir
}

/** Premier dossier parent qui est un espace de travail pnpm, ou undefined. Un projet client n'a rien à y faire. */
function enclosingWorkspace(dir) {
  for (let current = dirname(dir); ; current = dirname(current)) {
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) return current
    if (current === dirname(current)) return
  }
}

/**
 * Chemin réel d'un dossier qui n'existe pas encore : on suit les liens symboliques de ses parents existants
 * (sur macOS, /tmp désigne /private/tmp). Sans cela, un lien relatif vers le core partirait du mauvais endroit.
 */
function realParent(dir) {
  const missing = []
  let current = dir
  while (!existsSync(current) && dirname(current) !== current) {
    missing.unshift(basename(current))
    current = dirname(current)
  }
  try {
    return join(realpathSync(current), ...missing)
  }
  catch {
    return dir
  }
}

function checkDir(dir) {
  const problem = checkTargetDir(dir)
  if (problem) return problem
  const workspace = enclosingWorkspace(dir)
  if (workspace) return `${dir} est à l'intérieur du dépôt ${workspace} : un site client a son propre dossier, en dehors (exemple : ../${dir.split('/').pop()}).`
}

/**
 * Réunit les réponses : argument fourni → validé tel quel ; sinon question ; sinon (--yes, ou pas de terminal) valeur par défaut.
 * Un argument invalide arrête tout de suite, en mode interactif comme en script.
 */
async function collect(args) {
  const interactive = !args.yes && !!process.stdin.isTTY && !!process.stdout.isTTY
  const missing = []

  /**
   * @param given valeur reçue en argument (undefined : absente)
   * @param option nom de l'option, pour les messages
   * @param check validation → message ou undefined
   * @param ask question à poser → valeur
   * @param fallback valeur par défaut sans question (undefined : la réponse est obligatoire)
   */
  async function answer({ given, option, check, ask, fallback }) {
    if (given !== undefined) {
      const problem = check(given)
      if (problem) throw new UsageError(`${option} : ${problem}`)
      return given
    }
    if (interactive) {
      const value = await ask()
      if (p.isCancel(value)) throw new Cancelled()
      return value
    }
    const value = fallback?.()
    if (value === undefined) {
      missing.push(option)
      return undefined
    }
    const problem = check(value)
    if (problem) throw new UsageError(`${option} : ${problem}`)
    return value
  }
  const text = (message, options) => () => p.text({ message, ...options })

  const name = await answer({
    given: args.name, option: '--name', check: checkName,
    ask: text('Nom du site', { placeholder: 'Cabinet Durand', validate: checkName }),
  })
  if (name === undefined) throw new UsageError('Sans terminal interactif (ou avec --yes), --name est obligatoire.\nListe des options : pnpm create-site --help')
  const siteName = name.trim()

  const suggestedId = slugify(siteName)
  const id = await answer({
    given: args.id, option: '--id', check: checkId,
    ask: text('Identifiant technique (dossier, Worker, base D1 et bucket R2)', { initialValue: suggestedId, validate: checkId }),
    fallback: () => suggestedId,
  })

  const url = await answer({
    given: args.url, option: '--url', check: checkUrl,
    ask: text('Adresse du site en production (laisser vide si elle n\'est pas encore connue)', { placeholder: 'https://cabinet-durand.fr', validate: checkUrl }),
    fallback: () => '',
  })

  const localesText = await answer({
    given: args.locales, option: '--locales', check: checkLocales,
    ask: text('Langues du site, séparées par des virgules', { initialValue: 'fr', validate: checkLocales }),
    fallback: () => 'fr',
  })
  const locales = parseLocales(localesText)

  const defaultLocale = (await answer({
    given: args.defaultLocale, option: '--default-locale', check: v => checkDefaultLocale(v, locales),
    // Une seule langue : la question n'a pas lieu d'être.
    ask: () => (locales.length === 1
      ? locales[0]
      : p.select({ showInstructions: false, message: `Langue par défaut ${ARROWS}`, options: locales.map(l => ({ value: l, label: l })), initialValue: locales[0] })),
    fallback: () => locales[0],
  })).trim()

  const defaultDir = join(enclosingWorkspace(join(START_DIR, 'x')) ? dirname(enclosingWorkspace(join(START_DIR, 'x'))) : START_DIR, id ?? 'site')
  const toDir = value => realParent(resolve(START_DIR, String(value).trim()))
  const dir = toDir(await answer({
    given: args.dir, option: '--dir', check: v => checkDir(toDir(v)),
    ask: text('Dossier de destination', { initialValue: shortPath(defaultDir), validate: v => (String(v ?? '').trim() ? checkDir(toDir(v)) : 'Le dossier de destination est obligatoire.') }),
    fallback: () => defaultDir,
  }))

  const core = await answer({
    given: args.core, option: '--core', check: () => undefined,
    ask: () => p.select({
      showInstructions: false,
      message: `Comment le projet référence-t-il backoffice-core ? ${ARROWS}`,
      options: [
        { value: 'git', label: `Dépôt git github.com/${CORE_REPO}, à une version précise`, hint: 'le choix normal pour un site client' },
        { value: 'local', label: 'Lien vers un dossier local', hint: 'pour travailler sur le core en même temps que sur le site' },
      ],
      initialValue: 'git',
    }),
    fallback: () => 'git',
  })

  let coreRef
  let corePath
  if (core === 'git') {
    if (args.corePath !== undefined) throw new UsageError('--core-path ne s\'utilise qu\'avec --core local.')
    coreRef = await answer({
      given: args.coreRef, option: '--core-ref', check: checkGitRef,
      ask: text('Version du core (étiquette, branche ou commit)', { initialValue: defaultCoreRef(), validate: checkGitRef }),
      fallback: () => defaultCoreRef(),
    })
  }
  else {
    if (args.coreRef !== undefined) throw new UsageError('--core-ref ne s\'utilise qu\'avec --core git.')
    const toCore = value => realParent(resolve(START_DIR, String(value).trim()))
    const checkCore = v => checkCorePath(toCore(v), readJson)
    corePath = toCore(await answer({
      given: args.corePath, option: '--core-path', check: checkCore,
      ask: text('Dossier du core (celui qui contient le paquet backoffice-core)', { initialValue: hasLocalCore() ? shortPath(LOCAL_CORE) : '', validate: v => (String(v ?? '').trim() ? checkCore(v) : 'Le dossier du core est obligatoire.') }),
      fallback: () => (hasLocalCore() ? LOCAL_CORE : undefined),
      // (déjà un chemin complet : `resolve` le laisse tel quel)
    }))
  }

  const cloudflare = await answer({
    given: args.cloudflare, option: '--cloudflare', check: () => undefined,
    ask: () => p.confirm({ active: 'Oui', inactive: 'Non',
      message: args.dryRun
        ? 'Afficher les étapes Cloudflare (base D1, bucket R2, déploiement) ? Avec --dry-run, rien n\'est exécuté'
        : 'Créer tout de suite les ressources Cloudflare (base D1, bucket R2) et déployer ?',
      initialValue: false,
    }),
    fallback: () => false,
  })

  // Les étapes Cloudflare utilisent le wrangler du projet : elles exigent l'installation (sauf en --dry-run, où rien n'est lancé).
  const needsInstall = cloudflare && !args.dryRun
  if (needsInstall && args.install === false) throw new UsageError('--cloudflare a besoin des dépendances du projet : retirer --no-install.')
  const install = needsInstall
    ? true
    : await answer({
      given: args.install, option: '--install', check: () => undefined,
      ask: () => p.confirm({ active: 'Oui', inactive: 'Non', message: 'Installer les dépendances et préparer la base locale maintenant ?', initialValue: true }),
      fallback: () => true,
    })

  if (missing.length) throw new UsageError(`Sans terminal interactif, ces options sont obligatoires : ${missing.join(', ')}`)
  return {
    name: siteName, id, url: normalizeUrl(url), locales, defaultLocale, dir, core, coreRef, corePath, cloudflare, install,
    accountId: args.accountId, dryRun: args.dryRun, interactive,
  }
}

/** Affiche une commande avant de l'exécuter, puis l'exécute dans le dossier du projet. */
async function step(title, command, args, cwd) {
  p.log.step(`${title}\n$ ${shellLine(command, args)}`)
  return run(command, args, { cwd })
}

const bullet = lines => lines.map(l => `  ${l}`).join('\n')

export async function main(argv) {
  let args
  try {
    args = readArgs(argv)
  }
  catch (error) {
    if (!(error instanceof UsageError)) throw error
    console.error(error.message)
    return 2
  }
  if (args.help) {
    console.log(HELP)
    return 0
  }

  p.intro(`Nouveau site client${args.dryRun ? ' (--dry-run : aucune commande Cloudflare ne sera exécutée)' : ''}`)

  let answers
  try {
    answers = await collect(args)
  }
  catch (error) {
    if (error instanceof Cancelled) {
      p.cancel('Annulé : rien n\'a été créé.')
      return 130
    }
    if (error instanceof UsageError) {
      p.cancel(error.message)
      return 2
    }
    throw error
  }

  const { id, dir } = answers
  const cd = `cd ${shellLine(shortPath(dir))}`
  const done = []
  const next = []

  // 1. Fichiers du projet.
  let files
  try {
    files = generate(answers)
  }
  catch (error) {
    p.cancel(`Impossible de créer le projet dans ${dir} : ${error?.code === 'EACCES' || error?.code === 'EPERM' ? 'écriture refusée dans ce dossier.' : error?.message ?? error}`)
    return 1
  }
  p.log.success(`Projet créé dans ${dir} (${files.length} fichiers)\n${bullet([`backoffice-core : ${coreSpec(answers)}`])}`)
  done.push(`le projet « ${answers.name} » dans ${dir}`)

  // 2. Dépendances et base locale.
  let installed = false
  if (answers.install) {
    const install = await step('Installation des dépendances', 'pnpm', ['install'], dir)
    if (install.code !== 0) {
      p.log.error(`L'installation des dépendances a échoué (voir le message ci-dessus).${answers.core === 'git' ? `\nLe dépôt github.com/${CORE_REPO} est-il poussé et accessible ? Sinon, utiliser un lien local : voir README.md.` : ''}`)
      p.note([cd, 'pnpm install', 'pnpm db:migrate', 'pnpm dev'].join('\n'), 'Pour reprendre, une fois le problème corrigé')
      p.outro('Le projet est créé, mais ses dépendances ne sont pas installées.')
      return 1
    }
    const migrate = await step('Création de la base locale', 'pnpm', ['db:migrate'], dir)
    if (migrate.code !== 0) {
      p.log.error('La préparation de la base locale a échoué (voir le message ci-dessus).')
      p.note([cd, 'pnpm db:migrate', 'pnpm dev'].join('\n'), 'Pour reprendre, une fois le problème corrigé')
      p.outro('Le projet est créé et installé, mais sa base locale n\'est pas prête.')
      return 1
    }
    installed = true
    done.push('les dépendances et la base locale (dans .wrangler/)')
  }

  // 3. Cloudflare.
  let deployed
  if (answers.cloudflare) {
    const ui = {
      step: (title, line) => p.log.step(`${title}\n$ ${line}`),
      info: message => p.log.info(message),
      warn: message => p.log.warn(message),
      async pickAccount(accounts) {
        if (!answers.interactive) return undefined
        const picked = await p.select({ showInstructions: false, message: `Compte Cloudflare à utiliser ${ARROWS}`, options: accounts.map(a => ({ value: a.id, label: a.name, hint: a.id })) })
        return p.isCancel(picked) ? undefined : picked
      },
      async confirm(message) {
        if (!answers.interactive) return false
        const ok = await p.confirm({ active: 'Oui', inactive: 'Non', message, initialValue: false })
        return ok === true
      },
    }
    try {
      deployed = await runCloudflare(answers, ui, { dryRun: answers.dryRun })
      done.push(...deployed.created)
    }
    catch (error) {
      if (!(error instanceof StepError)) throw error
      p.log.error(error.message)
      const created = error.created.length ? `Déjà créé sur Cloudflare : ${error.created.join(', ')}.` : 'Rien n\'a été créé sur Cloudflare.'
      p.log.message(`Pour reprendre à la main, une fois le problème corrigé :\n${bullet([cd, ...manualCommands(answers, error.resumeFrom)])}`)
      p.outro(`Arrêt avant la fin des étapes Cloudflare. ${created} Le projet local, lui, est prêt : pnpm dev`)
      return 1
    }
  }

  // 4. Récapitulatif.
  next.push(cd)
  if (!installed) next.push('pnpm install', 'pnpm db:migrate      # crée la base locale')
  next.push('pnpm dev             # http://localhost:3000, back-office sur /admin')
  const sections = [`Créé :\n${bullet(done.map(d => `- ${d}`))}`, `Pour travailler en local :\n${bullet(next)}`]
  if (!deployed || deployed.dryRun) {
    sections.push(`Pour mettre en ligne${deployed?.dryRun ? ' (non exécuté : --dry-run)' : ''} :\n${bullet([...(installed ? [] : ['# après pnpm install']), 'pnpm exec wrangler login   # une fois par machine', ...manualCommands(answers)])}`)
  }
  else {
    sections.push(`En ligne :\n${bullet([deployed.url ?? 'adresse affichée par wrangler ci-dessus', 'Mises en ligne suivantes : pnpm run deploy'])}`)
  }
  const adminUrl = deployed?.url ? `${deployed.url}/admin` : '/admin'
  sections.push(
    `Premier compte administrateur :\n${bullet([
      `Ouvrir ${adminUrl} et créer le compte.`,
      'Tant qu\'aucun compte n\'existe, n\'importe qui peut le créer :',
      deployed?.url ? 'le faire maintenant, le site est déjà en ligne.' : 'le faire dès la mise en ligne, avant de communiquer l\'adresse.',
    ])}`,
  )
  // Pas d'encadré ici : il couperait les longues commandes, qu'on doit pouvoir copier telles quelles.
  p.log.message(`Récapitulatif\n\n${sections.join('\n\n')}`)
  p.outro(`Le site « ${answers.name} » est prêt. Le fichier README.md du projet détaille la suite.`)
  return 0
}

