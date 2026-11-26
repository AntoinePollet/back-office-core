import assert from 'node:assert/strict'
import { test } from 'node:test'
import { newsletter } from './modules'
import { NEWSLETTER, confirmationEmail, newsletterPageHtml, newsletterTexts, normalizeEmail, subscribersCsv } from './newsletter'

test('adresse e-mail : mise en forme, refus', () => {
  assert.equal(normalizeEmail('  Claire.Durand@Exemple.FR '), 'claire.durand@exemple.fr')
  assert.equal(normalizeEmail('a+b@sous.domaine.co'), 'a+b@sous.domaine.co')
  for (const bad of ['', 'claire', 'claire@', '@exemple.fr', 'claire@exemple', 'claire durand@exemple.fr', 'a@b.fr, c@d.fr', 'Claire <a@b.fr>', `${'x'.repeat(250)}@b.fr`, null, undefined, 3])
    assert.equal(normalizeEmail(bad), null, String(bad))
})

test('e-mail de confirmation : langue, lien en bouton et en clair, texte échappé', () => {
  const mail = confirmationEmail({ siteName: 'Durand & <Fils>', locale: 'fr', confirmUrl: 'https://site.fr/api/newsletter/confirm?id=1&t=abc', color: '#112233' })
  assert.equal(mail.subject, 'Confirmez votre inscription à la lettre d\'information de Durand & <Fils>')
  assert.ok(mail.html.includes('Durand &amp; &lt;Fils&gt;') && !mail.html.includes('<Fils>'))
  assert.equal(mail.html.split('https://site.fr/api/newsletter/confirm?id=1&amp;t=abc').length, 3)
  assert.ok(mail.html.includes('background:#112233;color:#ffffff'))
  assert.ok(mail.html.includes(`valable ${NEWSLETTER.pendingDays} jours`))
  assert.ok(confirmationEmail({ siteName: 'Site', locale: 'en', confirmUrl: 'x' }).subject.startsWith('Confirm your subscription'))
  // Une langue sans traduction reçoit l'anglais ; « fr-CA » reçoit le français.
  assert.equal(newsletterTexts('de'), newsletterTexts('en'))
  assert.equal(newsletterTexts('fr-CA'), newsletterTexts('fr'))
})

test('pages vues par le visiteur : autonomes, jamais indexées, la désinscription passe par un bouton', () => {
  const input = { siteName: 'Cabinet <Durand>', locale: 'fr', theme: { primary: '#aa0000' }, home: '/' }
  const confirmed = newsletterPageHtml({ kind: 'confirmed' }, input)
  assert.ok(confirmed.includes('data-cms-newsletter="confirmed"') && confirmed.includes('Inscription confirmée') && confirmed.includes('name="robots" content="noindex"'))
  assert.ok(confirmed.includes('Cabinet &lt;Durand&gt;') && !confirmed.includes('<Durand>'))
  assert.ok(confirmed.includes('#aa0000') && confirmed.includes('<a href="/"'))
  const leave = newsletterPageHtml({ kind: 'leave', email: 'a@b.fr', action: '/api/newsletter/unsubscribe?id=1&t="x' }, input)
  assert.ok(leave.includes('<form method="post" action="/api/newsletter/unsubscribe?id=1&amp;t=&quot;x">') && leave.includes('a@b.fr') && leave.includes('Me désinscrire'))
  assert.ok(newsletterPageHtml({ kind: 'invalid' }, { ...input, locale: 'en', home: '/en' }).includes('This link is no longer valid'))
  assert.ok(newsletterPageHtml({ kind: 'left' }, input).includes('Vous êtes désinscrit'))
  assert.ok(newsletterPageHtml({ kind: 'already' }, input).includes('déjà confirmée'))
})

test('export : une ligne par inscrit, formules neutralisées', () => {
  const csv = subscribersCsv([
    { email: 'a@b.fr', locale: 'fr', status: 'confirmed', source: '/lettre', createdAt: new Date('2026-03-01T08:00:00Z'), confirmedAt: new Date('2026-03-01T08:05:00Z'), channel: 'Google Ads', campaign: '=cmd()', unsubscribeUrl: 'https://site.fr/x' },
    { email: 'c@d.fr', locale: 'en', status: 'pending', createdAt: '2026-03-02T10:00:00Z' },
  ])
  const lines = csv.replace('﻿', '').split('\r\n')
  assert.equal(lines.length, 3)
  assert.equal(lines[0], '"E-mail";"État";"Langue";"Demande d\'inscription";"Confirmation";"Désinscription";"Page d\'inscription";"Provenance";"Campagne";"Lien de désinscription"')
  assert.equal(lines[1], '"a@b.fr";"Inscrit";"fr";"01/03/2026 09:00";"01/03/2026 09:05";"";"/lettre";"Google Ads";"\'=cmd()";"https://site.fr/x"')
  assert.ok(lines[2]!.startsWith('"c@d.fr";"En attente de confirmation";"en";"02/03/2026 11:00";"";'))
})

test('configuration : pages de retour vérifiées', () => {
  assert.deepEqual(newsletter(), { id: 'newsletter', options: {} })
  assert.deepEqual(newsletter({ confirmedPath: '/merci' }).options, { confirmedPath: '/merci' })
  assert.throws(() => newsletter({ confirmedPath: 'merci' }), /confirmedPath doit être une page du site/)
  assert.throws(() => newsletter({ unsubscribedPath: 'https://autre.fr' }), /unsubscribedPath/)
  assert.throws(() => newsletter({ confirmedPath: '//autre.fr' }), /confirmedPath/)
})
