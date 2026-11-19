#!/usr/bin/env node
// Publie une nouvelle version du core : `pnpm release patch|minor|major` (ou un numéro exact, `pnpm release 1.2.0`).
//
// - vérifie que le dépôt est propre, sur `main`, et que les tests rapides passent ;
// - exige des notes de version : la section « À venir » de CHANGELOG.md ne doit pas être vide ;
// - inscrit le numéro dans packages/cms et packages/create-site, et range « À venir » sous ce numéro ;
// - crée le commit « Version x.y.z » et l'étiquette git `vx.y.z`.
//
// Rien n'est envoyé sur GitHub : la commande affiche à la fin celles qui le font. Tant que l'étiquette n'est pas
// poussée, un site ne peut pas installer cette version ; tant que la « release » GitHub n'existe pas, les sites
// ne sont pas prévenus (voir docs/publier-une-version.md).
//
// `node scripts/release.mjs notes [x.y.z]` affiche les notes d'une version (par défaut la version actuelle).
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { pendingNotes, releaseNotes, stampRelease } from './changelog.mjs'

const root = new URL('..', import.meta.url)
const run = (cmd, args, options = {}) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...options }).trim()
const fail = (message) => { console.error(`\n✗ ${message}`); process.exit(1) }

const packages = ['packages/cms/package.json', 'packages/create-site/package.json']
const read = file => JSON.parse(readFileSync(new URL(file, root), 'utf8'))
const current = read(packages[0]).version

const CHANGELOG = 'CHANGELOG.md'
const changelog = () => readFileSync(new URL(CHANGELOG, root), 'utf8')

const [wanted, ...flags] = process.argv.slice(2)

// Notes d'une version, sur la sortie standard : sert à créer la « release » GitHub.
if (wanted === 'notes') {
  const version = (flags[0] ?? current).replace(/^v/, '')
  const notes = releaseNotes(changelog(), version)
  if (!notes) fail(`Pas de notes pour la version ${version} dans ${CHANGELOG}.`)
  console.log(notes)
  process.exit(0)
}
const skipTests = flags.includes('--sans-tests')

function next(version, kind) {
  if (/^\d+\.\d+\.\d+$/.test(kind)) return kind
  const [major, minor, patch] = version.split('.').map(Number)
  if (kind === 'major') return `${major + 1}.0.0`
  if (kind === 'minor') return `${major}.${minor + 1}.0`
  if (kind === 'patch') return `${major}.${minor}.${patch + 1}`
  return null
}

const version = wanted ? next(current, wanted) : null
if (!version) {
  fail(`Version actuelle : ${current}\nUsage : pnpm release patch|minor|major|x.y.z [--sans-tests]\n        pnpm release notes [x.y.z]\n`
    + '  patch : corrections sans changement visible pour les sites\n'
    + '  minor : nouvelles fonctions, les sites existants continuent de marcher\n'
    + '  major : changement qui demande d\'adapter les sites existants')
}
const compare = (a, b) => a.split('.').map(Number).reduce((r, n, i) => r || n - Number(b.split('.')[i]), 0)
if (compare(version, current) <= 0) fail(`La version ${version} n'est pas supérieure à la version actuelle (${current}).`)

const tag = `v${version}`
if (run('git', ['status', '--porcelain'])) fail('Le dépôt contient des modifications non enregistrées : faites un commit d\'abord.')
if (run('git', ['branch', '--show-current']) !== 'main') fail('Une version se publie depuis la branche main.')
if (run('git', ['tag', '--list', tag])) fail(`L'étiquette ${tag} existe déjà.`)

if (!pendingNotes(changelog())) {
  fail(`Pas de notes de version : la section « ## À venir » de ${CHANGELOG} est vide.\n`
    + 'Décrivez-y ce qui change pour un site (### Nouveautés, ### Correctifs, ### À faire dans votre site), faites un commit, puis relancez.')
}

if (!skipTests) {
  console.log('Tests unitaires et vérification des types…')
  try { execFileSync('pnpm', ['test:unit'], { cwd: root, stdio: 'inherit' }); execFileSync('pnpm', ['typecheck'], { cwd: root, stdio: 'inherit' }) }
  catch { fail('Les tests ne passent pas : aucune version créée.') }
}

for (const file of packages) {
  const url = new URL(file, root)
  // Remplacement ciblé : le reste du fichier garde exactement sa mise en forme.
  const text = readFileSync(url, 'utf8')
  const updated = text.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`)
  if (updated === text) fail(`Numéro de version introuvable dans ${file}.`)
  writeFileSync(url, updated)
}
writeFileSync(new URL(CHANGELOG, root), stampRelease(changelog(), version, new Date().toISOString().slice(0, 10)))
run('git', ['add', ...packages, CHANGELOG])
run('git', ['commit', '-q', '-m', `Version ${version}`])
run('git', ['tag', '-a', tag, '-m', `Version ${version}`])

console.log(`\n✓ Version ${version} créée (commit et étiquette ${tag}), pas encore envoyée.`)
console.log('\n1. La rendre installable par les sites :\n     git push --follow-tags')
console.log('\n2. Publier ses notes (la « release » GitHub prévient les sites : demande de fusion automatique, avis dans le back-office).')
console.log('   Le flux « Publier la version » du dépôt le fait tout seul quand l\'étiquette arrive sur GitHub. À la main :')
console.log(`     node scripts/release.mjs notes ${version} | gh release create ${tag} --verify-tag --title "Version ${version}" --notes-file -`)
console.log(`\nSans automatisation, un site se met à jour en remplaçant le numéro dans son package.json (…#${tag}&path:/packages/cms), puis pnpm install.`)
