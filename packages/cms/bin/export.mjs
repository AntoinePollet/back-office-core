#!/usr/bin/env node
// Export complet d'un site (réversibilité) : `backoffice-export`, depuis le dossier du site.
// Le code est en TypeScript (cli/export.ts), chargé par jiti comme l'outil d'import.
import { createJiti } from 'jiti'

const jiti = createJiti(import.meta.url)
const { runExport } = await jiti.import('../cli/export.ts')
const { askInTerminal } = await jiti.import('../cli/import.ts')
process.exitCode = await runExport({
  cwd: process.cwd(),
  args: process.argv.slice(2),
  env: process.env,
  ask: process.stdin.isTTY && process.stdout.isTTY ? askInTerminal : undefined,
})
