import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  AudienceError, cloudflareAudienceRequest, cloudflareBeacon, cloudflareSettingsErrors, parsePeriod, periodDays, readCloudflareAudience,
} from './analytics.ts'
import { analytics, turnstile } from './modules.ts'

const NOW = Date.parse('2026-11-18T15:30:00Z')
const TOKEN = '0123456789abcdef0123456789abcdef'

test('analytics() et turnstile() : déclaration dans cms.config.ts', () => {
  assert.deepEqual(analytics(), { id: 'analytics', options: { provider: 'cloudflare' } })
  assert.throws(() => analytics({ provider: 'google' as never }), /fournisseur « google » inconnu/)
  assert.deepEqual(turnstile(), { id: 'turnstile' })
})

test('réglages Cloudflare : formats refusés avec un message par réglage', () => {
  assert.deepEqual(cloudflareSettingsErrors({ siteToken: TOKEN, siteTag: TOKEN, accountId: TOKEN }), {})
  assert.deepEqual(cloudflareSettingsErrors({}), {}, 'un réglage vide n\'est pas une erreur : il est « à régler »')
  const errors = cloudflareSettingsErrors({ siteToken: `${TOKEN}"}'><script>`, siteTag: 'a b', accountId: 'pas-un-compte' })
  assert.deepEqual(Object.keys(errors).sort(), ['accountId', 'siteTag', 'siteToken'])
  assert.match(errors.siteToken!, /lettres et des chiffres/)
})

test('balise : le jeton seul, validé ; rien ne peut être injecté dans la page', () => {
  assert.equal(cloudflareBeacon(TOKEN), `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"${TOKEN}"}'></script>`)
  assert.equal(cloudflareBeacon(undefined), null)
  assert.equal(cloudflareBeacon(''), null)
  assert.equal(cloudflareBeacon(`${TOKEN}'><img src=x onerror=alert(1)>`), null)
  assert.equal(cloudflareBeacon('abc'), null, 'trop court')
})

test('période : les 7 ou 30 derniers jours, aujourd\'hui compris (temps universel)', () => {
  assert.deepEqual(periodDays(7, NOW), ['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18'])
  assert.equal(periodDays(30, NOW).length, 30)
  assert.equal(periodDays(30, NOW)[0], '2026-10-20')
  assert.equal(parsePeriod('30'), 30)
  assert.equal(parsePeriod('365'), 7)
  assert.equal(parsePeriod(undefined), 7)
})

test('requête GraphQL : compte, site, bornes de la période, robots écartés', () => {
  const body = cloudflareAudienceRequest({ accountId: 'compte', siteTag: 'site' }, 7, NOW)
  assert.deepEqual(body.variables, { accountTag: 'compte', siteTag: 'site', start: '2026-11-12T00:00:00Z', end: '2026-11-19T00:00:00Z' })
  for (const part of ['rumPageloadEventsAdaptiveGroups', 'total:', 'days:', 'pages:', 'referrers:', 'requestPath', 'refererHost', 'sum { visits }', 'bot: 0', 'orderBy: [date_ASC]', 'orderBy: [count_DESC]']) {
    assert.ok(body.query.includes(part), `requête sans « ${part} »`)
  }
})

const group = (count: number, visits: number, dimensions: Record<string, string>) => ({ count, sum: { visits }, dimensions })

test('réponse : totaux, jours complétés par des zéros, pages et sites d\'origine', () => {
  const body = {
    data: { viewer: { accounts: [{
      total: [{ count: 40, sum: { visits: 12 } }],
      days: [group(10, 3, { date: '2026-11-13' }), group(30, 9, { date: '2026-11-18' })],
      pages: [group(25, 0, { requestPath: '/' }), group(15, 0, { requestPath: '/contact' }), group(0, 0, { requestPath: '/vide' })],
      referrers: [{ sum: { visits: 7 }, dimensions: { refererHost: '' } }, { sum: { visits: 5 }, dimensions: { refererHost: 'www.google.com' } }, { sum: { visits: 0 }, dimensions: { refererHost: 'cabinet-durand.fr' } }],
    }] } },
    errors: null,
  }
  const stats = readCloudflareAudience(200, body, 7, NOW)
  assert.deepEqual(stats.totals, { visits: 12, pageViews: 40 })
  assert.equal(stats.from, '2026-11-12')
  assert.equal(stats.to, '2026-11-18')
  assert.deepEqual(stats.days.map(d => d.pageViews), [0, 10, 0, 0, 0, 0, 30])
  assert.deepEqual(stats.days[1], { date: '2026-11-13', visits: 3, pageViews: 10 })
  assert.deepEqual(stats.pages, [{ path: '/', pageViews: 25 }, { path: '/contact', pageViews: 15 }])
  // Accès direct : pas de site d'origine. Les pages vues depuis le site lui-même ne sont pas des visites.
  assert.deepEqual(stats.referrers, [{ host: null, visits: 7 }, { host: 'www.google.com', visits: 5 }])
})

test('réponse vide : des zéros partout, pas d\'erreur', () => {
  const stats = readCloudflareAudience(200, { data: { viewer: { accounts: [{ total: [], days: [], pages: [], referrers: [] }] } } }, 30, NOW)
  assert.deepEqual(stats.totals, { visits: 0, pageViews: 0 })
  assert.equal(stats.days.length, 30)
  assert.ok(stats.days.every(d => d.pageViews === 0 && d.visits === 0))
})

test('réponse en erreur : jeton refusé, compte introuvable, panne', () => {
  const kind = (status: number, body: unknown) => {
    try { readCloudflareAudience(status, body, 7, NOW); return 'ok' }
    catch (e) { assert.ok(e instanceof AudienceError); return `${e.kind}: ${e.message}` }
  }
  assert.match(kind(200, { data: null, errors: [{ message: 'Authentication error' }] }), /^refused: Cloudflare refuse ce jeton/)
  assert.match(kind(403, { errors: [{ message: 'forbidden' }] }), /^refused/)
  assert.match(kind(200, { data: { viewer: { accounts: [] } } }), /^refused: Ce compte Cloudflare est introuvable/)
  assert.match(kind(200, { data: null, errors: [{ message: 'query complexity exceeded' }] }), /^unavailable: .*query complexity exceeded/)
  assert.match(kind(502, null), /^unavailable: .*erreur 502/)
})
