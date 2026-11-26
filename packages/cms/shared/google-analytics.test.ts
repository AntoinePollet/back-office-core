import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AudienceError } from './analytics'
import {
  gaCanMeasure, gaCookieNames, gaFailure, gaMeasurementId, gaPropertyId, gaReady, gaReportsBody, gaSettingsErrors, gaTag, readGaAudience,
} from './google-analytics'

const NOW = Date.UTC(2026, 10, 26, 15)
const complete = { measurementId: 'G-AB12CD34EF', propertyId: '123456789', clientId: 'x.apps.googleusercontent.com', clientSecret: 's', refreshToken: 'r' }

test('réglages : identifiants reconnus, écritures tolérées', () => {
  assert.deepEqual(gaSettingsErrors(complete), {})
  assert.equal(gaMeasurementId(' g-ab12cd34ef '), 'G-AB12CD34EF')
  assert.equal(gaPropertyId('properties/123 456 789'), '123456789')
  assert.deepEqual(gaSettingsErrors({ measurementId: 'g-ab12cd34ef', propertyId: 'properties/123456789' }), {})
  assert.ok(gaSettingsErrors({ measurementId: 'UA-12345-1' }).measurementId)
  assert.ok(gaSettingsErrors({ propertyId: 'G-AB12CD34EF' }).propertyId)
  assert.ok(gaSettingsErrors({ clientId: 'pas-un-client' }).clientId)
  // Un réglage absent n'est pas une erreur.
  assert.deepEqual(gaSettingsErrors({}), {})
})

test('réglages complets ou non', () => {
  assert.equal(gaReady(complete), true)
  assert.equal(gaReady({ ...complete, refreshToken: '' }), false)
  assert.equal(gaReady({ ...complete, propertyId: 'abc' }), false)
  assert.equal(gaCanMeasure({ measurementId: 'G-AB12CD34EF' }), true)
  assert.equal(gaCanMeasure({ measurementId: 'G-"><script>' }), false)
})

test('balise : seulement un identifiant valide, rien qui se charge', () => {
  assert.equal(gaTag('g-ab12cd34ef'), '<meta name="cms-google-analytics" content="G-AB12CD34EF">')
  assert.equal(gaTag(undefined), null)
  assert.equal(gaTag('G-"><script>alert(1)</script>'), null)
})

test('cookies à retirer', () => {
  assert.deepEqual(gaCookieNames('G-AB12CD34EF', ['_ga', '_ga_AB12CD34EF', '_ga_AUTRE', 'session', '_gid', '_gat_gtag']), ['_ga', '_ga_AB12CD34EF', '_gid', '_gat_gtag'])
})

test('requête : quatre rapports sur la période', () => {
  const body = { requests: gaReportsBody(7, NOW).requests as Record<string, any>[] }
  assert.equal(body.requests.length, 4)
  assert.deepEqual(body.requests[0]!.dateRanges, [{ startDate: '2026-11-20', endDate: '2026-11-26' }])
  assert.deepEqual(body.requests[1]!.dimensions, [{ name: 'date' }])
  assert.deepEqual(body.requests[2]!.orderBys, [{ metric: { metricName: 'screenPageViews' }, desc: true }])
  assert.deepEqual(body.requests[3]!.dimensions, [{ name: 'sessionSource' }])
  assert.equal(gaReportsBody(30, NOW).requests[0]!.dateRanges[0]!.startDate, '2026-10-28')
})

const row = (dimension: string | null, ...values: number[]) => ({
  ...(dimension === null ? {} : { dimensionValues: [{ value: dimension }] }),
  metricValues: values.map(v => ({ value: String(v) })),
})

test('lecture : totaux, jours complétés, pages, sources', () => {
  const stats = readGaAudience(200, {
    reports: [
      { rows: [row(null, 40, 95)] },
      { rows: [row('20261125', 10, 20), row('20261126', 30, 75)] },
      { rows: [row('/', 60), row('/contact', 35), row('/vide', 0)] },
      { rows: [row('google', 18), row('(direct)', 12), row('(not set)', 3), row('facebook.com', 7)] },
    ],
  }, 7, NOW)
  assert.deepEqual(stats.totals, { visits: 40, pageViews: 95 })
  assert.equal(stats.days.length, 7)
  assert.deepEqual(stats.days.at(-1), { date: '2026-11-26', visits: 30, pageViews: 75 })
  assert.deepEqual(stats.days[0], { date: '2026-11-20', visits: 0, pageViews: 0 })
  assert.deepEqual(stats.pages, [{ path: '/', pageViews: 60 }, { path: '/contact', pageViews: 35 }])
  assert.deepEqual(stats.referrers, [{ host: 'google', visits: 18 }, { host: null, visits: 15 }, { host: 'facebook.com', visits: 7 }])
})

test('lecture : propriété sans visite', () => {
  const stats = readGaAudience(200, { reports: [{}, {}, {}, {}] }, 7, NOW)
  assert.deepEqual(stats.totals, { visits: 0, pageViews: 0 })
  assert.deepEqual(stats.pages, [])
  assert.deepEqual(stats.referrers, [])
})

test('refus et pannes traduits', () => {
  const kind = (status: number, body: unknown = null) => gaFailure(status, body).kind
  assert.equal(kind(401), 'refused')
  assert.equal(kind(403, { error: { status: 'PERMISSION_DENIED' } }), 'refused')
  assert.match(gaFailure(403, { error: { message: 'Google Analytics Data API has not been used in project 1 before' } }).message, /n'est pas activée/)
  assert.match(gaFailure(403, { error: { details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] } }).message, /analytics\.readonly/)
  assert.equal(kind(429), 'unavailable')
  assert.equal(kind(503), 'unavailable')
  assert.throws(() => readGaAudience(403, { error: { code: 403 } }, 7, NOW), AudienceError)
  assert.throws(() => readGaAudience(200, { error: { code: 404, message: 'introuvable' } }, 7, NOW), AudienceError)
})
