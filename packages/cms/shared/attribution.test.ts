import assert from 'node:assert/strict'
import { test } from 'node:test'
import { channelOf, cleanOrigin, isCampaignOrigin, filterByOrigin, originFromMetadata, originStats, originSummary, originToMetadata, readVisitOrigin } from './attribution.ts'

const NOW = Date.UTC(2026, 10, 24, 12)
const site = 'https://cabinet-durand.fr'

test('arrivée : paramètres utm, identifiant de clic, site précédent (domaine seulement), page d\'arrivée', () => {
  assert.deepEqual(
    readVisitOrigin(`${site}/services/droit?utm_source=google&utm_medium=cpc&utm_campaign=Printemps%202026&utm_term=avocat+lyon&gclid=Cj0KCQ&x=1`, 'https://www.google.com/search?q=secret', NOW),
    { at: NOW, source: 'google', medium: 'cpc', campaign: 'Printemps 2026', term: 'avocat lyon', click: 'gclid', clickId: 'Cj0KCQ', referrer: 'www.google.com', landing: '/services/droit' },
  )
  assert.deepEqual(readVisitOrigin(`${site}/`, 'https://www.qwant.com/', NOW), { at: NOW, referrer: 'www.qwant.com', landing: '/' })
  // Rien à retenir : arrivée directe, page précédente du site lui-même, paramètres vides.
  assert.equal(readVisitOrigin(`${site}/contact`, '', NOW), null)
  assert.equal(readVisitOrigin(`${site}/contact`, `${site}/services`, NOW), null)
  assert.equal(readVisitOrigin(`${site}/contact?utm_source=&gclid=`, '', NOW), null)
  assert.equal(readVisitOrigin('pas une adresse', '', NOW), null)
  // Textes nettoyés et raccourcis.
  const long = readVisitOrigin(`${site}/?utm_campaign=${'a'.repeat(300)}&utm_source=%0Aga%09b`, '', NOW)!
  assert.equal(long.campaign!.length, 200)
  assert.equal(long.source, 'ga b')
})

test('canal : identifiants de clic, puis utm, puis site précédent', () => {
  const c = (o: Record<string, string>) => channelOf(o as never)
  assert.equal(c({ click: 'gclid' }), 'google-ads')
  assert.equal(c({ click: 'wbraid' }), 'google-ads')
  assert.equal(c({ click: 'msclkid' }), 'microsoft-ads')
  assert.equal(c({ source: 'google', medium: 'cpc' }), 'google-ads')
  assert.equal(c({ source: 'Facebook', medium: 'paid_social' }), 'meta-ads')
  assert.equal(c({ source: 'linkedin', medium: 'cpc' }), 'linkedin-ads')
  assert.equal(c({ source: 'annuaire', medium: 'display' }), 'other-ads')
  // Facebook ajoute fbclid à tous ses liens : sans utm payant, ce n'est pas une publicité.
  assert.equal(c({ click: 'fbclid' }), 'social')
  assert.equal(c({ click: 'fbclid', source: 'facebook', medium: 'cpc' }), 'meta-ads')
  assert.equal(c({ source: 'brevo', medium: 'email', campaign: 'lettre-mars' }), 'email')
  assert.equal(c({ source: 'linkedin' }), 'social')
  assert.equal(c({ source: 'salon', campaign: 'flyer' }), 'campaign')
  assert.equal(c({ referrer: 'www.google.fr' }), 'search')
  assert.equal(c({ referrer: 'duckduckgo.com' }), 'search')
  assert.equal(c({ referrer: 'l.facebook.com' }), 'social')
  assert.equal(c({ referrer: 'mail.google.com' }), 'email')
  assert.equal(c({ referrer: 'annuaire-avocats.fr' }), 'referral')
  assert.equal(c({}), 'direct')
})

test('contrôle côté serveur : champs connus, textes courts, canal recalculé, date plausible', () => {
  assert.deepEqual(
    cleanOrigin({ source: ' google ', medium: 'cpc', campaign: 'p', click: 'gclid', clickId: 'abc', referrer: 'WWW.Google.com', landing: '/x', at: NOW - 1000, channel: 'direct', extra: 'x' }, NOW),
    { source: 'google', medium: 'cpc', campaign: 'p', click: 'gclid', clickId: 'abc', referrer: 'www.google.com', landing: '/x', at: NOW - 1000, channel: 'google-ads' },
  )
  for (const bad of [null, 'texte', 42, [], {}, { channel: 'google-ads' }, { click: 'inconnu', clickId: 'x' }, { click: 'gclid' }, { landing: '/x' }])
    assert.equal(cleanOrigin(bad, NOW), null, JSON.stringify(bad))
  // Valeurs mal formées : ignorées, le reste est gardé.
  assert.deepEqual(cleanOrigin({ source: 'salon', referrer: 'javascript:alert(1)', landing: 'https://ailleurs', at: NOW + 10 * 86_400_000, term: 3 }, NOW), { source: 'salon', channel: 'campaign' })
  assert.equal(cleanOrigin({ campaign: 'a'.repeat(5000) }, NOW)!.campaign!.length, 200)
})

test('paiements : la provenance fait l\'aller-retour par les métadonnées de Stripe', () => {
  const origin = cleanOrigin({ source: 'google', medium: 'cpc', campaign: 'printemps', click: 'gclid', clickId: 'abc', landing: '/boutique', at: NOW }, NOW)!
  const meta = originToMetadata(origin)
  assert.ok(Object.keys(meta).every(k => k.startsWith('cms_o_')) && Object.values(meta).every(v => typeof v === 'string' && v.length <= 500))
  const back = originFromMetadata({ ...meta, cms_collection: 'products' })!
  assert.deepEqual({ ...back, at: undefined }, { ...origin, at: undefined })
  assert.deepEqual(originToMetadata(null), {})
  assert.equal(originFromMetadata({ cms_collection: 'products' }), null)
  assert.equal(originFromMetadata(null), null)
})

test('comptes par canal et par campagne, filtre par période et par canal, résumé', () => {
  const day = 86_400_000
  const rows = [
    { origin: cleanOrigin({ click: 'gclid', clickId: 'a', campaign: 'printemps' }, NOW), createdAt: new Date(NOW - day).toISOString() },
    { origin: cleanOrigin({ click: 'gclid', clickId: 'b', campaign: 'printemps' }, NOW), createdAt: new Date(NOW - 2 * day).toISOString() },
    { origin: cleanOrigin({ source: 'google', medium: 'cpc', campaign: 'marque' }, NOW), createdAt: new Date(NOW - 40 * day).toISOString() },
    { origin: cleanOrigin({ referrer: 'www.bing.com' }, NOW), createdAt: new Date(NOW - 3 * day).toISOString() },
    { origin: null, createdAt: new Date(NOW - 3 * day).toISOString() },
  ]
  const stats = originStats(rows)
  assert.deepEqual(stats.map(s => [s.channel, s.count, s.paid]), [['google-ads', 3, true], ['direct', 1, false], ['search', 1, false]])
  assert.deepEqual(stats[0]!.campaigns, [{ name: 'printemps', count: 2 }, { name: 'marque', count: 1 }])
  assert.equal(filterByOrigin(rows, 30, null, NOW).length, 4)
  assert.equal(filterByOrigin(rows, 30, 'google-ads', NOW).length, 2)
  assert.equal(filterByOrigin(rows, null, 'google-ads', NOW).length, 3)
  assert.equal(filterByOrigin(rows, 7, 'direct', NOW).length, 1)
  assert.equal(originSummary(rows[0]!.origin), 'Google Ads · campagne « printemps »')
  assert.equal(originSummary(rows[3]!.origin), 'Moteur de recherche · depuis www.bing.com')
  assert.equal(originSummary(null), 'Accès direct')
})

test('retour d\'une page de paiement ou de connexion : pas une nouvelle arrivée ; campagne ou simple site précédent', () => {
  assert.equal(readVisitOrigin(`${site}/boutique`, 'https://checkout.stripe.com/c/pay/cs_test_1', NOW), null)
  assert.equal(readVisitOrigin(`${site}/`, 'https://accounts.google.com/signin', NOW), null)
  // Un paramètre de campagne compte toujours, même en revenant de la page de paiement.
  assert.deepEqual(readVisitOrigin(`${site}/merci?utm_source=lettre`, 'https://checkout.stripe.com/x', NOW), { at: NOW, source: 'lettre', landing: '/merci' })
  assert.equal(isCampaignOrigin({ click: 'gclid', clickId: 'x' }), true)
  assert.equal(isCampaignOrigin({ campaignId: '101' }), true)
  assert.equal(isCampaignOrigin({ referrer: 'www.google.com', landing: '/' }), false)
  assert.equal(isCampaignOrigin(null), false)
})

test('canal du site précédent : le moteur de Google seulement, messageries avec chiffres et tirets', () => {
  const c = (referrer: string) => channelOf({ referrer })
  for (const host of ['google.fr', 'www.google.com', 'www.google.co.uk', 'yandex.ru', 'www.bing.com', 'fr.search.yahoo.com']) assert.equal(c(host), 'search', host)
  for (const host of ['docs.google.com', 'sites.google.com', 'classroom.google.com', 'google.example.com']) assert.equal(c(host), 'referral', host)
  for (const host of ['mail.google.com', 'mail.mon-cabinet.fr', 'webmail.ovh-1.net', 'outlook.live.com']) assert.equal(c(host), 'email', host)
  assert.equal(c('email-marketing.example'), 'referral')
})
