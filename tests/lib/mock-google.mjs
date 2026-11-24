// Ce que le faux service répond à la place de Google : jeton d'accès (OAuth) et API REST de Google Ads.

/** Jeton d'actualisation refusé (expiré ou révoqué), et secret de client OAuth inconnu. */
export const TOKEN_REVOKED = 'jeton-revoque'
export const SECRET_UNKNOWN = 'mauvais-secret'
/** Comptes Google Ads qui changent la réponse. Tout autre numéro reçoit les campagnes d'exemple. */
export const CUSTOMER_VIA_MANAGER = '9999999999' // accessible seulement avec le compte administrateur ci-dessous
export const MANAGER = '1112223333'
export const CUSTOMER_TEST_ONLY = '5555555555' // projet Google Cloud limité à l'accès « Test »
export const CUSTOMER_DOWN = '4444444444'
export const CUSTOMER_EMPTY = '3333333333'
/** Identifiant de clic connu de Google : il appartient à la campagne « Printemps ». */
export const KNOWN_GCLID = 'GCLID-PRINTEMPS-0001'

/** Jeton d'actualisation créé sans l'autorisation « datamanager » : les chiffres se lisent, l'envoi de conversions est refusé. */
export const TOKEN_WITHOUT_DATAMANAGER = 'jeton-sans-datamanager'
/** Actions de conversion « importation depuis les clics » du compte d'exemple. */
export const CONVERSION_ACTIONS = [{ id: '7001', name: 'Message du site' }, { id: '7002', name: 'Achat sur le site' }]
/** Identifiant de clic que le faux Google refuse comme illisible, et celui pour lequel il est en panne. */
export const GCLID_UNPARSEABLE = 'GCLID-ILLISIBLE-0000'
export const GCLID_GOOGLE_DOWN = 'GCLID-PANNE-000000'

/** Compte où le jeton n'a qu'un accès en lecture : les chiffres se lisent, toute modification est refusée. */
export const CUSTOMER_READ_ONLY = '2222222222'

/**
 * Campagnes d'exemple, telles que l'API les renvoie (grands entiers en texte). « Printemps » a son propre budget par
 * jour ; « Marque » partage le sien avec une autre campagne ; « Ancienne » est supprimée.
 */
const sampleCampaigns = () => [
  { campaign: { resourceName: 'customers/1/campaigns/101', id: '101', name: 'Printemps', status: 'ENABLED', campaignBudget: 'customers/1/campaignBudgets/501' }, campaignBudget: { resourceName: 'customers/1/campaignBudgets/501', amountMicros: '20000000', explicitlyShared: false, referenceCount: '1', period: 'DAILY', type: 'STANDARD' }, metrics: { impressions: '12000', clicks: '300', costMicros: '150000000', conversions: 4.5 } },
  { campaign: { resourceName: 'customers/1/campaigns/102', id: '102', name: 'Marque', status: 'PAUSED', campaignBudget: 'customers/1/campaignBudgets/502' }, campaignBudget: { resourceName: 'customers/1/campaignBudgets/502', amountMicros: '5000000', explicitlyShared: true, referenceCount: '2', period: 'DAILY', type: 'STANDARD' }, metrics: { impressions: '2000', clicks: '50', costMicros: '20000000', conversions: 1 } },
  { campaign: { resourceName: 'customers/1/campaigns/103', id: '103', name: 'Ancienne', status: 'REMOVED', campaignBudget: 'customers/1/campaignBudgets/503' }, campaignBudget: { resourceName: 'customers/1/campaignBudgets/503', amountMicros: '1000000', explicitlyShared: false, referenceCount: '1', period: 'DAILY', type: 'STANDARD' }, metrics: { impressions: '0', clicks: '0', costMicros: '0', conversions: 0 } },
]
/** Budget par jour en dessous duquel le faux Google refuse (1 unité de la devise). */
export const BUDGET_MINIMUM_MICROS = 1_000_000

const failure = (code, status, message, errorCode) => ({
  status: code,
  json: { error: { code, message, status, details: [{ '@type': 'type.googleapis.com/google.ads.googleads.v26.errors.GoogleAdsFailure', errors: [{ errorCode, message }], requestId: 'test' }] } },
})

/**
 * Un faux Google par suite de tests : l'état et le budget des campagnes y sont retenus, pour vérifier les modifications.
 * `campaigns()` les donne ; `setBudget(id, micros)` joue un changement fait entre-temps dans Google Ads.
 */
export function createGoogle() {
  const campaigns = sampleCampaigns()
  const handle = (req, body) => {
    if (req.url === '/google/token') {
      if (body?.grant_type !== 'refresh_token' || !body.client_id) return { status: 400, json: { error: 'invalid_request' } }
      if (body.client_secret === SECRET_UNKNOWN) return { status: 401, json: { error: 'invalid_client', error_description: 'Unauthorized' } }
      if (body.refresh_token === TOKEN_REVOKED) return { status: 400, json: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } }
      return { status: 200, json: { access_token: `acces-${body.refresh_token}`, expires_in: 3599, scope: 'https://www.googleapis.com/auth/adwords', token_type: 'Bearer' } }
    }
    if (req.url === '/google-datamanager/v1/events:ingest') return ingest(req, body)
    const match = /^\/google-ads\/v26\/customers\/(\d+)\/(googleAds:search|campaigns:mutate|campaignBudgets:mutate)$/.exec(req.url)
    if (!match || req.method !== 'POST') return { status: 404, json: { error: { code: 404, message: 'Not found', status: 'NOT_FOUND' } } }
    if (!/^Bearer acces-/.test(req.headers.authorization ?? '')) return failure(401, 'UNAUTHENTICATED', 'Request had invalid authentication credentials.', { authenticationError: 'OAUTH_TOKEN_INVALID' })
    const [, customer, method] = match
    if (customer === CUSTOMER_DOWN) return { status: 503, json: { error: { code: 503, message: 'The service is currently unavailable.', status: 'UNAVAILABLE' } } }
    if (customer === CUSTOMER_TEST_ONLY) return failure(403, 'PERMISSION_DENIED', 'The Cloud project is only approved for test accounts.', { authorizationError: 'CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION' })
    if (customer === CUSTOMER_VIA_MANAGER && req.headers['login-customer-id'] !== MANAGER) return failure(403, 'PERMISSION_DENIED', 'The caller does not have permission', { authorizationError: 'USER_PERMISSION_DENIED' })
    if (method !== 'googleAds:search') return mutate(customer, method, body)
    const query = String(body?.query ?? '')
    if (query.includes('FROM conversion_action')) {
      return { status: 200, json: { results: CONVERSION_ACTIONS.map(a => ({ conversionAction: { resourceName: `customers/${customer}/conversionActions/${a.id}`, id: a.id, name: a.name, status: 'ENABLED' } })) } }
    }
    if (query.includes('FROM customer')) return { status: 200, json: { results: [{ customer: { resourceName: `customers/${customer}`, descriptiveName: 'Cabinet Durand', currencyCode: 'EUR', timeZone: 'Europe/Paris', conversionTrackingSetting: { googleAdsConversionCustomer: `customers/${customer}` } } }], fieldMask: 'customer.descriptiveName,customer.currencyCode,customer.timeZone' } }
    if (query.includes('FROM click_view')) {
      const known = query.includes(`click_view.gclid = '${KNOWN_GCLID}'`) && /segments\.date = '\d{4}-\d{2}-\d{2}'/.test(query)
      return { status: 200, json: known ? { results: [{ clickView: { gclid: KNOWN_GCLID }, campaign: { id: '101', name: 'Printemps' } }] } : {} }
    }
    // État d'une campagne, relu avant une modification : sans chiffres.
    const one = /FROM campaign WHERE campaign\.id = (\d+)$/.exec(query)
    if (one) {
      const found = campaigns.find(c => c.campaign.id === one[1])
      return { status: 200, json: found ? { results: [{ campaign: found.campaign, campaignBudget: found.campaignBudget }] } : {} }
    }
    if (query.includes('FROM campaign') && /segments\.date BETWEEN '\d{4}-\d{2}-\d{2}' AND '\d{4}-\d{2}-\d{2}'/.test(query)) {
      return { status: 200, json: customer === CUSTOMER_EMPTY ? {} : { results: campaigns, fieldMask: 'campaign.id,campaign.name,campaign.status,metrics.impressions,metrics.clicks,metrics.costMicros,metrics.conversions' } }
    }
    return failure(400, 'INVALID_ARGUMENT', 'Request contains an invalid argument.', { queryError: 'UNRECOGNIZED_FIELD' })
  }

  /** Data Manager API : un événement par demande, comme le fait le core. Les événements acceptés sont retenus. */
  const ingested = []
  function ingest(req, body) {
    const error = (code, status, message, reason) => ({ status: code, json: { error: { code, message, status, details: reason ? [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason }] : [] } } })
    const auth = req.headers.authorization ?? ''
    if (!/^Bearer acces-/.test(auth)) return error(401, 'UNAUTHENTICATED', 'Request had invalid authentication credentials.')
    if (auth === `Bearer acces-${TOKEN_WITHOUT_DATAMANAGER}`) return error(403, 'PERMISSION_DENIED', 'Request had insufficient authentication scopes.', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT')
    const destination = body?.destinations?.[0], event = body?.events?.[0]
    if (body?.destinations?.length !== 1 || body?.events?.length !== 1 || destination?.operatingAccount?.accountType !== 'GOOGLE_ADS') return error(400, 'INVALID_ARGUMENT', 'Invalid request.')
    if (!CONVERSION_ACTIONS.some(a => a.id === destination.productDestinationId)) return error(400, 'INVALID_ARGUMENT', 'Invalid productDestinationId: conversion action not found for this destination.')
    const click = event.adIdentifiers?.gclid ?? event.adIdentifiers?.gbraid ?? event.adIdentifiers?.wbraid
    if (!click || !event.transactionId || Number.isNaN(Date.parse(event.eventTimestamp)) || event.consent?.adUserData !== 'CONSENT_GRANTED') return error(400, 'INVALID_ARGUMENT', 'Invalid event.')
    if (click === GCLID_GOOGLE_DOWN) return error(503, 'UNAVAILABLE', 'The service is currently unavailable.')
    if (click === GCLID_UNPARSEABLE) return error(400, 'INVALID_ARGUMENT', 'events[0].ad_identifiers.gclid: the click identifier could not be decoded.')
    ingested.push({ destination, event })
    return { status: 200, json: { requestId: `demande-${ingested.length}` } }
  }

  /** Une seule opération `update` par demande, comme le fait le core. */
  function mutate(customer, method, body) {
    const op = body?.operations?.[0]
    if (body?.operations?.length !== 1 || !op?.update?.resourceName || typeof op.updateMask !== 'string') return failure(400, 'INVALID_ARGUMENT', 'Invalid mutate request.', { requestError: 'REQUIRED_FIELD_MISSING' })
    if (customer === CUSTOMER_READ_ONLY) return failure(403, 'PERMISSION_DENIED', 'The user does not have permission to perform this action.', { authorizationError: 'ACTION_NOT_PERMITTED' })
    const name = op.update.resourceName
    if (method === 'campaigns:mutate') {
      const found = campaigns.find(c => name === `customers/${customer}/campaigns/${c.campaign.id}`)
      if (!found) return failure(400, 'INVALID_ARGUMENT', 'Resource was not found.', { mutateError: 'RESOURCE_NOT_FOUND' })
      if (op.updateMask !== 'status' || !['ENABLED', 'PAUSED'].includes(op.update.status)) return failure(400, 'INVALID_ARGUMENT', 'Invalid status change.', { campaignError: 'INVALID_STATUS_CHANGE' })
      found.campaign.status = op.update.status
      return { status: 200, json: { results: [{ resourceName: name }] } }
    }
    const found = campaigns.find(c => c.campaignBudget.resourceName === name)
    if (!found) return failure(400, 'INVALID_ARGUMENT', 'Resource was not found.', { mutateError: 'RESOURCE_NOT_FOUND' })
    const micros = Number(op.update.amountMicros)
    if (op.updateMask !== 'amount_micros' || !Number.isInteger(micros) || micros % 10_000) return failure(400, 'INVALID_ARGUMENT', 'Invalid amount.', { campaignBudgetError: 'NON_MULTIPLE_OF_MINIMUM_CURRENCY_UNIT' })
    if (micros < BUDGET_MINIMUM_MICROS) return failure(400, 'INVALID_ARGUMENT', 'Budget below minimum.', { campaignBudgetError: 'BUDGET_BELOW_PER_DAY_MINIMUM' })
    found.campaignBudget.amountMicros = String(micros)
    return { status: 200, json: { results: [{ resourceName: name }] } }
  }

  return {
    handle,
    campaigns: () => campaigns.map(c => ({ id: c.campaign.id, status: c.campaign.status, budgetMicros: Number(c.campaignBudget.amountMicros) })),
    /** Conversions acceptées par la Data Manager API : `{ destination, event }`. */
    ingested: () => [...ingested],
    setBudget: (id, micros) => { campaigns.find(c => c.campaign.id === id).campaignBudget.amountMicros = String(micros) },
  }
}
