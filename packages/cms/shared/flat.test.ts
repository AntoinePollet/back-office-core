import assert from 'node:assert/strict'
import { test } from 'node:test'
import { collection, defineCms, f } from './format.ts'
import { mergeValues, splitFlat, strayKeys, strayMessage } from './flat.ts'

const config = defineCms({
  site: { name: 'Test', locales: ['fr', 'en'], defaultLocale: 'fr' },
  collections: {
    services: collection({
      label: 'Services',
      titleField: 'title',
      path: '/services/[slug]',
      seo: true,
      fields: {
        title: f.text({ label: 'Titre' }),
        price: f.number({ label: 'Tarif' }),
        phone: f.text({ label: 'Téléphone', localized: false }),
        cover: f.image({ label: 'Image' }),
        steps: f.repeater({ label: 'Étapes', fields: { name: f.text({ label: 'Nom' }), done: f.boolean({ label: 'Fait' }) } }),
      },
    }),
  },
})
const fields = config.collections.services.fields as any

test('écriture à plat : chaque valeur est rangée d\'après la configuration', () => {
  const out = splitFlat(fields, { title: 'Droit social', price: 150, phone: '04 72', cover: 'm1', steps: [{ name: 'Rendez-vous' }] })
  assert.deepEqual(out.localized, { title: 'Droit social', steps: [{ name: 'Rendez-vous' }] })
  assert.deepEqual(out.shared, { price: 150, phone: '04 72', cover: 'm1' })
  assert.deepEqual(out.unknown, [])
})

test('écriture à plat : null est une valeur (il vide le champ), undefined est ignoré', () => {
  const out = splitFlat(fields, { title: null, price: undefined })
  assert.deepEqual(out.localized, { title: null })
  assert.deepEqual(out.shared, {})
})

test('écriture à plat : un nom inconnu est signalé, y compris dans un répéteur', () => {
  const out = splitFlat(fields, { titel: 'x', steps: [{ name: 'a' }, { nom: 'b', _kept: { old: 1 } }] })
  assert.deepEqual(out.unknown, ['titel', 'steps.1.nom'])
  assert.deepEqual(out.localized, { steps: [{ name: 'a' }, { nom: 'b', _kept: { old: 1 } }] })
})

test('écriture à plat : seo se partage entre le commun (image, noindex) et le traduit (title, description)', () => {
  const out = splitFlat(fields, { seo: { title: 'T', description: 'D', image: 'm1', noindex: true, robots: 'x' } }, true)
  assert.deepEqual(out.localized, { seo: { title: 'T', description: 'D' } })
  assert.deepEqual(out.shared, { seo: { image: 'm1', noindex: true } })
  assert.deepEqual(out.unknown, ['seo.robots'])
  // Sans l'onglet Référencement, « seo » n'est pas un champ.
  assert.deepEqual(splitFlat(fields, { seo: { title: 'T' } }).unknown, ['seo'])
})

test('fusion : seuls les champs cités changent ; seo est fusionné clé par clé', () => {
  assert.deepEqual(mergeValues({ title: 'A', seo: { title: 'T', description: 'D' } }, { seo: { title: 'T2' } }), { title: 'A', seo: { title: 'T2', description: 'D' } })
  assert.deepEqual(mergeValues({ title: 'A', price: 1 }, { price: null }), { title: 'A', price: null })
})

test('écriture par parties : une valeur dans la mauvaise partie ou inconnue est signalée', () => {
  assert.deepEqual(strayKeys('shared', fields, { price: 1, title: 'x', nope: 1 }, undefined), [{ key: 'title', reason: 'localized' }, { key: 'nope', reason: 'unknown' }])
  assert.deepEqual(strayKeys('localized', fields, { title: 'x', phone: '04', nope: 1 }, undefined), [{ key: 'phone', reason: 'shared' }, { key: 'nope', reason: 'unknown' }])
  assert.deepEqual(strayKeys('shared', fields, undefined, undefined), [])
})

test('écriture par parties : ce que le formulaire renvoie légitimement n\'est pas refusé', () => {
  // Clé système, valeurs mises de côté par une migration, valeur d'un champ retiré encore en base.
  assert.deepEqual(strayKeys('shared', fields, { seo: { noindex: true }, _kept: { a: 1 }, oldField: 'x' }, { oldField: 'x' }, ['seo']), [])
  // Un champ devenu traduit, pas encore déplacé par la migration : il est encore dans la partie commune en base.
  assert.deepEqual(strayKeys('shared', fields, { title: 'x' }, { title: 'x' }), [])
  // « seo » n'est toléré que si le contenu a l'onglet Référencement (ou s'il est déjà en base).
  assert.deepEqual(strayKeys('localized', fields, { seo: {} }, {}), [{ key: 'seo', reason: 'unknown' }])
  assert.deepEqual(strayKeys('localized', fields, { oldField: 'x' }, {}), [{ key: 'oldField', reason: 'unknown' }])
})

test('les messages disent où mettre la valeur', () => {
  assert.match(strayMessage({ key: 'title', reason: 'localized' }, 'Services'), /« title » est un champ traduit .* pas dans shared/)
  assert.match(strayMessage({ key: 'phone', reason: 'shared' }, 'Services', 'en'), /commun à toutes les langues .* pas dans locales\.en\.values/)
  assert.match(strayMessage({ key: 'nope', reason: 'unknown' }, 'Services'), /« nope » n'est pas un champ de « Services »/)
})
