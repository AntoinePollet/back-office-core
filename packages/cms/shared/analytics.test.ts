import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  AudienceError, cloudflareAudienceRequest, cloudflareBeacon, cloudflareSettingsErrors, parsePeriod, periodDays, plausibleAudienceRequests,
  plausibleBeacon, plausibleHost, plausibleSettingsErrors, readCloudflareAudience, readPlausibleAudience,
} from './analytics.ts'
import { analytics, plausible, turnstile } from './modules.ts'

const NOW = Date.parse('2026-11-18T15:30:00Z')
const TOKEN = '0123456789abcdef0123456789abcdef'

test('analytics() et turnstile() : déclaration dans cms.config.ts', () => {
  assert.deepEqual(analytics(), { id: 'analytics' })
  assert.deepEqual(analytics({ provider: 'plausible' }), { id: 'plausible' })
  assert.deepEqual(plausible(), { id: 'plausible' })
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

// ───────────── Plausible ─────────────

test('réglages Plausible : domaine, adresse d\'une instance, balise sans injection possible', () => {
  assert.deepEqual(plausibleSettingsErrors({ domain: 'cabinet-durand.fr' }), {})
  assert.deepEqual(plausibleSettingsErrors({}), {}, 'un réglage vide n\'est pas une erreur : il est « à régler »')
  assert.deepEqual(plausibleSettingsErrors({ domain: 'blog.cabinet-durand.fr', host: 'https://stats.cabinet-durand.fr/' }), {})
  const errors = plausibleSettingsErrors({ domain: 'https://cabinet-durand.fr/', host: 'http://stats.exemple.fr' })
  assert.deepEqual(Object.keys(errors).sort(), ['domain', 'host'])
  assert.ok(plausibleSettingsErrors({ host: 'https://x.fr/"><script>' }).host)
  assert.equal(plausibleSettingsErrors({ domain: 'cabinet"><script>.fr' }).domain !== undefined, true)
  assert.equal(plausibleHost(''), 'https://plausible.io')
  assert.equal(plausibleHost(' https://stats.exemple.fr/ '), 'https://stats.exemple.fr')
  assert.equal(plausibleBeacon({ domain: 'Cabinet-Durand.fr' }), '<script defer data-domain="cabinet-durand.fr" src="https://plausible.io/js/script.js"></script>')
  assert.equal(plausibleBeacon({ domain: 'cabinet-durand.fr', host: 'https://stats.exemple.fr' }), '<script defer data-domain="cabinet-durand.fr" src="https://stats.exemple.fr/js/script.js"></script>')
  assert.equal(plausibleBeacon({ domain: 'cabinet"><script>.fr' }), null)
  assert.equal(plausibleBeacon({}), null)
})

test('requêtes Plausible : période se terminant aujourd\'hui, quatre regroupements', () => {
  const r = plausibleAudienceRequests(' Cabinet-Durand.fr ', 7, NOW)
  assert.deepEqual(r.total, { site_id: 'cabinet-durand.fr', date_range: ['2026-11-12', '2026-11-18'], metrics: ['visits', 'pageviews'] })
  assert.deepEqual(r.days.dimensions, ['time:day'])
  assert.deepEqual(r.pages.dimensions, ['event:page'])
  assert.deepEqual(r.referrers.dimensions, ['visit:source'])
  assert.equal(r.pages.pagination.limit, 10)
})

test('réponse Plausible : jours complétés, sources, accès direct', () => {
  const ok = (results: unknown[]) => ({ status: 200, body: { results } })
  const stats = readPlausibleAudience({
    total: ok([{ dimensions: [], metrics: [12, 40] }]),
    days: ok([{ dimensions: ['2026-11-17'], metrics: [5, 15] }, { dimensions: ['2026-11-18'], metrics: [7, 25] }]),
    pages: ok([{ dimensions: ['/'], metrics: [30] }, { dimensions: ['/contact'], metrics: [10] }, { dimensions: ['/vide'], metrics: [0] }]),
    referrers: ok([{ dimensions: ['Direct / None'], metrics: [8] }, { dimensions: ['Google'], metrics: [4] }]),
  }, 7, NOW)
  assert.deepEqual(stats.totals, { visits: 12, pageViews: 40 })
  assert.equal(stats.days.length, 7)
  assert.deepEqual(stats.days.at(-1), { date: '2026-11-18', visits: 7, pageViews: 25 })
  assert.deepEqual(stats.days[0], { date: '2026-11-12', visits: 0, pageViews: 0 })
  assert.deepEqual(stats.pages, [{ path: '/', pageViews: 30 }, { path: '/contact', pageViews: 10 }])
  assert.deepEqual(stats.referrers, [{ host: null, visits: 8 }, { host: 'Google', visits: 4 }])
})

test('réponse Plausible : clé refusée, site inconnu, limite, panne', () => {
  const ok = { status: 200, body: { results: [] } }
  const answers = (bad: { status: number; body: unknown }) => ({ total: bad, days: ok, pages: ok, referrers: ok })
  const kind = (bad: { status: number; body: unknown }) => {
    try { readPlausibleAudience(answers(bad), 7, NOW); return 'ok' }
    catch (e) { assert.ok(e instanceof AudienceError); return `${e.kind}: ${e.message}` }
  }
  assert.match(kind({ status: 401, body: { error: 'Invalid API key' } }), /^refused: Plausible refuse cette clé/)
  assert.match(kind({ status: 400, body: { error: 'Site not found' } }), /^refused: Plausible ne trouve pas ce site/)
  assert.match(kind({ status: 429, body: null }), /^unavailable: Plausible limite/)
  assert.match(kind({ status: 500, body: null }), /^unavailable: .*erreur 500/)
  assert.equal(kind(ok), 'ok')
})
