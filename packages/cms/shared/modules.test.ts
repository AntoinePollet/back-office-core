import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defineCms, f } from './format.ts'
import { brevo, formDefinitions, formSummary, forms, validateSubmission } from './modules.ts'
import { decryptSecret, encryptSecret, secretHint } from './secrets.ts'

const site = { name: 'Test', locales: ['fr'] as const, defaultLocale: 'fr' }
const contact = {
  label: 'Contact',
  fields: {
    name: f.text({ label: 'Nom', required: true }),
    email: f.text({ label: 'E-mail', required: true, format: 'email' }),
    people: f.number({ label: 'Personnes', integer: true, min: 1 }),
    subject: f.select({ label: 'Sujet', options: [{ value: 'devis', label: 'Demande de devis' }, { value: 'autre', label: 'Autre' }] }),
    message: f.textarea({ label: 'Message', required: true }),
    day: f.date({ label: 'Jour souhaité' }),
    consent: f.boolean({ label: 'Accord', required: true }),
  },
}
const collections = { pages: { kind: 'collection' as const, label: 'Pages', seo: false, drafts: true, orderable: false, titleField: 'title', fields: { title: f.text({ label: 'Titre' }) } } }

test('modules dans la configuration : conservés tels quels, sans doublon ni identifiant manquant', () => {
  const config = defineCms({ site, collections, modules: [brevo(), forms({ contact })] })
  assert.deepEqual(config.modules.map(m => m.id), ['brevo', 'forms'])
  assert.equal(formDefinitions(config).contact!.label, 'Contact')
  // Un site sans module : aucun formulaire.
  assert.deepEqual(formDefinitions({}), {})
  assert.equal('modules' in defineCms({ site, collections }), false)
  assert.throws(() => defineCms({ site, collections, modules: [brevo(), brevo()] }), /déclaré deux fois/)
  assert.throws(() => defineCms({ site, collections, modules: [{} as never] }), /identifiant/)
})

test('forms() refuse un formulaire mal écrit, avec un message qui dit où', () => {
  assert.throws(() => forms({}), /aucun formulaire/)
  assert.throws(() => forms({ 'mon-form': contact }), /camelCase/)
  assert.throws(() => forms({ contact: { label: 'Contact', fields: {} } }), /aucun champ/)
  assert.throws(() => forms({ contact: { label: 'Contact', fields: { photo: f.image({ label: 'Photo' }) } } }), /formulaire contact\.photo : type « image » non accepté/)
  assert.throws(() => forms({ contact }, { retentionDays: 0 }), /retentionDays/)
  assert.equal(forms({ contact }).options.retentionDays, 365)
})

test('envoi d\'un visiteur : nettoyé, converti et validé d\'après le formulaire', () => {
  const ok = validateSubmission(contact, { name: '  Jeanne  ', email: 'jeanne@example.com', people: '3', subject: 'devis', message: 'Bonjour', day: '2026-12-01', consent: true, admin: true })
  assert.deepEqual(ok.errors, {})
  assert.deepEqual(ok.values, { name: 'Jeanne', email: 'jeanne@example.com', people: 3, subject: 'devis', message: 'Bonjour', day: '2026-12-01', consent: true })

  const bad = validateSubmission(contact, { name: ' ', email: 'pas-une-adresse', people: 'beaucoup', subject: 'inconnu', message: 'x'.repeat(5001), day: 'demain', consent: false })
  assert.deepEqual(Object.keys(bad.errors).sort(), ['consent', 'day', 'email', 'message', 'name', 'people', 'subject'])
  assert.equal(bad.errors.name, 'Ce champ est obligatoire.')
  assert.equal(bad.errors.consent, 'Cette case doit être cochée.')
  // Sans limite déclarée, un texte long est quand même refusé.
  assert.equal(bad.errors.message, '5000 caractères au maximum.')
  assert.deepEqual(Object.keys(validateSubmission(contact, null).errors).sort(), ['consent', 'email', 'message', 'name'])
  assert.deepEqual(Object.keys(validateSubmission(contact, 'texte').errors).sort(), ['consent', 'email', 'message', 'name'])
})

test('résumé d\'un message : une ligne par champ rempli, avec les libellés', () => {
  const text = formSummary(contact, { name: 'Jeanne', email: 'jeanne@example.com', people: null, subject: 'devis', message: 'Bonjour', consent: true })
  assert.equal(text, 'Nom : Jeanne\nE-mail : jeanne@example.com\nSujet : Demande de devis\nMessage : Bonjour\nAccord : Oui')
})

test('clés d\'API : chiffrées, relues avec le bon secret seulement', async () => {
  const encrypted = await encryptSecret('secret-du-site', 'xkeysib-abcdef-123456')
  assert.ok(!encrypted.includes('xkeysib'))
  assert.notEqual(encrypted, await encryptSecret('secret-du-site', 'xkeysib-abcdef-123456'))
  assert.equal(await decryptSecret('secret-du-site', encrypted), 'xkeysib-abcdef-123456')
  assert.equal(await decryptSecret('autre-secret', encrypted), null)
  assert.equal(await decryptSecret('secret-du-site', 'abîmé'), null)
  assert.equal(secretHint('xkeysib-abcdef-123456'), '…3456')
  // Une clé courte ne laisse rien deviner.
  assert.equal(secretHint('court'), '…')
})
