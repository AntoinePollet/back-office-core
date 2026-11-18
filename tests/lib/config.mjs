// Réglages de la suite de tests. Tout se change par variable d'environnement (voir tests/README.md).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const testsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const env = process.env

function number(name, fallback) {
  if (env[name] === undefined || env[name] === '') return fallback
  const n = Number(env[name])
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} doit être un entier positif (reçu « ${env[name]} »).`)
  return n
}

/** Chrome ou Chromium installé sur la machine : E2E_CHROME, sinon les emplacements habituels. */
function findChrome() {
  if (env.E2E_CHROME) return env.E2E_CHROME
  const candidates = {
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'],
    linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
    win32: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'],
  }[process.platform] ?? []
  return candidates.find(p => fs.existsSync(p)) ?? null
}

const port = number('E2E_PORT', 3121)

export const config = {
  testsDir,
  rootDir: path.resolve(testsDir, '..'),
  playgroundDir: path.resolve(testsDir, '..', 'playground'),
  /** Port du serveur de développement lancé pour les tests. */
  port,
  /** Port du faux service qui joue Brevo et les webhooks. */
  mockPort: number('E2E_MOCK_PORT', port + 10),
  chrome: findChrome(),
  /** E2E_HEADLESS=0 : affiche le navigateur pendant les tests. */
  headless: env.E2E_HEADLESS !== '0',
  /** Délai maximal d'une attente dans le navigateur. */
  timeout: number('E2E_TIMEOUT', 10_000),
  /** Délai maximal de démarrage du serveur (première compilation comprise). */
  serverTimeout: number('E2E_SERVER_TIMEOUT', 180_000),
  /** E2E_CAPTURES=1 : garde aussi les captures d'écran des étapes réussies. */
  captures: env.E2E_CAPTURES === '1',
  /** Captures d'écran et journaux du serveur. */
  resultsDir: path.resolve(env.E2E_RESULTS ?? path.join(testsDir, 'resultats')),
  /** Base locale, fichiers importés : effacés avant chaque suite. */
  tmpDir: path.join(testsDir, '.tmp'),
  /** Compte administrateur créé avant chaque suite. */
  admin: { name: 'Claire Durand', email: 'claire@example.com', password: 'motdepasse-test-1' },
}
