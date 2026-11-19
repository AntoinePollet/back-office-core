import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Who } from './access.ts'
import { TRASH_DAYS, canOpenTrash, canPurgeTrash, canSeeTrashItem, freeSlug, restoresPublished, trashDaysLabel, trashDaysLeft, trashExpired } from './trash.ts'

const DAY = 86_400_000
const col = { kind: 'collection', drafts: true }
const entry = (ownerId: string | null = null) => ({ kind: 'entry' as const, type: 'services', ownerId })
const file = { kind: 'media' as const }

test('délai : 30 jours, comptés en jours entamés, puis écoulé', () => {
  const deleted = Date.UTC(2026, 0, 1, 12)
  assert.equal(TRASH_DAYS, 30)
  assert.equal(trashDaysLeft(deleted, deleted), 30)
  assert.equal(trashDaysLeft(deleted, deleted + DAY / 2), 30)
  assert.equal(trashDaysLeft(deleted, deleted + DAY), 29)
  assert.equal(trashDaysLeft(deleted, deleted + 29 * DAY + 1), 1)
  assert.equal(trashExpired(deleted, deleted + 30 * DAY - 1), false)
  assert.equal(trashExpired(deleted, deleted + 30 * DAY), true)
  assert.equal(trashDaysLeft(deleted, deleted + 45 * DAY), 0)
  // Les dates acceptées : nombre, Date, texte ISO.
  assert.equal(trashDaysLeft(new Date(deleted).toISOString(), new Date(deleted + DAY)), 29)
  assert.equal(trashDaysLabel(12), 'encore 12 jours')
  assert.equal(trashDaysLabel(1), 'dernier jour')
})

test('voir et restaurer : ce qu\'on aurait le droit de supprimer', () => {
  // Rôles intégrés : l'éditeur supprime, pas le rédacteur.
  assert.equal(canSeeTrashItem({ role: 'editor' }, entry(), col), true)
  assert.equal(canSeeTrashItem({ role: 'writer' }, entry(), col), false)
  assert.equal(canSeeTrashItem({ role: 'writer' }, entry(), { ...col, access: { delete: ['editor', 'writer'] as const } }), true)
  // Fichiers : le droit de supprimer des fichiers.
  assert.equal(canSeeTrashItem({ role: 'editor' }, file), true)
  assert.equal(canSeeTrashItem({ role: 'writer' }, file), false)
  assert.equal(canSeeTrashItem({ role: 'role_x', custom: { types: {}, deleteMedia: true } }, file), true)
  assert.equal(canSeeTrashItem({ role: 'role_x', custom: { types: {} } }, file), false)
  // Contenu réservé aux administrateurs, contenus attribués, type retiré de la configuration.
  assert.equal(canSeeTrashItem({ role: 'editor' }, entry(), { ...col, adminOnly: true }), false)
  assert.equal(canSeeTrashItem({ role: 'editor', types: ['articles'] }, entry(), col), false)
  assert.equal(canSeeTrashItem({ role: 'editor' }, entry(), null), false)
  assert.equal(canSeeTrashItem({ role: 'admin' }, entry(), null), true)
})

test('« seulement ses contenus » : on ne voit dans la corbeille que ceux qu\'on a créés', () => {
  const own = { ...col, access: { delete: ['editor', 'writer'] as const, own: ['writer'] as const } }
  const lina: Who = { id: 'lina', role: 'writer' }
  assert.equal(canSeeTrashItem(lina, entry('lina'), own), true)
  assert.equal(canSeeTrashItem(lina, entry('marc'), own), false)
  assert.equal(canSeeTrashItem(lina, entry(null), own), false)
  assert.equal(canSeeTrashItem({ id: 'marc', role: 'editor' }, entry('lina'), own), true)
  const custom: Who = { id: 'noe', role: 'role_x', custom: { types: { services: { edit: true, delete: true, own: true } } } }
  assert.equal(canSeeTrashItem(custom, entry('noe'), col), true)
  assert.equal(canSeeTrashItem(custom, entry('lina'), col), false)
})

test('suppression définitive et vidage : administrateur seulement', () => {
  assert.equal(canPurgeTrash({ role: 'admin' }), true)
  assert.equal(canPurgeTrash({ role: 'editor' }), false)
  assert.equal(canPurgeTrash({ role: 'role_x', custom: { types: { services: { edit: true, publish: true, delete: true } }, deleteMedia: true } }), false)
})

test('restaurer remet en ligne seulement pour qui peut publier', () => {
  assert.equal(restoresPublished({ role: 'editor' }, 'services', col), true)
  assert.equal(restoresPublished({ role: 'writer' }, 'services', { ...col, access: { delete: ['editor', 'writer'] as const } }), false)
  assert.equal(restoresPublished({ role: 'admin' }, 'services', null), true)
  assert.equal(restoresPublished({ role: 'editor' }, 'services', null), false)
})

test('entrée du menu : pour qui peut supprimer quelque chose', () => {
  const none = { edit: true, publish: false, delete: false, own: false }
  assert.equal(canOpenTrash(null), false)
  assert.equal(canOpenTrash({ role: 'admin' }), true)
  assert.equal(canOpenTrash({ role: 'writer', deleteMedia: false, access: { services: none } }), false)
  assert.equal(canOpenTrash({ role: 'writer', deleteMedia: false, access: { services: none, testimonials: { ...none, delete: true } } }), true)
  assert.equal(canOpenTrash({ role: 'role_x', deleteMedia: true, access: {} }), true)
})

test('adresse reprise : la première adresse voisine libre', () => {
  const taken = new Set(['droit-social', 'droit-social-2'])
  assert.equal(freeSlug('droit-fiscal', s => taken.has(s)), 'droit-fiscal')
  assert.equal(freeSlug('droit-social', s => taken.has(s)), 'droit-social-3')
})
