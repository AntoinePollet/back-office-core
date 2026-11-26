import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  formatCtr, formatPosition, parseScPeriod, readScRows, readScTotals, scDays, scFailure, scPagePath, scPagesByPath, scProperty, scQueryBody, scRange,
  searchConsoleReady, searchConsoleSettingsErrors, sumScMetrics,
} from './search-console.ts'

test('propriété : préfixe d\'URL avec sa barre finale, domaine entier, le reste refusé', () => {
  assert.equal(scProperty(' https://www.exemple.fr '), 'https://www.exemple.fr/')
  assert.equal(scProperty('https://exemple.fr/blog'), 'https://exemple.fr/blog/')
  assert.equal(scProperty('http://exemple.fr/'), 'http://exemple.fr/')
  assert.equal(scProperty('SC-Domain:Exemple.FR'), 'sc-domain:exemple.fr')
  for (const bad of ['', 'exemple.fr', 'sc-domain:', 'sc-domain:exemple', 'sc-domain:https://exemple.fr', 'https://exemple.fr/?a=1', 'https://exemple.fr/#x', 'https://moi:secret@exemple.fr/', 'ftp://exemple.fr', null, undefined])
    assert.equal(scProperty(bad), '', String(bad))
})

test('réglages : erreurs par réglage, module prêt seulement quand tout y est', () => {
  assert.deepEqual(searchConsoleSettingsErrors({ property: 'https://exemple.fr', clientId: 'abc.apps.googleusercontent.com' }), {})
  assert.deepEqual(Object.keys(searchConsoleSettingsErrors({ property: 'exemple.fr', clientId: 'abc' })).sort(), ['clientId', 'property'])
  const good = { property: 'sc-domain:exemple.fr', clientId: 'abc.apps.googleusercontent.com', clientSecret: 's', refreshToken: 't' }
  assert.equal(searchConsoleReady(good), true)
  assert.equal(searchConsoleReady({ ...good, refreshToken: '' }), false)
  assert.equal(searchConsoleReady({ ...good, property: 'exemple.fr' }), false)
})

test('période : elle s\'arrête avant-hier, au jour de Google ; périodes inconnues ramenées à 28 jours', () => {
  // Le 26 novembre 2026 à midi (UTC) : il est 4 h du matin à Los Angeles, le même jour.
  const now = Date.UTC(2026, 10, 26, 12)
  assert.deepEqual(scRange(7, now), { from: '2026-11-18', to: '2026-11-24' })
  assert.deepEqual(scRange(28, now), { from: '2026-10-28', to: '2026-11-24' })
  // À 3 h du matin (UTC), c'est encore la veille à Los Angeles.
  assert.equal(scRange(7, Date.UTC(2026, 10, 26, 3)).to, '2026-11-23')
  assert.equal(parseScPeriod('90'), 90)
  assert.equal(parseScPeriod('30'), 28)
  assert.equal(parseScPeriod(undefined), 28)
})

test('demandes : totaux sans regroupement, regroupement avec sa limite, dates contrôlées', () => {
  const range = { from: '2026-11-01', to: '2026-11-28' }
  assert.deepEqual(scQueryBody(range, null), { startDate: '2026-11-01', endDate: '2026-11-28', type: 'web' })
  assert.deepEqual(scQueryBody(range, 'query'), { startDate: '2026-11-01', endDate: '2026-11-28', type: 'web', dimensions: ['query'], rowLimit: 50 })
  assert.equal(scQueryBody(range, 'page').rowLimit, 1000)
  assert.throws(() => scQueryBody({ from: '2026-11-01\' OR', to: '2026-11-28' }, null))
})

test('lecture : lignes, totaux, réponse vide ou illisible', () => {
  const body = { rows: [{ keys: ['avocat lyon'], clicks: 12, impressions: 300, ctr: 0.04, position: 3.25 }, { keys: ['cabinet durand'], clicks: '5', impressions: 20, ctr: 0.25, position: 1 }] }
  assert.deepEqual(readScRows(body), [
    { key: 'avocat lyon', clicks: 12, impressions: 300, ctr: 0.04, position: 3.25 },
    { key: 'cabinet durand', clicks: 5, impressions: 20, ctr: 0.25, position: 1 },
  ])
  assert.deepEqual(readScTotals({ rows: [{ clicks: 17, impressions: 320, ctr: 0.053125, position: 3.1 }] }), { clicks: 17, impressions: 320, ctr: 0.053125, position: 3.1 })
  assert.deepEqual(readScTotals({}), { clicks: 0, impressions: 0, ctr: 0, position: 0 })
  assert.deepEqual(readScRows(null), [])
  assert.deepEqual(readScRows({ rows: 'non' }), [])
})

test('pages : variantes d\'une même adresse regroupées, position pondérée par les affichages', () => {
  assert.equal(scPagePath('https://www.exemple.fr/services/droit-des-affaires/?utm=x#haut'), '/services/droit-des-affaires')
  assert.equal(scPagePath('https://exemple.fr'), '/')
  assert.equal(scPagePath('https://exemple.fr/caf%C3%A9'), '/café')
  assert.equal(scPagePath('pas une adresse'), null)
  const pages = scPagesByPath([
    { key: 'https://exemple.fr/services/', clicks: 4, impressions: 100, ctr: 0.04, position: 2 },
    { key: 'http://www.exemple.fr/services', clicks: 1, impressions: 300, ctr: 0.0033, position: 10 },
    { key: 'https://exemple.fr/', clicks: 9, impressions: 90, ctr: 0.1, position: 1 },
    { key: 'illisible', clicks: 50, impressions: 50, ctr: 1, position: 1 },
  ])
  assert.deepEqual(pages.map(p => p.path), ['/', '/services'])
  assert.deepEqual(pages[1], { path: '/services', clicks: 5, impressions: 400, ctr: 5 / 400, position: 8 })
  assert.deepEqual(sumScMetrics([]), { clicks: 0, impressions: 0, ctr: 0, position: 0 })
})

test('jours : un point par jour, y compris sans affichage', () => {
  const days = scDays([{ key: '2026-11-02', clicks: 3, impressions: 40, ctr: 0, position: 0 }], { from: '2026-11-01', to: '2026-11-03' })
  assert.deepEqual(days, [{ date: '2026-11-01', clicks: 0, impressions: 0 }, { date: '2026-11-02', clicks: 3, impressions: 40 }, { date: '2026-11-03', clicks: 0, impressions: 0 }])
})

test('refus de Google traduits', () => {
  assert.match(scFailure(403, { error: { status: 'PERMISSION_DENIED', details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] } }).message, /webmasters\.readonly/)
  assert.match(scFailure(403, { error: { message: 'Google Search Console API has not been used in project 1 before or it is disabled.' } }).message, /n'est pas activée/)
  assert.match(scFailure(403, { error: { message: 'User does not have sufficient permission for site \'https://exemple.fr/\'.' } }).message, /n'a pas accès à cette propriété/)
  assert.match(scFailure(404, {}).message, /n'a pas accès à cette propriété/)
  assert.equal(scFailure(401, {}).kind, 'refused')
  assert.deepEqual([scFailure(429, {}).kind, scFailure(503, {}).kind], ['unavailable', 'unavailable'])
  assert.match(scFailure(400, { error: { message: 'Invalid value' } }).message, /\(400\) : Invalid value/)
})

test('affichage : taux de clic et position', () => {
  assert.equal(formatCtr(0.0423), '4,2 %')
  assert.equal(formatPosition(3.25), '3,3')
  assert.equal(formatPosition(0), '—')
})
