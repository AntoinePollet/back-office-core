import { spawn } from 'node:child_process'

/**
 * Lance une commande et attend sa fin. La sortie est affichée au fil de l'eau (sauf `quiet`) et renvoyée.
 * L'entrée est fermée : wrangler et pnpm ne posent alors aucune question et prennent leurs réponses par défaut.
 */
export function run(command, args, { cwd, env, quiet = false } = {}) {
  return new Promise((resolve) => {
    let output = ''
    let child
    try {
      child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    }
    catch (error) {
      return resolve({ code: 127, output: String(error?.message ?? error) })
    }
    const onData = stream => (chunk) => {
      output += chunk
      if (!quiet) stream.write(chunk)
    }
    child.stdout.on('data', onData(process.stdout))
    child.stderr.on('data', onData(process.stderr))
    child.on('error', error => resolve({ code: 127, output: output + String(error?.message ?? error) }))
    child.on('close', (code, signal) => resolve({ code: code ?? (signal ? 130 : 1), output }))
  })
}

/** Écriture d'une commande telle qu'on la taperait : les arguments avec des espaces sont entre guillemets. */
export function shellLine(command, args = []) {
  return [command, ...args].map(a => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${String(a).replace(/'/g, `'\\''`)}'`)).join(' ')
}
