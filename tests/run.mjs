#!/usr/bin/env node
// Lanceur des tests de bout en bout.
//   node tests/run.mjs                 toutes les suites
//   node tests/run.mjs roles site      seulement les suites dont le nom contient « roles » ou « site »
//   node tests/run.mjs --liste         noms des suites
// Pour chaque suite : base locale vide, serveur de développement du playground, compte administrateur, tests, arrêt du serveur.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { config } from './lib/config.mjs'
import { writeFixtures } from './lib/fixtures.mjs'
import { ensureDir, runSuite } from './lib/harness.mjs'
import { startMock } from './lib/mock.mjs'
import { createAdmin, killStarted, resetDatabase, startServer } from './lib/server.mjs'

const suitesDir = path.join(config.testsDir, 'suites')
const all = fs.readdirSync(suitesDir).filter(f => f.endsWith('.mjs')).sort().map(f => ({ name: f.replace(/\.mjs$/, ''), file: path.join(suitesDir, f) }))
const args = process.argv.slice(2).filter(a => a !== '--')

if (args.includes('--liste') || args.includes('--list')) {
  for (const s of all) console.log(s.name)
  process.exit(0)
}
const unknown = args.filter(a => a.startsWith('-') || !all.some(s => s.name.includes(a)))
if (unknown.length) {
  console.error(`Suite inconnue : ${unknown.join(', ')}\nSuites disponibles : ${all.map(s => s.name).join(', ')}`)
  process.exit(2)
}
const selected = args.length ? all.filter(s => args.some(a => s.name.includes(a))) : all

// Interruption (Ctrl+C, arrêt demandé) ou erreur inattendue : le serveur lancé ne doit pas rester derrière nous.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    console.error(`\nInterrompu (${signal}) : arrêt du serveur de test.`)
    killStarted()
    process.exit(130)
  })
}
process.on('uncaughtException', (e) => { console.error(e); killStarted(); process.exit(1) })
process.on('unhandledRejection', (e) => { console.error(e); killStarted(); process.exit(1) })
process.on('exit', killStarted)

const seconds = ms => (ms / 1000).toFixed(1).replace('.', ',') + ' s'
const rel = file => path.relative(process.cwd(), file)

fs.rmSync(config.resultsDir, { recursive: true, force: true })
ensureDir(config.resultsDir)
const fixture = writeFixtures(path.join(config.tmpDir, 'fichiers'))

console.log(`Tests de bout en bout — ${selected.length} suite${selected.length > 1 ? 's' : ''}, serveur sur le port ${config.port}`)
const results = []
const startedAt = Date.now()

for (const { name, file } of selected) {
  const start = Date.now()
  const module = await import(pathToFileURL(file).href)
  const meta = module.meta ?? {}
  console.log(`\n▶ ${name}${meta.title ? ' — ' + meta.title : ''}`)
  const logFile = path.join(config.resultsDir, `${name}-serveur.log`)
  let server, mock, steps
  try {
    const persistDir = resetDatabase(path.join(config.resultsDir, `${name}-base.log`))
    if (meta.mock) mock = await startMock(config.mockPort)
    const env = typeof meta.env === 'function' ? meta.env({ mock: mock?.url ?? null }) : meta.env ?? {}
    server = await startServer({ persistDir, env, logFile })
    await createAdmin(server.base)
    console.log(`  serveur prêt  (${seconds(Date.now() - start)})`)
    steps = await runSuite(module.default, { name, base: server.base, mock, fixture })
  }
  catch (e) {
    // La suite n'a pas pu démarrer (port occupé, serveur en panne…).
    const message = String(e?.message ?? e).split('\n')[0]
    console.log(`  ÉCHEC  préparation → ${message}`)
    steps = [{ title: 'préparation', ok: false, message }]
  }
  finally {
    await server?.stop()
    await mock?.close()
  }
  const failed = steps.filter(s => !s.ok)
  results.push({ name, steps, failed, ms: Date.now() - start })
  if (failed.length && fs.existsSync(logFile)) console.log(`  journal du serveur : ${rel(logFile)}`)
}

console.log('\n──────── Résumé ────────')
for (const r of results) {
  console.log(`${r.failed.length ? 'ÉCHEC' : 'ok   '}  ${r.name.padEnd(22)} ${String(r.steps.length - r.failed.length).padStart(2)}/${r.steps.length} étapes  ${seconds(r.ms)}`)
  for (const f of r.failed) console.log(`         ✗ ${f.title} → ${f.message}`)
}
const failedSteps = results.reduce((n, r) => n + r.failed.length, 0)
const totalSteps = results.reduce((n, r) => n + r.steps.length, 0)
console.log(failedSteps
  ? `\n${failedSteps} étape${failedSteps > 1 ? 's' : ''} en échec sur ${totalSteps} (${seconds(Date.now() - startedAt)}). Captures et journaux : ${rel(config.resultsDir)}`
  : `\nTout passe : ${totalSteps} étapes dans ${results.length} suite${results.length > 1 ? 's' : ''} (${seconds(Date.now() - startedAt)}).`)
process.exit(failedSteps ? 1 : 0)
