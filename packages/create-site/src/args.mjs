import { parseArgs } from 'node:util'

/** Dépôt git du core, et sous-dossier du paquet dans ce dépôt. */
export const CORE_REPO = 'AntoinePollet/back-office-core'
export const CORE_SUBDIR = 'packages/cms'

export const HELP = `
Crée un nouveau site client qui étend backoffice-core.

  pnpm create-site [options]

Sans option, la commande pose les questions une à une. Chaque question peut aussi
recevoir sa réponse par une option : avec toutes les options, rien n'est demandé.

Le site
  --name <nom>              Nom du site, tel que le client le voit (« Cabinet Durand »)
  --id <identifiant>        Identifiant technique : dossier, Worker, base et bucket (défaut : tiré du nom)
  --url <adresse>           Adresse du site en production (--url "" si elle n'est pas encore connue)
  --locales <codes>         Langues du site, séparées par des virgules (défaut : fr)
  --default-locale <code>   Langue par défaut (défaut : la première)
  --dir <dossier>           Dossier de destination (défaut : à côté du dépôt du core, au nom de l'identifiant)

Le core
  --core <git|local>        Dépendance vers backoffice-core : dépôt git, ou lien vers un dossier local
  --core-ref <référence>    Avec --core git : étiquette de version, branche ou commit (défaut : la version du core, ex. v0.1.0)
  --core-path <dossier>     Avec --core local : dossier du core (défaut : packages/cms de ce dépôt)

L'hébergement
  --hosting <cloudflare|node>     cloudflare (défaut) : Workers, base D1, bucket R2.
                                  node : serveur Node dans un conteneur Docker (VPS, serveur du client, autre hébergeur),
                                  avec Dockerfile, docker-compose.yml et HEBERGEMENT.md.

Les étapes
  --install / --no-install        Installer les dépendances et préparer la base locale
  --cloudflare / --no-cloudflare  Créer la base D1, le bucket R2, puis déployer (hébergement cloudflare seulement)
  --account-id <identifiant>      Compte Cloudflare à utiliser, s'il y en a plusieurs
  --dry-run                       N'exécute aucune commande Cloudflare : affiche ce qui serait fait.
                                  Les fichiers du projet, eux, sont bien créés.
  -y, --yes                       Ne pose aucune question : prend la valeur par défaut des options absentes
  -h, --help                      Affiche cette aide

Exemple sans question :
  pnpm create-site --name "Cabinet Durand" --url https://cabinet-durand.fr --locales fr,en \\
    --core local --install --no-cloudflare --yes
`

const OPTIONS = {
  'name': { type: 'string' },
  'id': { type: 'string' },
  'url': { type: 'string' },
  'locales': { type: 'string' },
  'default-locale': { type: 'string' },
  'dir': { type: 'string' },
  'core': { type: 'string' },
  'core-ref': { type: 'string' },
  'core-path': { type: 'string' },
  'hosting': { type: 'string' },
  'install': { type: 'boolean' },
  'no-install': { type: 'boolean' },
  'cloudflare': { type: 'boolean' },
  'no-cloudflare': { type: 'boolean' },
  'account-id': { type: 'string' },
  'dry-run': { type: 'boolean' },
  'yes': { type: 'boolean', short: 'y' },
  'help': { type: 'boolean', short: 'h' },
}

/** Erreur de saisie : affichée telle quelle, sans trace technique. */
export class UsageError extends Error {}

/** Lit les arguments. Une option absente vaut `undefined` : la question sera posée (ou le défaut pris avec --yes). */
export function readArgs(argv) {
  let values
  try {
    // `pnpm create-site -- --name x` transmet parfois le séparateur « -- » : on l'ignore.
    ({ values } = parseArgs({ args: argv.filter(a => a !== '--'), options: OPTIONS, allowPositionals: false }))
  }
  catch (error) {
    throw new UsageError(`${translate(error)}\nListe des options : pnpm create-site --help`)
  }
  const flag = (name) => {
    if (values[name] && values[`no-${name}`]) throw new UsageError(`--${name} et --no-${name} ne vont pas ensemble.`)
    return values[name] ? true : values[`no-${name}`] ? false : undefined
  }
  if (values.core !== undefined && values.core !== 'git' && values.core !== 'local')
    throw new UsageError(`--core attend « git » ou « local » (reçu : ${values.core}).`)
  if (values.hosting !== undefined && values.hosting !== 'cloudflare' && values.hosting !== 'node')
    throw new UsageError(`--hosting attend « cloudflare » ou « node » (reçu : ${values.hosting}).`)
  if (values.hosting === 'node' && values.cloudflare) throw new UsageError('--cloudflare ne s\'utilise pas avec --hosting node.')
  if (values.hosting === 'node' && values['account-id'] !== undefined) throw new UsageError('--account-id ne s\'utilise pas avec --hosting node.')
  return {
    hosting: values.hosting,
    name: values.name,
    id: values.id,
    url: values.url,
    locales: values.locales,
    defaultLocale: values['default-locale'],
    dir: values.dir,
    core: values.core,
    coreRef: values['core-ref'],
    corePath: values['core-path'],
    install: flag('install'),
    cloudflare: flag('cloudflare'),
    accountId: values['account-id'],
    dryRun: !!values['dry-run'],
    yes: !!values.yes,
    help: !!values.help,
  }
}

function translate(error) {
  const message = String(error?.message ?? error)
  const unknown = message.match(/Unknown option '([^']+)'/)
  if (unknown) return `Option inconnue : ${unknown[1]}`
  const missing = message.match(/Option '([^']+)' argument missing/) ?? message.match(/Option '([^']+)'.*argument (?:is )?(?:missing|ambiguous)/)
  if (missing) return `L'option ${missing[1].split(',').pop().trim().split(' ')[0]} attend une valeur.`
  if (/does not take an argument/.test(message)) return `Cette option ne prend pas de valeur : ${message.match(/'([^']+)'/)?.[1] ?? ''}`
  if (/positional/i.test(message)) return `Argument inattendu : ${message.match(/'([^']+)'/)?.[1] ?? ''} (les valeurs avec des espaces se mettent entre guillemets).`
  return message
}
