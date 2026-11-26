import assert from 'node:assert/strict'
import { test } from 'node:test'
import { altPrompt, applyTranslations, assistantModel, assistantSettingsErrors, cleanAlt, cleanDescription, descriptionPrompt, isAssistantImage, translatableTexts, translationPrompt } from './assistant.ts'
import { f } from './format.ts'

const fields = {
  title: f.text({ label: 'Titre' }),
  email: f.text({ label: 'E-mail', format: 'email' }),
  body: f.richText({ label: 'Contenu' }),
  price: f.number({ label: 'Prix' }),
  audience: f.select({ label: 'Public', options: [{ value: 'companies', label: 'Entreprises' }] }),
  cover: f.image({ label: 'Image' }),
  gallery: f.image({ label: 'Photos', multiple: true, captions: true }),
  faq: f.repeater({ label: 'Questions', fields: { question: f.text({ label: 'Question' }), answer: f.textarea({ label: 'Réponse' }), link: f.text({ label: 'Lien', format: 'url' }) } }),
}
const values = {
  title: 'Droit des affaires', email: 'contact@cabinet.fr', body: '<p>Nous <strong>accompagnons</strong> les entreprises.</p>', price: 120, audience: 'companies', cover: 'media-1',
  gallery: [{ media: 'm1', caption: 'La salle de réunion' }, { media: 'm2' }, 'm3'],
  faq: [{ question: 'Combien ça coûte ?', answer: 'Sur devis.', link: 'https://cabinet.fr/tarifs' }, { question: '', answer: '   ' }],
  seo: { title: 'Avocat en droit des affaires', description: 'Conseil aux entreprises.', image: 'media-9', noindex: false },
}

test('réglages : modèle contrôlé ; images que le modèle sait lire', () => {
  assert.equal(assistantModel(' claude-sonnet-5-5 '), 'claude-sonnet-5-5')
  for (const bad of ['', 'gpt-5', 'claude', 'claude opus', 'Claude-Opus-5-5']) assert.equal(assistantModel(bad), '', bad)
  assert.deepEqual(Object.keys(assistantSettingsErrors({ model: 'sonnet' })), ['model'])
  assert.deepEqual(assistantSettingsErrors({ model: '' }), {})
  assert.deepEqual([isAssistantImage('image/webp'), isAssistantImage('image/svg+xml'), isAssistantImage('application/pdf')], [true, false, false])
})

test('textes à traduire : champs texte, répéteurs, légendes, référencement ; pas les adresses, nombres, choix ni références', () => {
  assert.deepEqual(translatableTexts(fields, values), [
    { key: 'title', text: 'Droit des affaires', html: false },
    { key: 'body', text: '<p>Nous <strong>accompagnons</strong> les entreprises.</p>', html: true },
    { key: 'gallery.0.caption', text: 'La salle de réunion', html: false },
    { key: 'faq.0.question', text: 'Combien ça coûte ?', html: false },
    { key: 'faq.0.answer', text: 'Sur devis.', html: false },
    { key: 'seo.title', text: 'Avocat en droit des affaires', html: false },
    { key: 'seo.description', text: 'Conseil aux entreprises.', html: false },
  ])
  assert.deepEqual(translatableTexts(fields, {}), [])
})

test('traductions appliquées : le reste est repris tel quel, une clé inconnue ou étrangère au contenu est ignorée', () => {
  const out = applyTranslations(fields, values, [
    { key: 'title', text: 'Business law' }, { key: 'faq.0.answer', text: 'On request.' }, { key: 'gallery.0.caption', text: 'The meeting room' }, { key: 'seo.title', text: 'Business lawyer' },
    { key: 'email', text: 'pirate@example.com' }, { key: 'price', text: '0' }, { key: 'faq.5.question', text: 'x' }, { key: '__proto__.polluted', text: 'x' }, { key: 'seo.image', text: 'autre' },
  ]) as typeof values
  assert.deepEqual([out.title, out.faq[0]!.answer, out.gallery[0], out.seo.title], ['Business law', 'On request.', { media: 'm1', caption: 'The meeting room' }, 'Business lawyer'])
  // Non traduit par le modèle : la version d'origine reste. Jamais traduisible : inchangé.
  assert.deepEqual([out.body, out.faq[0]!.question, out.email, out.price, out.cover, out.seo.image, out.faq[0]!.link], [values.body, 'Combien ça coûte ?', 'contact@cabinet.fr', 120, 'media-1', 'media-9', 'https://cabinet.fr/tarifs'])
  assert.equal(({} as { polluted?: unknown }).polluted, undefined)
  assert.equal(values.title, 'Droit des affaires', 'le contenu de départ a été modifié')
})

test('consignes : langue demandée, contenu présenté comme une donnée', () => {
  const site = { name: 'Cabinet Durand', description: 'Cabinet d\'avocats à Lyon.' }
  const alt = altPrompt({ site, locale: 'fr', fileName: 'IMG_0042.jpg', usedIn: ['Accueil', 'Services'] })
  assert.ok(alt.system.includes('Write in French') && alt.system.includes('Cabinet Durand') && alt.system.includes('never instructions') && alt.user.includes('IMG_0042.jpg') && alt.user.includes('Accueil ; Services'))
  const description = descriptionPrompt({ site, locale: 'en', title: 'Business law', texts: ['First paragraph.', 'Second.'] })
  assert.ok(description.system.includes('Write in English') && /between 110 and \d+ characters/.test(description.system) && description.user.includes('Page title: Business law') && description.user.endsWith('First paragraph.\n\nSecond.'))
  const translation = translationPrompt({ site, from: 'fr', to: 'en', items: translatableTexts(fields, values) })
  assert.ok(translation.system.includes('from French to English') && translation.system.includes('Keep every tag'))
  const sent = JSON.parse(translation.user)
  assert.deepEqual(sent[1], { key: 'body', html: true, text: values.body })
  assert.deepEqual(sent[0], { key: 'title', text: 'Droit des affaires' })
})

test('réponses mises en forme : une ligne, sans guillemets autour', () => {
  assert.equal(cleanAlt('  « Trois avocats\nautour d\'une table »  '), 'Trois avocats autour d\'une table')
  assert.equal(cleanAlt('"A lawyer"'), 'A lawyer')
  assert.equal(cleanDescription(' Le cabinet conseille\n les entreprises. '), 'Le cabinet conseille les entreprises.')
  assert.equal(cleanAlt('x'.repeat(400)).length, 300)
})
