#!/usr/bin/env node
import { main } from '../src/main.mjs'

main(process.argv.slice(2)).then(
  code => process.exit(code),
  (error) => {
    console.error(`\nErreur inattendue : ${error?.stack ?? error}`)
    process.exit(1)
  },
)
