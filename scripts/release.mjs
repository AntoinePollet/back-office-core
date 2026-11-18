#!/usr/bin/env node
// Publie une nouvelle version du core : `pnpm release patch|minor|major` (ou un numéro exact, `pnpm release 1.2.0`).
//
// - vérifie que le dépôt est propre, sur `main`, et que les tests rapides passent ;
// - inscrit le numéro dans packages/cms et packages/create-site ;
// - crée le commit « Version x.y.z » et l'étiquette git `vx.y.z`.
//
// Rien n'est envoyé sur GitHub : la commande affiche à la fin celle qui le fait. Tant que l'étiquette n'est pas
// poussée, un site ne peut pas installer cette version.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const root = new URL('..', import.meta.url)
const run = (cmd, args, options = {}) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...options }).trim()
const fail = (message) => { console.error(`\n✗ ${message}`); process.exit(1) }

const packages = ['packages/cms/package.json', 'packages/create-site/package.json']
const read = file => JSON.parse(readFileSync(new URL(file, root), 'utf8'))
const current = read(packages[0]).version

const [wanted, ...flags] = process.argv.slice(2)
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
  fail(`Version actuelle : ${current}\nUsage : pnpm release patch|minor|major|x.y.z [--sans-tests]\n`
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
run('git', ['add', ...packages])
run('git', ['commit', '-q', '-m', `Version ${version}`])
run('git', ['tag', '-a', tag, '-m', `Version ${version}`])

console.log(`\n✓ Version ${version} créée (commit et étiquette ${tag}), pas encore envoyée.`)
console.log('\nPour la rendre installable par les sites :\n  git push --follow-tags\n')
console.log(`Pour mettre un site à jour : remplacer le numéro dans son package.json (…#${tag}&path:/packages/cms), puis pnpm install.`)
