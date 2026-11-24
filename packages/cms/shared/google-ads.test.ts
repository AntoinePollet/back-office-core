import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cleanOrigin } from './attribution.ts'
import {
  type AdsLead, adsCampaignQuery, adsCampaignStateQuery, adsClickQuery, budgetLock, budgetMutation, parseDailyBudget, statusLock, statusMutation, adsCustomerId, adsFailure, adsRange, buildAdsReport, dayIn, formatMicros, googleAdsReady,
  googleAdsSettingsErrors, oauthFailure, parseAdsPeriod, readAdsAccount, readAdsCampaigns, readAdsClick,
} from './google-ads.ts'

const NOW = Date.UTC(2026, 10, 24, 12)

test('réglages : numéros de compte, client OAuth, module prêt', () => {
  assert.equal(adsCustomerId('123-456-7890'), '1234567890')
  assert.equal(adsCustomerId(' 123 456 7890 '), '1234567890')
  assert.equal(adsCustomerId('12345'), '')
  assert.equal(adsCustomerId('customers/1234567890'), '')
  assert.deepEqual(googleAdsSettingsErrors({ customerId: '123-456-7890', clientId: 'abc.apps.googleusercontent.com' }), {})
  assert.deepEqual(Object.keys(googleAdsSettingsErrors({ customerId: '12', loginCustomerId: 'x', clientId: 'abc' })).sort(), ['clientId', 'customerId', 'loginCustomerId'])
  const good = { customerId: '123-456-7890', clientId: 'abc.apps.googleusercontent.com', clientSecret: 's', refreshToken: 'r' }
  assert.equal(googleAdsReady(good), true)
  assert.equal(googleAdsReady({ ...good, refreshToken: '' }), false)
  assert.equal(googleAdsReady({ ...good, loginCustomerId: 'x' }), false)
  assert.equal(parseAdsPeriod('7'), 7)
  assert.equal(parseAdsPeriod('12'), 30)
})

test('période dans le fuseau du compte, requêtes', () => {
  assert.deepEqual(adsRange(7, 'Europe/Paris', NOW), { from: '2026-11-18', to: '2026-11-24' })
  // 23 h 30 à Paris le 24 est déjà le 25 à Auckland.
  assert.equal(dayIn('Pacific/Auckland', Date.UTC(2026, 10, 24, 22, 30)), '2026-11-25')
  assert.equal(dayIn('Fuseau/Inconnu', NOW), '2026-11-24')
  assert.match(adsCampaignQuery('2026-11-01', '2026-11-24'), /FROM campaign WHERE segments\.date BETWEEN '2026-11-01' AND '2026-11-24'$/)
  assert.throws(() => adsCampaignQuery('2026-11-01\' OR 1=1', '2026-11-24'))
  assert.match(adsClickQuery('Cj0KCQiA-abc_123', '2026-11-24')!, /segments\.date = '2026-11-24' AND click_view\.gclid = 'Cj0KCQiA-abc_123'$/)
  // Un identifiant de clic qui ne ressemble pas à un gclid n'entre jamais dans une requête.
  assert.equal(adsClickQuery('x\' OR campaign.id > 0 --', '2026-11-24'), null)
  assert.equal(adsClickQuery('Cj0KCQiA-abc_123', 'hier'), null)
})

test('lecture des réponses : compte, campagnes (entiers en texte, plusieurs pages), clic', () => {
  assert.deepEqual(readAdsAccount({ results: [{ customer: { descriptiveName: 'Cabinet Durand', currencyCode: 'eur', timeZone: 'Europe/Paris' } }] }), { name: 'Cabinet Durand', currency: 'EUR', timeZone: 'Europe/Paris', conversionCustomer: '' })
  // Suivi des conversions fait par le compte administrateur : c'est lui qui possède les actions de conversion.
  assert.equal(readAdsAccount({ results: [{ customer: { conversionTrackingSetting: { googleAdsConversionCustomer: 'customers/1112223333' } } }] })!.conversionCustomer, '1112223333')
  assert.equal(readAdsAccount({ results: [{ customer: { conversionTrackingSetting: { googleAdsConversionCustomer: 'n\'importe quoi' } } }] })!.conversionCustomer, '')
  assert.equal(readAdsAccount({}), null)
  const row = (id: string, name: string, cost: string, clicks: string) => ({ campaign: { id, name, status: 'ENABLED' }, metrics: { impressions: '1000', clicks, costMicros: cost, conversions: 1.5 } })
  const campaigns = readAdsCampaigns([{ results: [row('1', 'A', '1500000', '10'), row('2', 'B', '0', '0')] }, { results: [row('1', 'A', '500000', '5')] }, {}, null])
  assert.deepEqual(campaigns, [
    { id: '1', name: 'A', status: 'ENABLED', budget: null, impressions: 2000, clicks: 15, costMicros: 2_000_000, conversions: 3 },
    { id: '2', name: 'B', status: 'ENABLED', budget: null, impressions: 1000, clicks: 0, costMicros: 0, conversions: 1.5 },
  ])
  assert.deepEqual(readAdsClick({ results: [{ clickView: { gclid: 'x' }, campaign: { id: '101', name: 'Printemps' } }] }), { campaignId: '101', campaignName: 'Printemps' })
  assert.equal(readAdsClick({}), null)
})

test('erreurs traduites : à corriger dans les réglages, ou à réessayer', () => {
  const failure = (errorCode: Record<string, string>) => ({ error: { code: 403, status: 'PERMISSION_DENIED', details: [{ errors: [{ errorCode }] }] } })
  assert.match(adsFailure(403, failure({ authorizationError: 'CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION' })).message, /Explorer/)
  assert.match(adsFailure(403, failure({ authorizationError: 'USER_PERMISSION_DENIED' })).message, /compte administrateur/)
  assert.equal(adsFailure(403, failure({ authorizationError: 'USER_PERMISSION_DENIED' })).kind, 'refused')
  assert.equal(adsFailure(429, {}).kind, 'unavailable')
  assert.equal(adsFailure(503, null).kind, 'unavailable')
  assert.equal(adsFailure(401, {}).kind, 'refused')
  assert.match(adsFailure(400, { error: { message: 'Unrecognized field' } }).message, /Unrecognized field/)
  assert.match(oauthFailure(400, { error: 'invalid_grant' }).message, /7 jours/)
  assert.equal(oauthFailure(401, { error: 'invalid_client' }).kind, 'refused')
  assert.equal(oauthFailure(503, null).kind, 'unavailable')
})

test('rapprochement : par identifiant de campagne, sinon par nom ; coût par contact ; contacts sans campagne', () => {
  const campaigns = [
    { id: '101', name: 'Printemps', status: 'ENABLED', budget: null, impressions: 12000, clicks: 300, costMicros: 150_000_000, conversions: 4.5 },
    { id: '102', name: 'Marque', status: 'PAUSED', budget: null, impressions: 2000, clicks: 50, costMicros: 20_000_000, conversions: 1 },
    { id: '103', name: 'Ancienne', status: 'REMOVED', budget: null, impressions: 0, clicks: 0, costMicros: 0, conversions: 0 },
  ]
  const lead = (kind: AdsLead['kind'], origin: Record<string, unknown>, amount?: number, currency = 'eur'): AdsLead => ({ kind, origin: cleanOrigin(origin, NOW), amount, ...(kind === 'payment' ? { currency } : {}) })
  const report = buildAdsReport(campaigns, [
    lead('message', { click: 'gclid', clickId: 'a', campaignId: '101' }),
    lead('message', { click: 'gclid', clickId: 'b', campaign: ' printemps ' }),
    lead('payment', { source: 'google', medium: 'cpc', campaignId: '101', campaign: 'Autre nom' }, 9980),
    lead('message', { click: 'gclid', clickId: 'c' }),
    lead('payment', { click: 'gclid', clickId: 'd', campaignId: '999' }, 500),
    // Pas Google Ads : ignorés.
    lead('message', { source: 'facebook', medium: 'cpc', campaign: 'Printemps' }),
    lead('message', { referrer: 'www.google.com' }),
    { kind: 'message', origin: null },
  ], 'EUR')
  assert.deepEqual(report.campaigns.map(c => [c.id, c.messages, c.payments, c.contacts, c.revenue, c.costPerContactMicros]), [
    ['101', 2, 1, 3, 9980, 50_000_000],
    ['102', 0, 0, 0, 0, null],
  ])
  assert.deepEqual(report.unassigned, { messages: 1, payments: 1, contacts: 2 })
  assert.deepEqual(report.totals, { impressions: 14000, clicks: 350, costMicros: 170_000_000, conversions: 5.5, messages: 3, payments: 2, contacts: 5, revenue: 9980, costPerContactMicros: 34_000_000 })
  // Paiement dans une autre devise que le compte : compté comme contact, montant non additionné.
  const mixed = buildAdsReport(campaigns, [lead('payment', { campaignId: '101', click: 'gclid', clickId: 'e' }, 5000, 'usd'), lead('payment', { campaignId: '101', click: 'gclid', clickId: 'f' }, 700)], 'EUR')
  assert.deepEqual([mixed.campaigns[0]!.payments, mixed.campaigns[0]!.revenue], [2, 700])
  assert.equal(buildAdsReport([], []).totals.costPerContactMicros, null)
  assert.equal(formatMicros(34_000_000, 'EUR').replace(/\s/g, ' '), '34,00 €')
})

test('piloter une campagne : budget lu, garde-fous, saisie du montant, demandes envoyées à Google', () => {
  const row = (budget: Record<string, unknown>, status = 'ENABLED') => ({
    campaign: { id: '101', name: 'Printemps', status, campaignBudget: 'customers/1234567890/campaignBudgets/555' },
    campaignBudget: { resourceName: 'customers/1234567890/campaignBudgets/555', amountMicros: '20000000', period: 'DAILY', type: 'STANDARD', explicitlyShared: false, referenceCount: '1', ...budget },
  })
  const read = (budget: Record<string, unknown> = {}, status?: string) => readAdsCampaigns([{ results: [row(budget, status)] }])[0]!
  assert.deepEqual(read().budget, { resourceName: 'customers/1234567890/campaignBudgets/555', amountMicros: 20_000_000, shared: false, period: 'DAILY', type: 'STANDARD' })
  assert.equal(budgetLock(read()), null)
  assert.equal(statusLock(read()), null)
  // Seul un budget par jour, propre à la campagne, se change d'ici.
  assert.match(budgetLock(read({ explicitlyShared: true }))!, /partagé/)
  assert.match(budgetLock(read({ referenceCount: '3' }))!, /partagé/)
  assert.match(budgetLock(read({ period: 'CUSTOM_PERIOD', amountMicros: undefined }))!, /période/)
  assert.match(budgetLock(read({ type: 'SMART_CAMPAIGN' }))!, /type de campagne/)
  assert.match(budgetLock(read({}, 'REMOVED'))!, /supprimée/)
  assert.match(statusLock(read({}, 'REMOVED'))!, /supprimée/)
  assert.match(budgetLock({ status: 'ENABLED', budget: null })!, /pas de budget/)
  // Un nom de ressource inattendu n'est jamais renvoyé à Google.
  assert.equal(readAdsCampaigns([{ results: [{ campaign: { id: '1', campaignBudget: 'customers/1/campaigns/9' } }] }])[0]!.budget, null)

  assert.deepEqual(parseDailyBudget('25'), { ok: true, micros: 25_000_000 })
  assert.deepEqual(parseDailyBudget(' 25,50 € '), { ok: true, micros: 25_500_000 })
  assert.deepEqual(parseDailyBudget('1 250.5'), { ok: true, micros: 1_250_500_000 })
  assert.deepEqual(parseDailyBudget('0,07'), { ok: true, micros: 70_000 })
  for (const bad of ['', 'vingt', '-5', '0', '0,00', '12,345', '1e3', '10001', '25,5,5', null]) assert.equal(parseDailyBudget(bad).ok, false, String(bad))

  assert.equal(adsCampaignStateQuery('101')!.endsWith('FROM campaign WHERE campaign.id = 101'), true)
  assert.equal(adsCampaignStateQuery('101 OR 1=1'), null)
  assert.deepEqual(statusMutation('1234567890', '101', 'PAUSED'), { operations: [{ update: { resourceName: 'customers/1234567890/campaigns/101', status: 'PAUSED' }, updateMask: 'status' }] })
  assert.deepEqual(budgetMutation('customers/1234567890/campaignBudgets/555', 25_500_000), { operations: [{ update: { resourceName: 'customers/1234567890/campaignBudgets/555', amountMicros: 25_500_000 }, updateMask: 'amount_micros' }] })
  assert.match(adsFailure(403, { error: { details: [{ errors: [{ errorCode: { authorizationError: 'ACTION_NOT_PERMITTED' } }] }] } }).message, /accès en lecture/)
  assert.match(adsFailure(400, { error: { details: [{ errors: [{ errorCode: { campaignBudgetError: 'BUDGET_BELOW_PER_DAY_MINIMUM' } }] }] } }).message, /minimum/)
})
