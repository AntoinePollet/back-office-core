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

/** E2E_TARGET=node : les tests tournent sur la version « serveur Node » du core (fichier SQLite, disque, sharp). */
const target = env.E2E_TARGET || 'cloudflare'
if (target !== 'cloudflare' && target !== 'node') throw new Error(`E2E_TARGET doit valoir « cloudflare » ou « node » (reçu « ${target} »).`)

export const config = {
  testsDir,
  /** Hébergement testé : « cloudflare » (par défaut) ou « node ». */
  target,
  /**
   * En-tête qui porte l'adresse du visiteur : celui de Cloudflare, ou celui d'un serveur frontal devant un serveur
   * Node (le serveur de test est alors lancé avec NUXT_TRUST_PROXY=true).
   */
  ipHeader: target === 'node' ? 'x-forwarded-for' : 'cf-connecting-ip',
  /**
   * Une réponse publique du site porte-t-elle la bonne consigne de cache ? Chez Cloudflare, elle est gardée par le
   * réseau (`s-maxage`) ; sur un serveur Node, aucun cache partagé : elle doit être revérifiée à chaque fois.
   */
  siteCached: header => (target === 'node' ? header === 'public, max-age=0, must-revalidate' : /s-maxage=\d+/.test(header ?? '') && header.includes('max-age=0')),
  rootDir: path.resolve(testsDir, '..'),
  playgroundDir: path.resolve(testsDir, '..', 'playground'),
  /** Port du serveur de développement lancé pour les tests. */
  port,
  /** Port du faux service qui joue Brevo et les webhooks. */
  mockPort: number('E2E_MOCK_PORT', port + 10),
  chrome: findChrome(),
  /** E2E_HEADLESS=0 : affiche le navigateur pendant les tests. */
  headless: env.E2E_HEADLESS !== '0',
  /**
   * Délai maximal d'une attente dans le navigateur. Doublé en intégration continue (variable `CI`, posée par GitHub) :
   * ses machines sont environ deux fois plus lentes qu'un poste de développement, avec des à-coups, et une page
   * arrivée en retard ne doit pas passer pour un échec. Un vrai défaut échoue toujours, au bout de ce délai.
   */
  timeout: number('E2E_TIMEOUT', env.CI ? 20_000 : 10_000),
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
