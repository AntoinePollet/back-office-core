import assert from 'node:assert/strict'
import { test } from 'node:test'
import { roleCan, userCan } from './access.ts'
import { collection, defineCms, f, singleton } from './format.ts'

const fields = { title: f.text({ label: 'Titre' }) }

test('droits par défaut : le rédacteur prépare, l\'éditeur publie et supprime, l\'administrateur fait tout', () => {
  const def = { drafts: true }
  assert.deepEqual(['edit', 'publish', 'delete'].map(a => roleCan(def, 'writer', a as 'edit')), [true, false, false])
  assert.deepEqual(['edit', 'publish', 'delete'].map(a => roleCan(def, 'editor', a as 'edit')), [true, true, true])
  assert.deepEqual(['edit', 'publish', 'delete'].map(a => roleCan({ adminOnly: true }, 'admin', a as 'edit')), [true, true, true])
})

test('adminOnly ferme tout aux autres rôles', () => {
  for (const role of ['editor', 'writer'] as const)
    for (const action of ['edit', 'publish', 'delete'] as const) assert.equal(roleCan({ adminOnly: true }, role, action), false)
})

test('sans brouillons, modifier demande le droit de publier', () => {
  assert.equal(roleCan({ drafts: false }, 'writer', 'edit'), false)
  assert.equal(roleCan({ drafts: false }, 'editor', 'edit'), true)
  assert.equal(roleCan({ drafts: false, access: { publish: ['editor', 'writer'] } }, 'writer', 'edit'), true)
})

test('access accorde ou retire un droit par rôle', () => {
  const selfPublish = { drafts: true, access: { publish: ['editor', 'writer'] as const } }
  assert.equal(roleCan(selfPublish, 'writer', 'publish'), true)
  assert.equal(roleCan(selfPublish, 'writer', 'delete'), false)
  const editorsOnly = { drafts: true, access: { edit: ['editor'] as const } }
  assert.equal(roleCan(editorsOnly, 'writer', 'edit'), false)
  assert.equal(roleCan(editorsOnly, 'editor', 'publish'), true)
  // Un droit de publier sans droit de modifier ne donne rien.
  assert.equal(roleCan({ drafts: true, access: { edit: [], publish: ['editor'] } }, 'editor', 'publish'), false)
})

test('contenus attribués : la limite s\'ajoute au rôle, sauf pour un administrateur', () => {
  const def = { drafts: true }
  assert.equal(userCan({ role: 'editor', types: ['services'] }, 'services', def, 'publish'), true)
  assert.equal(userCan({ role: 'editor', types: ['services'] }, 'articles', def, 'edit'), false)
  assert.equal(userCan({ role: 'editor', types: null }, 'articles', def, 'edit'), true)
  assert.equal(userCan({ role: 'writer', types: ['services'] }, 'services', def, 'publish'), false)
  assert.equal(userCan({ role: 'admin', types: ['services'] }, 'articles', def, 'delete'), true)
})

test('le format refuse un réglage access incohérent', () => {
  const site = { name: 'Test', locales: ['fr'] as [string], defaultLocale: 'fr' }
  const build = (extra: object) => () => defineCms({ site, collections: { posts: collection({ label: 'Articles', titleField: 'title', fields, ...extra } as never) } })
  assert.throws(build({ access: { publish: ['writer'], edit: ['editor'] } }), /doit aussi avoir le droit edit/)
  assert.throws(build({ access: { publish: ['admin'] } }), /liste de rôles attendue/)
  assert.throws(build({ access: { approve: ['editor'] } }), /droit inconnu/)
  assert.throws(build({ adminOnly: true, access: { edit: ['editor'] } }), /incompatibles/)
  assert.doesNotThrow(build({ access: { publish: ['editor', 'writer'] } }))
  assert.doesNotThrow(() => defineCms({ site, singletons: { home: singleton({ label: 'Accueil', fields, access: { edit: ['editor'] } }) } }))
})
