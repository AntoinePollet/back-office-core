import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { UsageError, readArgs } from '../src/args.mjs'
import {
  StepError, findJson, manualCommands, parseD1CreateOutput, parseD1List, parseDeployUrl, parseR2List, parseWhoami, plan,
  runCloudflare, saysWorkerMissing,
} from '../src/cloudflare.mjs'
import { coreSpec, generate, setDatabaseId, siteTs } from '../src/template.mjs'
import { checkDefaultLocale, checkId, checkLocales, checkName, checkTargetDir, checkUrl, normalizeUrl, parseLocales, slugify } from '../src/validate.mjs'

const ID = '1bbb60eb-1a21-4d4b-befa-d9ee17a44d7b'
const temp = () => mkdtempSync(join(tmpdir(), 'create-site-test-'))
const answers = (dir, more = {}) => ({
  name: 'L\'Atelier d\'Émilie', id: 'atelier-emilie', url: 'https://atelier-emilie.fr', locales: ['fr', 'en'], defaultLocale: 'fr',
  dir, core: 'git', coreRef: 'main', ...more,
})

test('identifiant tiré du nom', () => {
  assert.equal(slugify('Cabinet Durand & Fils'), 'cabinet-durand-fils')
  assert.equal(slugify('  L\'Atelier d\'Émilie  '), 'l-atelier-d-emilie')
  assert.equal(slugify('3 Cœurs'), 'coeurs')
  assert.equal(checkId(slugify('x'.repeat(200))), undefined)
})

test('validations', () => {
  assert.equal(checkName('Cabinet Durand'), undefined)
  assert.ok(checkName('   '))
  for (const ok of ['cabinet-durand', 'site2', 'abc']) assert.equal(checkId(ok), undefined, ok)
  for (const bad of ['', 'Cabinet', 'cabinet durand', '2sites', 'a--b', '-a', 'a-', 'ab', 'été', 'x'.repeat(51)]) assert.ok(checkId(bad), bad)
  for (const ok of ['', 'https://cabinet-durand.fr', 'https://cabinet-durand.fr/']) assert.equal(checkUrl(ok), undefined, ok)
  for (const bad of ['cabinet-durand.fr', 'ftp://x.fr', 'https://x.fr/page', 'https://x.fr/?a=1']) assert.ok(checkUrl(bad), bad)
  assert.equal(normalizeUrl('https://cabinet-durand.fr/'), 'https://cabinet-durand.fr')
  assert.equal(normalizeUrl(''), undefined)
  assert.deepEqual(parseLocales('fr, en;pt-BR'), ['fr', 'en', 'pt-BR'])
  assert.equal(checkLocales('fr,en'), undefined)
  for (const bad of ['', 'français', 'FR', 'fr,fr', 'fr,en-us']) assert.ok(checkLocales(bad), bad)
  assert.equal(checkDefaultLocale('en', ['fr', 'en']), undefined)
  assert.ok(checkDefaultLocale('de', ['fr', 'en']))
})

test('dossier de destination : libre ou vide', () => {
  const dir = temp()
  assert.equal(checkTargetDir(join(dir, 'nouveau')), undefined)
  assert.equal(checkTargetDir(dir), undefined)
  writeFileSync(join(dir, 'fichier'), '')
  assert.match(checkTargetDir(dir), /n'est pas vide/)
  assert.match(checkTargetDir(join(dir, 'fichier')), /n'est pas un dossier/)
  rmSync(dir, { recursive: true })
})

test('arguments', () => {
  const args = readArgs(['--name', 'Cabinet Durand', '--no-cloudflare', '--install', '--dry-run', '-y', '--url', ''])
  assert.deepEqual(
    { name: args.name, cloudflare: args.cloudflare, install: args.install, dryRun: args.dryRun, yes: args.yes, url: args.url, id: args.id },
    { name: 'Cabinet Durand', cloudflare: false, install: true, dryRun: true, yes: true, url: '', id: undefined },
  )
  assert.throws(() => readArgs(['--inconnu']), UsageError)
  assert.throws(() => readArgs(['--core', 'npm']), UsageError)
  assert.throws(() => readArgs(['--install', '--no-install']), UsageError)
  assert.throws(() => readArgs(['Cabinet']), UsageError)
})

test('dépendance vers le core', () => {
  assert.equal(coreSpec(answers('/sites/atelier')), 'github:AntoinePollet/back-office-core#main&path:/packages/cms')
  assert.equal(coreSpec(answers('/sites/atelier', { core: 'local', corePath: '/sites/back-office/packages/cms' })), 'link:../back-office/packages/cms')
  assert.equal(coreSpec(answers('/a/b/c/d/e', { core: 'local', corePath: '/x/cms' })), 'link:/x/cms')
})

test('projet généré : plus aucun marqueur, fichiers valides', () => {
  const dir = join(temp(), 'atelier')
  const files = generate(answers(dir))
  for (const expected of ['.gitignore', '.npmrc', 'README.md', 'cms.config.ts', 'nuxt.config.ts', 'package.json', 'tsconfig.json', 'wrangler.jsonc', 'app/pages/index.vue'])
    assert.ok(files.includes(expected), expected)
  assert.ok(!files.some(f => f.startsWith('_')))
  for (const file of files) assert.doesNotMatch(readFileSync(join(dir, file), 'utf8'), /__[A-Z_]+__/, file)
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  assert.equal(pkg.name, 'atelier-emilie')
  assert.equal(pkg.dependencies['backoffice-core'], 'github:AntoinePollet/back-office-core#main&path:/packages/cms')
  for (const script of ['dev', 'build', 'db:migrate', 'typecheck', 'deploy']) assert.ok(pkg.scripts[script], script)
  const wrangler = readFileSync(join(dir, 'wrangler.jsonc'), 'utf8')
  for (const part of ['"name": "atelier-emilie"', '"nodejs_compat"', '"cache": { "enabled": true }', '"binding": "DB"', '"binding": "MEDIA"', '"bucket_name": "atelier-emilie-media"', '"images"', 'node_modules/backoffice-core/server/database/migrations'])
    assert.ok(wrangler.includes(part), part)
  assert.match(readFileSync(join(dir, 'cms.config.ts'), 'utf8'), /site: \{ name: 'L\\'Atelier d\\'Émilie', url: 'https:\/\/atelier-emilie.fr', locales: \['fr', 'en'\], defaultLocale: 'fr' \}/)
  assert.equal(siteTs(answers(dir, { url: undefined, locales: ['fr'] })), '{ name: \'L\\\'Atelier d\\\'Émilie\', locales: [\'fr\'], defaultLocale: \'fr\' }')

  assert.equal(setDatabaseId(dir, ID), true)
  const patched = readFileSync(join(dir, 'wrangler.jsonc'), 'utf8')
  assert.ok(patched.includes(`"database_id": "${ID}"`))
  assert.ok(patched.includes('// Identifiant de la base'), 'les commentaires sont conservés')
  assert.equal(patched.replace(ID, '00000000-0000-0000-0000-000000000000'), wrangler)
  rmSync(dir, { recursive: true })
})

test('versions du modèle alignées sur le playground', () => {
  // Les marqueurs du modèle (__ID_JSON__…) sont remplacés par une valeur quelconque, le temps de lire le JSON.
  const read = path => JSON.parse(readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8').replace(/__[A-Z_]+__/g, '"x"'))
  const template = read('../template/_package.json')
  const playground = read('../../../playground/package.json')
  for (const group of ['dependencies', 'devDependencies']) {
    for (const [name, version] of Object.entries(playground[group])) {
      if (name === 'backoffice-core') continue
      assert.equal(template[group][name], version, `${name} : le modèle et le playground divergent`)
    }
  }
})

test('sortie de wrangler d1 create', () => {
  // Forme actuelle (wrangler 4, configuration JSON).
  assert.equal(parseD1CreateOutput(`
 ⛅️ wrangler 4.164.0
✅ Successfully created DB 'atelier-emilie' in region WEUR
Created your new D1 database.

To access your new D1 Database in your Worker, add the following snippet to your configuration file:
{
  "d1_databases": [
    {
      "binding": "atelier_emilie",
      "database_name": "atelier-emilie",
      "database_id": "${ID}"
    }
  ]
}`), ID)
  // Ancienne forme (TOML), avec couleurs.
  assert.equal(parseD1CreateOutput(`[[d1_databases]]\nbinding = "DB"\ndatabase_name = "x"\n\u001B[32mdatabase_id = "${ID.toUpperCase()}"\u001B[0m`), ID)
  // Forme inconnue mais un seul identifiant : accepté.
  assert.equal(parseD1CreateOutput(`Base créée : ${ID} (weur)`), ID)
  // Deux identifiants sans étiquette : on ne devine pas.
  assert.equal(parseD1CreateOutput(`compte 0a0a0a0a-1111-2222-3333-444444444444, base ${ID}`), undefined)
  assert.equal(parseD1CreateOutput('✘ [ERROR] A request to the Cloudflare API failed.'), undefined)
  assert.equal(parseD1CreateOutput(''), undefined)
})

test('autres sorties de wrangler', () => {
  assert.deepEqual(parseD1List(`▲ [WARNING] avertissement\n[\n  { "uuid": "${ID}", "name": "playground", "version": "production" }\n]`), [{ name: 'playground', id: ID }])
  assert.deepEqual(parseD1List('[]'), [])
  assert.equal(parseD1List('✘ [ERROR] Not logged in'), undefined)
  assert.deepEqual(parseR2List('Listing buckets...\nname:           playground-media\ncreation_date:  2026-01-01T00:00:00.000Z\n\nname:           autre\ncreation_date:  x\n'), ['playground-media', 'autre'])
  assert.deepEqual(parseWhoami('{ "loggedIn": true, "email": "a@b.fr", "accounts": [{ "id": "abc", "name": "Compte" }] }'), { loggedIn: true, email: 'a@b.fr', accounts: [{ id: 'abc', name: 'Compte' }] })
  assert.equal(parseWhoami('{ "loggedIn": false }').loggedIn, false)
  assert.equal(parseWhoami('n\'importe quoi'), undefined)
  assert.deepEqual(findJson('texte\n{ "a": [1, 2] }\nfin'), { a: [1, 2] })
  assert.ok(saysWorkerMissing('✘ [ERROR] A request to the Cloudflare API failed.\n  This Worker does not exist on your account. [code: 10007]'))
  assert.ok(!saysWorkerMissing('✘ [ERROR] Authentication error [code: 10000]'))
  assert.equal(parseDeployUrl('Deployed atelier triggers (1.2 sec)\n  https://atelier-emilie.compte.workers.dev\nCurrent Version ID: x'), 'https://atelier-emilie.compte.workers.dev')
})

// Faux wrangler : répond selon la commande, et note tout ce qui est lancé.
function fakeExec(replies, calls) {
  return async (command, args) => {
    const line = [command, ...args].join(' ')
    calls.push(line)
    const key = Object.keys(replies).find(k => line.includes(k))
    return key ? replies[key] : { code: 0, output: '' }
  }
}
const ui = (log = []) => ({ step: (t, l) => log.push(l), info: () => {}, warn: () => {}, pickAccount: async () => undefined, confirm: async () => false })
const HAPPY = {
  'whoami': { code: 0, output: '{ "loggedIn": true, "email": "a@b.fr", "accounts": [{ "id": "abc", "name": "Compte" }] }' },
  'd1 list': { code: 0, output: '[{ "uuid": "x", "name": "autre" }]' },
  'r2 bucket list': { code: 0, output: 'name: autre-media\n' },
  'deployments list': { code: 1, output: 'This Worker does not exist on your account. [code: 10007]' },
  'd1 create': { code: 0, output: `"database_id": "${ID}"` },
  'wrangler deploy': { code: 0, output: 'https://atelier-emilie.compte.workers.dev' },
}

test('--dry-run : rien n\'est lancé, tout est affiché', async () => {
  const calls = []
  const shown = []
  const result = await runCloudflare(answers('/nulle/part'), ui(shown), { dryRun: true, exec: fakeExec({}, calls) })
  assert.deepEqual(calls, [])
  assert.equal(result.dryRun, true)
  const all = plan(answers('/nulle/part'))
  assert.equal(shown.length, all.checks.length + all.steps.length)
  assert.ok(shown.includes('pnpm exec wrangler d1 create atelier-emilie --location weur --no-update-config'))
  assert.ok(shown.includes('pnpm exec wrangler r2 bucket create atelier-emilie-media --location weur'))
})

test('enchaînement complet (wrangler simulé)', async () => {
  const dir = join(temp(), 'atelier')
  generate(answers(dir))
  const calls = []
  const result = await runCloudflare(answers(dir), ui(), { exec: fakeExec(HAPPY, calls) })
  assert.equal(result.databaseId, ID)
  assert.equal(result.url, 'https://atelier-emilie.compte.workers.dev')
  assert.ok(readFileSync(join(dir, 'wrangler.jsonc'), 'utf8').includes(`"database_id": "${ID}"`))
  const order = ['whoami', 'd1 list', 'r2 bucket list', 'deployments list', 'd1 create', 'r2 bucket create', 'migrations apply DB --remote', 'pnpm build', 'wrangler deploy --secrets-file']
  assert.deepEqual(calls.map(c => order.find(o => c.includes(o))), order)
  rmSync(dir, { recursive: true })
})

test('arrêts : non connecté, nom déjà pris, échec en cours de route', async () => {
  const dir = join(temp(), 'atelier')
  generate(answers(dir))
  const attempt = async (replies) => {
    const calls = []
    const error = await runCloudflare(answers(dir), ui(), { exec: fakeExec({ ...replies, ...Object.fromEntries(Object.entries(HAPPY).filter(([k]) => !(k in replies))) }, calls) }).then(() => null, e => e)
    assert.ok(error instanceof StepError, 'un arrêt propre est attendu')
    return { error, created: calls.filter(c => / create | deploy --secrets| apply /.test(c)) }
  }
  let r = await attempt({ whoami: { code: 1, output: '{ "loggedIn": false }' } })
  assert.match(r.error.message, /pas connecté/)
  assert.deepEqual(r.created, [])

  r = await attempt({ 'd1 list': { code: 0, output: '[{ "uuid": "x", "name": "atelier-emilie" }]' } })
  assert.match(r.error.message, /base D1 nommée « atelier-emilie » existe déjà/)
  assert.deepEqual(r.created, [])

  r = await attempt({ 'r2 bucket list': { code: 0, output: 'name: atelier-emilie-media\n' } })
  assert.match(r.error.message, /bucket R2 nommé « atelier-emilie-media » existe déjà/)
  assert.deepEqual(r.created, [])

  r = await attempt({ 'deployments list': { code: 0, output: 'Created: …' } })
  assert.match(r.error.message, /Worker nommé « atelier-emilie » existe déjà/)
  assert.deepEqual(r.created, [])

  // Échec illisible de la vérification du Worker, et pas d'accord pour continuer : arrêt sans rien créer.
  r = await attempt({ 'deployments list': { code: 1, output: 'fetch failed' } })
  assert.match(r.error.message, /arrêt par précaution/)
  assert.deepEqual(r.created, [])

  r = await attempt({ 'r2 bucket create': { code: 1, output: 'erreur' } })
  assert.equal(r.error.resumeFrom, 'r2-create')
  assert.deepEqual(r.error.created, ['base D1 « atelier-emilie »'])
  assert.equal(manualCommands(answers(dir), r.error.resumeFrom)[0], 'pnpm exec wrangler r2 bucket create atelier-emilie-media --location weur')
  assert.equal(r.created.length, 2, 'rien n\'est lancé après l\'échec')

  // Identifiant de base illisible, y compris dans la liste : la base est créée mais on s'arrête avant la suite.
  r = await attempt({ 'd1 create': { code: 0, output: 'créée' } })
  assert.match(r.error.message, /n'a pas pu être reporté/)
  assert.equal(r.error.resumeFrom, 'r2-create')
  rmSync(dir, { recursive: true })
})

test('identifiant de base retrouvé dans la liste quand la sortie de création est illisible', async () => {
  const dir = join(temp(), 'atelier')
  generate(answers(dir))
  let lists = 0
  const exec = async (command, args) => {
    const line = [command, ...args].join(' ')
    if (line.includes('d1 list')) return { code: 0, output: lists++ ? `[{ "uuid": "${ID}", "name": "atelier-emilie" }]` : '[]' }
    if (line.includes('d1 create')) return { code: 0, output: 'sortie d\'une version future' }
    return fakeExec(HAPPY, [])(command, args)
  }
  const result = await runCloudflare(answers(dir), ui(), { exec })
  assert.equal(result.databaseId, ID)
  rmSync(dir, { recursive: true })
})
