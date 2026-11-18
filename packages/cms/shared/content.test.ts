import assert from 'node:assert/strict'
import { test } from 'node:test'
import { toPublicValues } from './content.ts'
import { collection, defineCms, f } from './format.ts'

const config = defineCms({
  site: { name: 'Test', locales: ['fr'], defaultLocale: 'fr' },
  collections: {
    targets: collection({ label: 'Cibles', titleField: 'name', fields: { name: f.text({ label: 'Nom' }) } }),
    all: collection({
      label: 'Tout',
      titleField: 'text',
      fields: {
        text: f.text({ label: 'Texte' }),
        area: f.textarea({ label: 'Texte long' }),
        rich: f.richText({ label: 'Texte mis en forme' }),
        num: f.number({ label: 'Nombre' }),
        date: f.date({ label: 'Date' }),
        on: f.boolean({ label: 'Interrupteur' }),
        onByDefault: f.boolean({ label: 'Interrupteur', default: true }),
        choice: f.select({ label: 'Choix', options: [{ value: 'a', label: 'A' }] }),
        choices: f.select({ label: 'Choix', multiple: true, options: [{ value: 'a', label: 'A' }] }),
        image: f.image({ label: 'Image' }),
        file: f.file({ label: 'Fichier' }),
        link: f.link({ label: 'Lien' }),
        one: f.relation({ label: 'Relation', to: 'targets' }),
        many: f.relation({ label: 'Relations', to: 'targets', multiple: true }),
        items: f.repeater({ label: 'Liste', fields: { label: f.text({ label: 'Libellé' }), amount: f.number({ label: 'Montant' }), tags: f.select({ label: 'T', multiple: true, options: [{ value: 'a', label: 'A' }] }) } }),
        hidden: f.text({ label: 'Masqué', showIf: { field: 'on', equals: true } }),
      },
    }),
  },
})
const fields = config.collections.all.fields as any

const EMPTY = {
  text: null, area: null, rich: null, num: null, date: null, on: false, onByDefault: true, choice: null, choices: [],
  image: null, file: null, link: null, one: null, many: [], items: [], hidden: null,
}

test('un champ vide a une seule forme, quelle que soit la façon dont il est vide en base', () => {
  // Jamais rempli : aucune clé.
  assert.deepEqual(toPublicValues(fields, {}), EMPTY)
  // Vidé dans le formulaire : textes vides, listes vides.
  assert.deepEqual(toPublicValues(fields, {
    text: '', area: '', rich: '', num: '', date: '', choice: '', choices: [], image: '', file: '', link: {}, one: '', many: [], items: [], hidden: '',
  }), EMPTY)
  // Mis à null (import, API).
  assert.deepEqual(toPublicValues(fields, Object.fromEntries(Object.keys(EMPTY).map(k => [k, null]))), EMPTY)
})

test('un texte mis en forme sans texte est vide', () => {
  for (const html of ['<p></p>', '<p><br></p>', '<p> </p><p>&nbsp;</p>', '<ul><li></li></ul>'])
    assert.equal(toPublicValues(fields, { rich: html }).rich, null, html)
  assert.equal(toPublicValues(fields, { rich: '<p>Bonjour</p>' }).rich, '<p>Bonjour</p>')
})

test('zéro et false sont des valeurs, pas du vide', () => {
  const out = toPublicValues(fields, { num: 0, on: false, onByDefault: false })
  assert.equal(out.num, 0)
  assert.equal(out.on, false)
  assert.equal(out.onByDefault, false)
})

test('un lien sans adresse ni page est vide ; un lien rempli est gardé pour être résolu', () => {
  assert.equal(toPublicValues(fields, { link: { kind: 'url', url: '' } }).link, null)
  assert.equal(toPublicValues(fields, { link: { kind: 'page', type: 'targets' } }).link, null)
  assert.deepEqual(toPublicValues(fields, { link: { kind: 'url', url: '/contact', label: '' } }).link, { kind: 'url', url: '/contact', label: '' })
  assert.deepEqual(toPublicValues(fields, { link: { kind: 'page', type: 'targets', id: 'x' } }).link, { kind: 'page', type: 'targets', id: 'x' })
})

test('les mêmes règles s\'appliquent dans un répéteur', () => {
  const out = toPublicValues(fields, { items: [{ label: '', amount: null }, { label: 'L\'unité', amount: 0, tags: ['a'], _kept: { old: 1 } }, null] })
  assert.deepEqual(out.items, [{ label: null, amount: null, tags: [] }, { label: 'L\'unité', amount: 0, tags: ['a'] }])
})

test('un champ masqué par showIf est vide, sa valeur en base n\'est pas envoyée', () => {
  assert.equal(toPublicValues(fields, { on: false, hidden: 'secret' }).hidden, null)
  assert.equal(toPublicValues(fields, { on: true, hidden: 'visible' }).hidden, 'visible')
})

test('une valeur du mauvais type ne passe pas au site', () => {
  const out = toPublicValues(fields, { text: 12, num: '12', choices: 'a', many: 'id1', items: 'x', image: { id: 'm' } })
  assert.deepEqual([out.text, out.num, out.choices, out.many, out.items, out.image], [null, null, ['a'], ['id1'], [], null])
})
