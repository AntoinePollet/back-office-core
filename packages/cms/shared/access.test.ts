import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canDeleteMedia, canEditRestricted, cleanCustomRights, rightsOn, userCan, type Who } from './access.ts'
import { collection, defineCms, f, singleton } from './format.ts'

const fields = { title: f.text({ label: 'Titre' }) }
const col = { kind: 'collection', drafts: true }
const list = (who: Who, def: object, type = 'services') => { const r = rightsOn(who, type, def); return [r.edit, r.publish, r.delete, r.own] }

test('droits par défaut : le rédacteur prépare, l\'éditeur publie et supprime, l\'administrateur fait tout', () => {
  assert.deepEqual(list({ role: 'writer' }, col), [true, false, false, false])
  assert.deepEqual(list({ role: 'editor' }, col), [true, true, true, false])
  assert.deepEqual(list({ role: 'admin' }, { ...col, adminOnly: true }), [true, true, true, false])
})

test('adminOnly ferme tout aux autres rôles, intégrés ou personnalisés', () => {
  const custom = { types: { services: { edit: true, publish: true, delete: true } } }
  for (const who of [{ role: 'editor' }, { role: 'writer' }, { role: 'role_x', custom }] as Who[])
    assert.deepEqual(list(who, { ...col, adminOnly: true }), [false, false, false, false])
})

test('sans brouillons, modifier demande le droit de publier', () => {
  assert.equal(userCan({ role: 'writer' }, 'services', { drafts: false }, 'edit'), false)
  assert.equal(userCan({ role: 'editor' }, 'services', { drafts: false }, 'edit'), true)
  assert.equal(userCan({ role: 'writer' }, 'services', { drafts: false, access: { publish: ['editor', 'writer'] } }, 'edit'), true)
  assert.equal(userCan({ role: 'role_x', custom: { types: { services: { edit: true } } } }, 'services', { drafts: false }, 'edit'), false)
})

test('access accorde ou retire un droit par rôle intégré', () => {
  const selfPublish = { ...col, access: { publish: ['editor', 'writer'] as const } }
  assert.deepEqual(list({ role: 'writer' }, selfPublish), [true, true, false, false])
  assert.deepEqual(list({ role: 'writer' }, { ...col, access: { edit: ['editor'] as const } }), [false, false, false, false])
  // Un droit de publier sans droit de modifier ne donne rien.
  assert.deepEqual(list({ role: 'editor' }, { ...col, access: { edit: [], publish: ['editor'] as const } }), [false, false, false, false])
})

test('« seulement ses contenus » : par rôle intégré, jamais pour une page unique', () => {
  const own = { access: { own: ['writer'] as const } }
  assert.equal(rightsOn({ role: 'writer' }, 'articles', { ...col, ...own }).own, true)
  assert.equal(rightsOn({ role: 'editor' }, 'articles', { ...col, ...own }).own, false)
  assert.equal(rightsOn({ role: 'writer' }, 'home', { kind: 'singleton', drafts: true, ...own }).own, false)
})

test('contenus attribués : la limite s\'ajoute au rôle, sauf pour un administrateur', () => {
  assert.equal(userCan({ role: 'editor', types: ['services'] }, 'services', col, 'publish'), true)
  assert.equal(userCan({ role: 'editor', types: ['services'] }, 'articles', col, 'edit'), false)
  assert.equal(userCan({ role: 'editor', types: null }, 'articles', col, 'edit'), true)
  assert.equal(userCan({ role: 'admin', types: ['services'] }, 'articles', col, 'delete'), true)
})

test('rôle personnalisé : seuls ses droits comptent, pas le réglage access du fichier', () => {
  const who: Who = { role: 'role_stagiaire', custom: { types: { articles: { edit: true, own: true }, services: { edit: true, publish: true } }, deleteMedia: false, restrictedFields: true } }
  assert.deepEqual(list(who, col, 'articles'), [true, false, false, true])
  assert.deepEqual(list(who, { ...col, access: { edit: [] } }, 'services'), [true, true, false, false])
  assert.deepEqual(list(who, col, 'testimonials'), [false, false, false, false])
  assert.equal(canEditRestricted(who), true)
  assert.equal(canDeleteMedia(who), false)
  // Rôle supprimé : plus aucun droit.
  assert.deepEqual(list({ role: 'role_stagiaire', custom: null }, col, 'articles'), [false, false, false, false])
})

test('droits généraux des rôles intégrés : le rédacteur ne touche ni aux champs réservés ni à la suppression de fichiers', () => {
  assert.deepEqual([canEditRestricted({ role: 'editor' }), canDeleteMedia({ role: 'editor' })], [true, true])
  assert.deepEqual([canEditRestricted({ role: 'writer' }), canDeleteMedia({ role: 'writer' })], [false, false])
})

test('nettoyage d\'un rôle personnalisé reçu : types inconnus et droits sans « modifier » écartés', () => {
  const clean = cleanCustomRights({ types: { services: { edit: true, publish: 'oui', own: 1 }, inconnu: { edit: true }, articles: { publish: true } }, deleteMedia: 'x' }, ['services', 'articles'])
  assert.deepEqual(clean, { types: { services: { edit: true, publish: true, delete: false, own: true } }, restrictedFields: false, deleteMedia: true })
})

test('le format refuse un réglage de droits incohérent', () => {
  const site = { name: 'Test', locales: ['fr'] as [string], defaultLocale: 'fr' }
  const build = (extra: object, more: object = fields) => () => defineCms({ site, collections: { posts: collection({ label: 'Articles', titleField: 'title', fields: more, ...extra } as never) } })
  assert.throws(build({ access: { publish: ['writer'], edit: ['editor'] } }), /doit aussi avoir le droit edit/)
  assert.throws(build({ access: { own: ['writer'], edit: ['editor'] } }), /doit aussi avoir le droit edit/)
  assert.throws(build({ access: { publish: ['admin'] } }), /liste de rôles attendue/)
  assert.throws(build({ access: { approve: ['editor'] } }), /droit inconnu/)
  assert.throws(build({ adminOnly: true, access: { edit: ['editor'] } }), /incompatibles/)
  assert.throws(() => defineCms({ site, singletons: { home: singleton({ label: 'Accueil', fields, access: { own: ['writer'] } }) } }), /réservé aux collections/)
  assert.throws(build({}, { title: fields.title, items: f.repeater({ label: 'Liste', fields: { a: f.text({ label: 'A', restricted: true }) } }) }), /restricted se règle sur le répéteur/)
  assert.doesNotThrow(build({ access: { publish: ['editor', 'writer'], own: ['writer'] } }, { title: fields.title, note: f.text({ label: 'Note', restricted: true }) }))
})
