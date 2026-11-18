import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CORE_REPO, CORE_SUBDIR } from './args.mjs'

export const TEMPLATE_DIR = fileURLToPath(new URL('../template', import.meta.url))

/**
 * Référence git proposée par défaut : l'étiquette de la version du core qui accompagne cette commande (« v0.1.0 »).
 * Un nouveau site est ainsi fixé sur une version précise, et ne change que quand on modifie ce numéro.
 */
export function defaultCoreRef() {
  try {
    const { version } = JSON.parse(readFileSync(fileURLToPath(new URL('../../cms/package.json', import.meta.url)), 'utf8'))
    return /^\d+\.\d+\.\d+/.test(version) ? `v${version}` : 'main'
  }
  catch {
    return 'main'
  }
}

/** Nom du bucket R2 de la médiathèque. */
export const bucketName = id => `${id}-media`

/**
 * Ce qu'on écrit dans package.json pour la dépendance `backoffice-core`.
 * - git : pnpm installe le sous-dossier du dépôt (`&path:/…`), à la référence demandée ;
 * - local : lien vers un dossier de la machine, relatif au projet.
 */
export function coreSpec(answers) {
  if (answers.core === 'git') return `github:${CORE_REPO}#${answers.coreRef}&path:/${CORE_SUBDIR}`
  const path = relative(answers.dir, answers.corePath).split(sep).join('/')
  // Trop de « ../ » : les deux dossiers n'ont rien de voisin, le chemin complet est plus lisible.
  if (path.startsWith('../../../../') || isAbsolute(path)) return `link:${answers.corePath}`
  return `link:${path.startsWith('.') ? path : `./${path}`}`
}

/** Chaîne TypeScript entre apostrophes, comme dans le reste du code. */
const tsString = value => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, '\\\'')}'`

/** La ligne `site: { … }` de cms.config.ts. */
export function siteTs(answers) {
  const parts = [
    `name: ${tsString(answers.name)}`,
    ...(answers.url ? [`url: ${tsString(answers.url)}`] : []),
    `locales: [${answers.locales.map(tsString).join(', ')}]`,
    `defaultLocale: ${tsString(answers.defaultLocale)}`,
  ]
  return `{ ${parts.join(', ')} }`
}

function tokens(answers) {
  return {
    __ID_JSON__: JSON.stringify(answers.id),
    __BUCKET_JSON__: JSON.stringify(bucketName(answers.id)),
    __SITE_NAME_JSON__: JSON.stringify(answers.name),
    __SITE_NAME__: answers.name,
    __ID__: answers.id,
    __BUCKET__: bucketName(answers.id),
    __SITE_TS__: siteTs(answers),
    __CORE_SPEC_JSON__: JSON.stringify(coreSpec(answers)),
    __CORE_SPEC__: coreSpec(answers),
    __CORE_GIT_SPEC__: coreSpec({ ...answers, core: 'git', coreRef: answers.coreRef ?? defaultCoreRef() }),
    __SITE_URL__: answers.url ?? 'https://exemple.fr',
  }
}

/** Fichiers du modèle dont le nom change à la copie (npm et pnpm traitent à part .gitignore et package.json). */
const RENAMES = { '_gitignore': '.gitignore', '_npmrc': '.npmrc', '_package.json': 'package.json' }

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

/** Copie le modèle dans le dossier de destination et y inscrit les réponses. Renvoie la liste des fichiers créés. */
export function generate(answers) {
  mkdirSync(answers.dir, { recursive: true })
  cpSync(TEMPLATE_DIR, answers.dir, { recursive: true })
  const values = tokens(answers)
  const pattern = new RegExp(Object.keys(values).sort((a, b) => b.length - a.length).join('|'), 'g')
  const created = []
  for (let file of walk(answers.dir)) {
    const renamed = RENAMES[file.slice(dirname(file).length + 1)]
    if (renamed) {
      renameSync(file, join(dirname(file), renamed))
      file = join(dirname(file), renamed)
    }
    const text = readFileSync(file, 'utf8')
    const out = text.replace(pattern, token => values[token])
    if (out !== text) writeFileSync(file, out)
    created.push(relative(answers.dir, file))
  }
  return created.sort()
}

/**
 * Inscrit l'identifiant de la base D1 dans wrangler.jsonc, sans toucher aux commentaires.
 * Renvoie false si la ligne `database_id` est introuvable.
 */
export function setDatabaseId(projectDir, databaseId) {
  const file = join(projectDir, 'wrangler.jsonc')
  if (!existsSync(file)) return false
  const text = readFileSync(file, 'utf8')
  const pattern = /("database_id"\s*:\s*)"[^"]*"/
  if (!pattern.test(text)) return false
  writeFileSync(file, text.replace(pattern, `$1${JSON.stringify(databaseId)}`))
  return true
}
