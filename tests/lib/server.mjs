// Base locale vide et serveur de développement du playground, lancés et arrêtés pour chaque suite.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { config } from './config.mjs'

const wait = ms => new Promise(r => setTimeout(r, ms))

/** Processus lancés par ce lanceur et pas encore arrêtés : ce sont les seuls qu'il se permet de tuer. */
const started = new Set()

function connects(port, host) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host })
    socket.setTimeout(1000)
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', () => resolve(false))
    socket.once('timeout', () => { socket.destroy(); resolve(false) })
  })
}
/** Quelqu'un écoute-t-il sur ce port (en IPv4 ou en IPv6) ? */
export async function portBusy(port) {
  return (await Promise.all([connects(port, '127.0.0.1'), connects(port, '::1')])).some(Boolean)
}

function bin(name) {
  const file = path.join(config.playgroundDir, 'node_modules', '.bin', name)
  if (!fs.existsSync(file)) throw new Error(`${name} introuvable : lancez « pnpm install » à la racine du dépôt.`)
  return file
}

/**
 * Recrée une base locale vide dans le dossier temporaire des tests.
 * La base de développement habituelle (playground/.wrangler) n'est pas touchée.
 * Renvoie le dossier à donner au serveur.
 */
export function resetDatabase(logFile) {
  const stateDir = path.join(config.tmpDir, 'etat')
  fs.rmSync(stateDir, { recursive: true, force: true })
  fs.mkdirSync(stateDir, { recursive: true })
  const r = spawnSync(bin('wrangler'), ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', stateDir], {
    cwd: config.playgroundDir,
    env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
    encoding: 'utf8',
  })
  fs.writeFileSync(logFile, `${r.stdout ?? ''}${r.stderr ?? ''}`)
  if (r.status !== 0) throw new Error(`La création de la base de test a échoué (voir ${path.relative(config.rootDir, logFile)}).`)
  // Wrangler range ses données dans un sous-dossier « v3 » : c'est lui que le serveur doit lire.
  return path.join(stateDir, 'v3')
}

function groupAlive(pid) {
  try { process.kill(-pid, 0); return true }
  catch { return false }
}
function signalGroup(pid, signal) {
  try { process.kill(-pid, signal) }
  catch { /* déjà terminé */ }
}

/**
 * Démarre `nuxt dev` dans le playground et attend qu'il réponde.
 * Le serveur a son propre groupe de processus : l'arrêter arrête aussi ses enfants (workerd, esbuild…), et rien d'autre.
 */
export async function startServer({ persistDir, env = {}, logFile }) {
  const { port } = config
  if (await portBusy(port)) throw new Error(`Le port ${port} est déjà utilisé. Arrêtez ce qui l'occupe ou choisissez-en un autre avec E2E_PORT.`)

  const log = fs.openSync(logFile, 'w')
  const child = spawn(bin('nuxt'), ['dev', '--port', String(port), '--no-open'], {
    cwd: config.playgroundDir,
    env: { ...process.env, NUXT_WRANGLER_PERSIST_DIR: persistDir, NUXT_TELEMETRY_DISABLED: '1', ...env },
    stdio: ['ignore', log, log],
    detached: true,
  })
  fs.closeSync(log)
  started.add(child.pid)
  let exited = null
  child.once('exit', (code, signal) => { exited = { code, signal } })
  const spawnError = new Promise((_, reject) => child.once('error', reject))

  const base = `http://localhost:${port}`
  const server = { base, pid: child.pid, logFile, stop: () => stopServer(child, () => exited) }
  const ready = (async () => {
    const deadline = Date.now() + config.serverTimeout
    while (Date.now() < deadline) {
      if (exited) throw new Error(`Le serveur s'est arrêté pendant son démarrage (voir ${path.relative(config.rootDir, logFile)}).`)
      // Cette route lit la base : quand elle répond, Nuxt et les liaisons Cloudflare locales sont prêts.
      const ok = await fetch(`${base}/api/cms/setup`, { signal: AbortSignal.timeout(30_000) }).then(r => r.ok, () => false)
      if (ok) return
      await wait(500)
    }
    throw new Error(`Le serveur n'a pas répondu en ${Math.round(config.serverTimeout / 1000)} s (voir ${path.relative(config.rootDir, logFile)}).`)
  })()
  try {
    await Promise.race([ready, spawnError])
  }
  catch (e) {
    await server.stop()
    throw e
  }
  return server
}

async function stopServer(child, exited) {
  const pid = child.pid
  if (!pid || !started.has(pid)) return
  signalGroup(pid, 'SIGTERM')
  for (let i = 0; i < 50 && groupAlive(pid); i++) await wait(100)
  if (groupAlive(pid)) {
    signalGroup(pid, 'SIGKILL')
    for (let i = 0; i < 30 && groupAlive(pid); i++) await wait(100)
  }
  if (!exited()) await new Promise(resolve => child.once('exit', resolve))
  started.delete(pid)
  // Le port doit être rendu avant de lancer la suite suivante.
  for (let i = 0; i < 50 && await portBusy(config.port); i++) await wait(100)
}

/** Dernier recours (interruption, erreur inattendue) : arrêt immédiat de tout ce que ce lanceur a démarré. */
export function killStarted() {
  for (const pid of started) signalGroup(pid, 'SIGKILL')
  started.clear()
}

/** Crée le premier compte, administrateur. */
export async function createAdmin(base) {
  const r = await fetch(`${base}/api/cms/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify(config.admin),
    signal: AbortSignal.timeout(30_000),
  })
  if (!r.ok) throw new Error(`Création du compte administrateur refusée (${r.status}) : ${(await r.text()).slice(0, 200)}`)
}
