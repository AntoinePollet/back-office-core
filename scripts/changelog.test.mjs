import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { PENDING_TEMPLATE, hasContent, pendingNotes, releaseNotes, stampRelease } from './changelog.mjs'

const FILE = `# Notes de version

Texte d'introduction.

${PENDING_TEMPLATE}
### Correctifs

- Le menu ne clignote plus.

### À faire dans votre site

- Relancer \`pnpm db:migrate\`.

## 0.5.0 — 2026-11-19

### Nouveautés

- Dossiers dans la médiathèque.

## 0.4.1 — 2026-11-19

- Correction de l'hydratation.
`

test('notes d\'une version : la section, sans son titre ni les sections voisines', () => {
  assert.equal(releaseNotes(FILE, '0.5.0'), '### Nouveautés\n\n- Dossiers dans la médiathèque.')
  assert.equal(releaseNotes(FILE, 'v0.4.1'), '- Correction de l\'hydratation.')
  assert.equal(releaseNotes(FILE, '0.5'), null, '« 0.5 » ne désigne pas « 0.5.0 »')
  assert.equal(releaseNotes(FILE, '0.4'), null)
  assert.equal(releaseNotes(FILE, '9.9.9'), null)
  assert.equal(releaseNotes('## 1.0.0 — 2026-01-01\n\n### Nouveautés\n\n## 0.9.0\n- x\n', '1.0.0'), null, 'des titres seuls ne sont pas des notes')
})

test('« À venir » : vide tant que rien n\'y est écrit', () => {
  assert.equal(pendingNotes(`# Notes\n\n${PENDING_TEMPLATE}\n## 0.5.0\n\n- x\n`), null)
  assert.equal(pendingNotes('# Notes\n\n## 0.5.0\n\n- x\n'), null)
  assert.equal(pendingNotes(FILE), '### Correctifs\n\n- Le menu ne clignote plus.\n\n### À faire dans votre site\n\n- Relancer `pnpm db:migrate`.')
  assert.equal(hasContent('### Nouveautés\n\n<!-- rien -->\n'), false)
})

test('publication : « À venir » devient la version, une section vide la remplace', () => {
  const out = stampRelease(FILE, '0.5.1', '2026-11-20')
  assert.equal(pendingNotes(out), null)
  assert.equal(releaseNotes(out, '0.5.1'), pendingNotes(FILE))
  assert.equal(releaseNotes(out, '0.5.0'), releaseNotes(FILE, '0.5.0'))
  assert.ok(out.startsWith('# Notes de version\n\nTexte d\'introduction.\n\n## À venir\n'))
  assert.ok(out.indexOf('## À venir') < out.indexOf('## 0.5.1 — 2026-11-20') && out.indexOf('## 0.5.1') < out.indexOf('## 0.5.0'))
  assert.ok(out.endsWith('- Correction de l\'hydratation.\n'))
  // Publier deux fois de suite : la seconde est refusée, il n'y a plus rien à publier.
  assert.throws(() => stampRelease(out, '0.5.2', '2026-11-21'), /vide ou absente/)
  assert.throws(() => stampRelease(FILE, '0.5.0', '2026-11-21'), /contient déjà/)
})

test('CHANGELOG.md du dépôt : des notes pour la version en cours et toutes les précédentes', () => {
  const text = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
  const { version } = JSON.parse(readFileSync(new URL('../packages/cms/package.json', import.meta.url), 'utf8'))
  assert.ok(releaseNotes(text, version), `pas de notes pour la version ${version}`)
  for (const v of ['0.1.0', '0.2.0', '0.3.0', '0.4.0', '0.4.1', '0.5.0']) assert.ok(releaseNotes(text, v), v)
  assert.ok(text.includes('## À venir'), 'section « À venir » absente')
})
