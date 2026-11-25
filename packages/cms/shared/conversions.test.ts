import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cleanOrigin } from './attribution.ts'
import {
  CONVERSION_MAX_TRIES, conversionAfter, conversionCounts, conversionEligible, conversionLabel, conversionStep, ingestOutcome, ingestRequest,
  isConversionActionId, readConversionActions,
} from './conversions.ts'
import { googleAdsSettingsErrors } from './google-ads.ts'

const NOW = Date.UTC(2026, 10, 24, 12)
const HOUR = 3_600_000
const origin = (over: Record<string, unknown> = {}) => cleanOrigin({ click: 'gclid', clickId: 'Cj0KCQiA-abc', consent: true, at: NOW - 8 * HOUR, ...over }, NOW)

test('contact à signaler : un clic Google et l\'accord du visiteur, rien d\'autre', () => {
  assert.equal(conversionEligible(origin()), true)
  assert.equal(conversionEligible(origin({ click: 'wbraid' })), true)
  assert.equal(conversionEligible(origin({ consent: undefined })), false)
  assert.equal(conversionEligible(origin({ click: 'fbclid' })), false)
  assert.equal(conversionEligible(origin({ click: 'msclkid' })), false)
  assert.equal(conversionEligible(cleanOrigin({ source: 'google', medium: 'cpc', consent: true }, NOW)), false)
  assert.equal(conversionEligible(null), false)
})

test('quand envoyer : six heures après le clic, pas deux essais dans l\'heure, jamais après 90 jours', () => {
  const step = (o: Record<string, unknown>, conversion: Record<string, unknown> | null = { state: 'pending' }, createdAt = NOW - HOUR) =>
    conversionStep({ origin: origin(o), createdAt, conversion: conversion as never }, NOW)
  assert.equal(step({}), 'send')
  assert.equal(step({ at: NOW - 5 * HOUR }), 'wait')
  assert.equal(step({ at: NOW - 6 * HOUR }), 'send')
  // Sans date d'arrivée, c'est la date du contact qui compte.
  assert.equal(step({ at: undefined }, { state: 'pending' }, NOW - 2 * HOUR), 'wait')
  assert.equal(step({ at: undefined }, { state: 'pending' }, NOW - 7 * HOUR), 'send')
  assert.equal(step({}, { state: 'pending', at: NOW - 20 * 60_000, tries: 1 }), 'wait')
  assert.equal(step({}, { state: 'pending', at: NOW - 2 * HOUR, tries: 1 }), 'send')
  assert.equal(step({ at: NOW - 91 * 24 * HOUR }), 'expire')
  for (const state of ['sent', 'failed', 'expired']) assert.equal(step({}, { state }), null)
  assert.equal(step({}, null), null)
  assert.equal(step({ consent: undefined }), null)
})

test('demande envoyée à Google : clic, date, identifiant du contact, accord ; montant pour un paiement ; jamais de donnée personnelle', () => {
  const message = ingestRequest({ id: 'msg-1', origin: origin()!, at: NOW }, { account: '1234567890', action: '7001' })
  assert.deepEqual(message, {
    destinations: [{ operatingAccount: { accountId: '1234567890', accountType: 'GOOGLE_ADS' }, productDestinationId: '7001' }],
    events: [{ adIdentifiers: { gclid: 'Cj0KCQiA-abc' }, eventTimestamp: '2026-11-24T12:00:00.000Z', transactionId: 'msg-1', consent: { adUserData: 'CONSENT_GRANTED', adPersonalization: 'CONSENT_DENIED' } }],
  })
  const payment = ingestRequest({ id: 'pay-1', origin: origin({ click: 'gbraid', clickId: 'braid-1' })!, at: NOW, amount: 9980, currency: 'eur' }, { account: '1112223333', login: '1112223333', action: '7002' })
  assert.deepEqual(payment.destinations[0], { operatingAccount: { accountId: '1112223333', accountType: 'GOOGLE_ADS' }, loginAccount: { accountId: '1112223333', accountType: 'GOOGLE_ADS' }, productDestinationId: '7002' })
  assert.deepEqual({ ...payment.events[0], consent: 0, transactionId: 0, eventTimestamp: 0 }, { adIdentifiers: { gbraid: 'braid-1' }, eventTimestamp: 0, transactionId: 0, conversionValue: 99.8, currency: 'EUR', consent: 0 })
  // Devise sans décimales : le montant est déjà en unités.
  assert.equal(ingestRequest({ id: 'p', origin: origin()!, at: NOW, amount: 5000, currency: 'jpy' }, { account: '1', action: '2' }).events[0]!.conversionValue, 5000)
  assert.equal(isConversionActionId('7001'), true)
  assert.equal(isConversionActionId('customers/1/conversionActions/7001'), false)
  assert.deepEqual(Object.keys(googleAdsSettingsErrors({ messageConversion: 'abc', paymentConversion: '7002' })), ['messageConversion'])
})

test('réponse de Google : accepté, refusé pour de bon, à réessayer, ou réglage en cause', () => {
  assert.deepEqual(ingestOutcome(200, { requestId: 'r1' }), { kind: 'sent', requestId: 'r1' })
  assert.equal(ingestOutcome(503, null).kind, 'retry')
  assert.equal(ingestOutcome(429, {}).kind, 'retry')
  assert.equal(ingestOutcome(400, { error: { message: 'gclid could not be decoded' } }).kind, 'failed')
  const scope = ingestOutcome(403, { error: { message: 'Request had insufficient authentication scopes.', details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] } })
  assert.equal(scope.kind, 'config')
  assert.match((scope as { message: string }).message, /datamanager/)
  assert.equal(ingestOutcome(401, {}).kind, 'config')
  assert.equal(ingestOutcome(400, { error: { message: 'Invalid productDestinationId: conversion action not found' } }).kind, 'config')

  const pending = { state: 'pending' as const }
  assert.deepEqual(conversionAfter(pending, { kind: 'sent', requestId: 'r1' }, NOW), { state: 'sent', at: NOW, requestId: 'r1' })
  assert.deepEqual(conversionAfter(pending, { kind: 'failed', message: 'illisible' }, NOW), { state: 'failed', at: NOW, error: 'illisible' })
  assert.deepEqual(conversionAfter(pending, { kind: 'retry', message: 'panne' }, NOW), { state: 'pending', at: NOW, tries: 1, error: 'panne' })
  // Réglage en cause : le contact attend, sans essai compté ni date (il repartira dès la correction).
  assert.deepEqual(conversionAfter({ state: 'pending', tries: 2, at: 5 }, { kind: 'config', message: 'jeton' }, NOW), { state: 'pending', tries: 2, at: 5, error: 'jeton' })
  assert.equal(conversionAfter({ state: 'pending', tries: CONVERSION_MAX_TRIES - 1 }, { kind: 'retry', message: 'panne' }, NOW).state, 'failed')
})

test('libellés, comptes, actions de conversion du compte', () => {
  assert.equal(conversionLabel(null), null)
  assert.match(conversionLabel({ state: 'sent', at: NOW })!, /^signalé à Google Ads le 24 novembre 2026/)
  assert.match(conversionLabel({ state: 'pending' })!, /en attente d'envoi/)
  assert.match(conversionLabel({ state: 'pending', error: 'jeton refusé' })!, /en attente : jeton refusé/)
  assert.match(conversionLabel({ state: 'failed', error: 'illisible' })!, /refusé par Google Ads : illisible/)
  assert.match(conversionLabel({ state: 'expired' })!, /90 jours/)
  assert.deepEqual(conversionCounts([{ conversion: { state: 'sent' } }, { conversion: { state: 'sent' } }, { conversion: { state: 'pending' } }, { conversion: null }]), { pending: 1, sent: 2, failed: 0, expired: 0 })
  assert.deepEqual(readConversionActions([{ results: [{ conversionAction: { id: '7001', name: 'Message' } }, { conversionAction: {} }] }, null]), [{ id: '7001', name: 'Message' }])
})
