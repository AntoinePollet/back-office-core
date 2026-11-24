import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cleanOrigin, originFromMetadata, originToMetadata } from './attribution.ts'
import {
  ADS_PURPOSE, CONSENT_SCRIPT_ID, consentConfigTag, consentLocale, consentOptionsErrors, consentPurposes, consentTexts, isPolicyUrl,
  readStoredConsent, storedConsent,
} from './consent.ts'
import { consent } from './modules.ts'

const NOW = Date.UTC(2026, 10, 24, 12)
const video = { id: 'video', label: 'Vidéos YouTube', description: 'Afficher les vidéos hébergées par YouTube.' }

test('finalités : la publicité si la provenance est relevée, puis celles du site ; déclaration contrôlée', () => {
  assert.deepEqual(consentPurposes(undefined, true), [ADS_PURPOSE])
  assert.deepEqual(consentPurposes(undefined, false), [])
  assert.deepEqual(consentPurposes({ video: { label: video.label, description: video.description } }, true).map(p => p.id), ['ads', 'video'])
  assert.deepEqual(consentOptionsErrors(undefined), [])
  assert.deepEqual(consentOptionsErrors({ video: { label: 'Vidéos', description: 'Afficher les vidéos.' } }), [])
  assert.equal(consentOptionsErrors({ 'mes-videos': { label: 'x', description: 'y' } }).length, 1)
  assert.equal(consentOptionsErrors({ ads: { label: 'x', description: 'y' } }).length, 1)
  assert.equal(consentOptionsErrors({ video: { label: '', description: '' } }).length, 2)
  assert.equal(consentOptionsErrors([]).length, 1)
  assert.deepEqual(consent(), { id: 'consent', options: { purposes: {} } })
  assert.throws(() => consent({ purposes: { ads: { label: 'x', description: 'y' } } }), /apportée par le core/)
})

test('choix gardé : valable six mois, redemandé si une finalité s\'ajoute ou s\'il est illisible', () => {
  const purposes = [ADS_PURPOSE, video]
  const stored = storedConsent({ ads: true, video: false, autre: true }, purposes, NOW)
  // Seules les finalités proposées sont écrites, en oui ou non.
  assert.deepEqual(stored, { v: 1, at: NOW, choices: { ads: true, video: false } })
  assert.deepEqual(storedConsent({}, purposes, NOW).choices, { ads: false, video: false })
  const raw = JSON.stringify(stored)
  assert.deepEqual(readStoredConsent(raw, purposes, NOW + 86_400_000), { ads: true, video: false })
  // Cinq mois après : encore bon ; six mois après, jour pour jour : redemandé.
  assert.deepEqual(readStoredConsent(raw, purposes, Date.UTC(2027, 3, 24, 11)), { ads: true, video: false })
  assert.equal(readStoredConsent(raw, purposes, Date.UTC(2027, 4, 24, 12)), null)
  // Une finalité de moins : le reste vaut toujours. Une de plus : on redemande.
  assert.deepEqual(readStoredConsent(raw, [ADS_PURPOSE], NOW), { ads: true })
  assert.equal(readStoredConsent(raw, [...purposes, { id: 'cartes', label: 'Cartes', description: 'x' }], NOW), null)
  for (const bad of [null, '', 'pas du json', '{}', '{"v":2,"at":1,"choices":{}}', JSON.stringify({ v: 1, at: NOW, choices: { ads: 'oui', video: false } }), JSON.stringify({ v: 1, at: NOW + 10 * 86_400_000, choices: { ads: true, video: true } })])
    assert.equal(readStoredConsent(bad, purposes, NOW), null, String(bad))
})

test('configuration dans la page, textes, langue, adresse de la politique', () => {
  const tag = consentConfigTag({ purposes: [{ id: 'video', label: '</script><b>', description: 'x' }], policyUrl: '/confidentialite', locales: ['fr', 'en'], defaultLocale: 'fr' })
  assert.ok(tag.startsWith(`<script type="application/json" id="${CONSENT_SCRIPT_ID}">`) && tag.endsWith('</script>'))
  // Un texte ne peut pas fermer la balise.
  assert.equal(tag.slice(0, -9).includes('</script>'), false)
  assert.equal(JSON.parse(tag.slice(tag.indexOf('>') + 1, -9)).purposes[0].label, '</script><b>')
  assert.equal(consentTexts('fr').refuse, 'Tout refuser')
  assert.equal(consentTexts('fr-CA').accept, 'Tout accepter')
  assert.equal(consentTexts('en').refuse, 'Refuse all')
  assert.equal(consentTexts('de').accept, 'Accept all')
  const site = { locales: ['fr', 'en'], defaultLocale: 'fr' }
  assert.equal(consentLocale('/en/services/x', site), 'en')
  assert.equal(consentLocale('/services/x', site), 'fr')
  assert.equal(consentLocale('/', site), 'fr')
  for (const good of ['/confidentialite', '/en/privacy#cookies', 'https://exemple.fr/confidentialite']) assert.equal(isPolicyUrl(good), true, good)
  for (const bad of ['confidentialite', '//pirate.example', 'javascript:alert(1)', '/', '/a b']) assert.equal(isPolicyUrl(bad), false, bad)
})

test('provenance : l\'accord du visiteur suit le contact, y compris par les métadonnées de Stripe', () => {
  const origin = cleanOrigin({ click: 'gclid', clickId: 'abc', consent: true }, NOW)!
  assert.equal(origin.consent, true)
  assert.equal(cleanOrigin({ click: 'gclid', clickId: 'abc' }, NOW)!.consent, undefined)
  assert.equal(cleanOrigin({ click: 'gclid', clickId: 'abc', consent: 'oui' }, NOW)!.consent, undefined)
  // L'accord seul ne fait pas une provenance.
  assert.equal(cleanOrigin({ consent: true }, NOW), null)
  assert.equal(originFromMetadata(originToMetadata(origin))!.consent, true)
  assert.equal(originFromMetadata(originToMetadata(cleanOrigin({ click: 'gclid', clickId: 'abc' }, NOW)))!.consent, undefined)
})
