#!/usr/bin/env node
// Outil d'import de contenus du back-office : `backoffice-import [fichier]`, depuis le dossier du site.
// Le code est en TypeScript (cli/import.ts), comme le reste du core : il est chargé par jiti, que le core utilise déjà
// pour lire cms.config.ts. Cela marche que le core soit installé par lien local ou comme dépendance git.
import { createJiti } from 'jiti'

const { runImport, askInTerminal } = await createJiti(import.meta.url).import('../cli/import.ts')
process.exitCode = await runImport({
  cwd: process.cwd(),
  args: process.argv.slice(2),
  env: process.env,
  ask: process.stdin.isTTY && process.stdout.isTTY ? askInTerminal : undefined,
})
