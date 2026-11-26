// Ce que le faux service répond à la place de Google : jeton d'accès (OAuth), API REST de Google Ads, Search Console, Google Analytics.

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

// ───── Search Console ─────
/** Propriétés qui changent la réponse du faux Search Console. Toute autre propriété reçoit les chiffres d'exemple. */
export const SC_UNKNOWN = 'https://inconnu.fr/' // le compte Google n'y a pas accès
export const SC_UNVERIFIED = 'sc-domain:pas-validee.fr'
export const SC_DOWN = 'https://en-panne.fr/'
export const SC_EMPTY = 'https://tout-neuf.fr/' // aucun affichage
/** Jeton d'actualisation créé sans l'autorisation « webmasters.readonly ». */
export const TOKEN_WITHOUT_WEBMASTERS = 'jeton-sans-webmasters'
/** Recherches et pages d'exemple. Deux adresses de Google désignent la même page du site (« /services/droit-des-affaires »). */
export const SC_QUERIES = [
  { keys: ['avocat droit des affaires lyon'], clicks: 30, impressions: 600, ctr: 0.05, position: 4.2 },
  { keys: ['cabinet durand'], clicks: 12, impressions: 40, ctr: 0.3, position: 1.1 },
  { keys: ['créer une sarl'], clicks: 0, impressions: 260, ctr: 0, position: 18.4 },
]
export const SC_PAGES = [
  { keys: ['https://cabinet-durand.fr/'], clicks: 20, impressions: 300, ctr: 0.0667, position: 2 },
  { keys: ['https://cabinet-durand.fr/services/droit-des-affaires'], clicks: 18, impressions: 400, ctr: 0.045, position: 4 },
  { keys: ['https://www.cabinet-durand.fr/services/droit-des-affaires/'], clicks: 2, impressions: 100, ctr: 0.02, position: 9 },
  { keys: ['https://cabinet-durand.fr/ancienne-page'], clicks: 2, impressions: 100, ctr: 0.02, position: 30 },
]
export const SC_TOTALS = { clicks: 42, impressions: 900, ctr: 42 / 900, position: 6.5 }

function searchConsole(req, body) {
  const error = (code, message, reason, status) => ({ status: code, json: { error: { code, message, errors: [{ message, domain: 'global', reason }], ...(status ? { status } : {}) } } })
  const match = /^\/google-sc\/webmasters\/v3\/sites\/([^/]+)(\/searchAnalytics\/query)?$/.exec(req.url)
  if (!match) return error(404, 'Not Found', 'notFound')
  const auth = req.headers.authorization ?? ''
  if (!/^Bearer acces-/.test(auth)) return error(401, 'Request had invalid authentication credentials.', 'authError', 'UNAUTHENTICATED')
  if (auth === `Bearer acces-${TOKEN_WITHOUT_WEBMASTERS}`) return error(403, 'Request had insufficient authentication scopes.', 'insufficientPermissions', 'PERMISSION_DENIED')
  const site = decodeURIComponent(match[1])
  if (site === SC_DOWN) return error(503, 'The service is currently unavailable.', 'backendError', 'UNAVAILABLE')
  if (site === SC_UNKNOWN) return error(403, `User does not have sufficient permission for site '${site}'. See also: https://support.google.com/webmasters/answer/2451999.`, 'forbidden')
  if (!match[2]) {
    if (req.method !== 'GET') return error(405, 'Method Not Allowed', 'httpMethodNotAllowed')
    return { status: 200, json: { siteUrl: site, permissionLevel: site === SC_UNVERIFIED ? 'siteUnverifiedUser' : 'siteFullUser' } }
  }
  const day = /^\d{4}-\d{2}-\d{2}$/
  if (req.method !== 'POST' || !day.test(body?.startDate ?? '') || !day.test(body?.endDate ?? '') || body.startDate > body.endDate) return error(400, 'Invalid date range.', 'invalidParameter')
  if (site === SC_EMPTY) return { status: 200, json: { responseAggregationType: 'byProperty' } }
  const dimension = body.dimensions?.[0]
  const rows = !dimension ? [SC_TOTALS]
    : dimension === 'date' ? [{ keys: [body.startDate], clicks: 10, impressions: 200, ctr: 0.05, position: 7 }, { keys: [body.endDate], clicks: 32, impressions: 700, ctr: 0.0457, position: 6.4 }]
      : dimension === 'query' ? SC_QUERIES
        : dimension === 'page' ? SC_PAGES : null
  if (!rows) return error(400, `Invalid value '${dimension}'.`, 'invalidParameter')
  return { status: 200, json: { rows: rows.slice(0, body.rowLimit ?? 1000), responseAggregationType: dimension === 'page' ? 'byPage' : 'byProperty' } }
}

// ───── Google Analytics (API de données) ─────
/** Propriétés qui changent la réponse du faux Google Analytics. Toute autre propriété reçoit les chiffres d'exemple. */
export const GA_UNKNOWN = '999999999' // le compte Google n'y a pas accès
export const GA_DOWN = '888888888'
export const GA_EMPTY = '777777777' // aucune visite
export const GA_NO_API = '666666666' // API de données non activée dans le projet Google Cloud
/** Jeton d'actualisation créé sans l'autorisation « analytics.readonly ». */
export const TOKEN_WITHOUT_ANALYTICS = 'jeton-sans-analytics'
/** Chiffres d'exemple : deux jours avec des visites (le premier et le dernier de la période), trois pages, quatre sources. */
export const GA_TOTALS = { visits: 40, pageViews: 95 }
export const GA_PAGES = [['/', 60], ['/contact', 35]]
export const GA_SOURCES = [['google', 18], ['(direct)', 12], ['facebook.com', 7], ['(not set)', 3]]

function analyticsData(req, body) {
  const error = (code, status, message, reason) => ({ status: code, json: { error: { code, message, status, details: reason ? [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason, domain: 'googleapis.com' }] : [] } } })
  const property = /^\/google-analytics\/v1beta\/properties\/(\d+):batchRunReports$/.exec(req.url)?.[1]
  if (!property || req.method !== 'POST') return error(404, 'NOT_FOUND', 'Not found.')
  const auth = req.headers.authorization ?? ''
  if (!/^Bearer acces-/.test(auth)) return error(401, 'UNAUTHENTICATED', 'Request had invalid authentication credentials.')
  if (auth === `Bearer acces-${TOKEN_WITHOUT_ANALYTICS}`) return error(403, 'PERMISSION_DENIED', 'Request had insufficient authentication scopes.', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT')
  if (property === GA_NO_API) return error(403, 'PERMISSION_DENIED', 'Google Analytics Data API has not been used in project 1 before or it is disabled.', 'SERVICE_DISABLED')
  if (property === GA_DOWN) return error(503, 'UNAVAILABLE', 'The service is currently unavailable.')
  if (property === GA_UNKNOWN) return error(403, 'PERMISSION_DENIED', 'User does not have sufficient permissions for this property.')
  const requests = body?.requests
  if (!Array.isArray(requests) || !requests.length || requests.length > 5) return error(400, 'INVALID_ARGUMENT', 'Invalid requests.')
  const day = /^\d{4}-\d{2}-\d{2}$/
  const row = (dimension, ...values) => ({ ...(dimension === null ? {} : { dimensionValues: [{ value: dimension }] }), metricValues: values.map(v => ({ value: String(v) })) })
  const reports = []
  for (const request of requests) {
    const range = request.dateRanges?.[0]
    if (!day.test(range?.startDate ?? '') || !day.test(range?.endDate ?? '') || range.startDate > range.endDate) return error(400, 'INVALID_ARGUMENT', 'Invalid date range.')
    const metrics = (request.metrics ?? []).map(m => m.name)
    if (!metrics.length || metrics.some(m => !['sessions', 'screenPageViews'].includes(m))) return error(400, 'INVALID_ARGUMENT', `Field ${metrics.join(',')} is not a valid metric.`)
    const dimension = request.dimensions?.[0]?.name
    if (property === GA_EMPTY) { reports.push({ kind: 'analyticsData#runReport', rowCount: 0 }); continue }
    const compact = d => d.replaceAll('-', '')
    const rows = !dimension ? [row(null, GA_TOTALS.visits, GA_TOTALS.pageViews)]
      : dimension === 'date' ? [row(compact(range.startDate), 10, 20), row(compact(range.endDate), 30, 75)]
        : dimension === 'pagePath' ? GA_PAGES.map(([path, views]) => row(path, views))
          : dimension === 'sessionSource' ? GA_SOURCES.map(([source, visits]) => row(source, visits)) : null
    if (!rows) return error(400, 'INVALID_ARGUMENT', `Field ${dimension} is not a valid dimension.`)
    reports.push({ kind: 'analyticsData#runReport', rows, rowCount: rows.length })
  }
  return { status: 200, json: { kind: 'analyticsData#batchRunReports', reports } }
}

// ───── API Places (avis Google) ─────
/** Établissements qui changent la réponse du faux Google Maps. Tout autre identifiant reçoit la fiche d'exemple. */
export const PLACE_UNKNOWN = 'ChIJ-etablissement-inconnu-0000'
export const PLACE_NEW = 'ChIJ-etablissement-sans-avis-00' // ni note, ni avis, ni horaires
export const PLACE_DOWN = 'ChIJ-etablissement-en-panne-000'
/** Clés refusées : inconnue de Google, puis valable mais sans l'API Places activée. */
export const PLACES_KEY_INVALID = 'AIza-cle-inconnue'
export const PLACES_KEY_NO_API = 'AIza-cle-sans-api-places'

const day = (d, from, to) => ({ open: { day: d, hour: from, minute: 0 }, close: { day: d, hour: to, minute: 0 } })
const samplePlace = (id, language) => ({
  id, displayName: { text: 'Cabinet Durand', languageCode: 'fr' }, rating: 4.7, userRatingCount: 128, businessStatus: 'OPERATIONAL',
  googleMapsUri: `https://maps.google.com/?cid=${id}`, googleMapsLinks: { reviewsUri: `https://maps.google.com/reviews/${id}`, writeAReviewUri: `https://maps.google.com/write/${id}` },
  formattedAddress: '12 rue des Lilas, 69003 Lyon, France', nationalPhoneNumber: '04 72 00 00 00',
  regularOpeningHours: {
    periods: [1, 2, 3, 4, 5].map(d => day(d, 9, 18)),
    weekdayDescriptions: language === 'en' ? ['Monday: 9:00 AM – 6:00 PM', 'Saturday: Closed'] : ['lundi: 09:00 – 18:00', 'samedi: Fermé'],
  },
  reviews: [
    { name: `places/${id}/reviews/1`, rating: 5, text: { text: language === 'en' ? 'Very clear advice.' : 'Conseils très clairs, <b>merci</b> !', languageCode: language }, originalText: { text: 'Conseils très clairs, <b>merci</b> !', languageCode: 'fr' }, authorAttribution: { displayName: 'Jeanne Martin', uri: 'https://www.google.com/maps/contrib/1', photoUri: 'https://lh3.googleusercontent.com/a/photo-1' }, publishTime: '2026-10-02T10:00:00Z', relativePublishTimeDescription: language === 'en' ? 'a month ago' : 'il y a un mois', googleMapsUri: 'https://www.google.com/maps/reviews/1', flagContentUri: 'https://www.google.com/local/review/rap/1', visitDate: { year: 2026, month: 9 } },
    { name: `places/${id}/reviews/2`, rating: 4, text: { text: 'Bon accueil.', languageCode: 'fr' }, originalText: { text: 'Bon accueil.', languageCode: 'fr' }, authorAttribution: { displayName: 'Paul Tardif', uri: 'https://www.google.com/maps/contrib/2', photoUri: 'https://lh3.googleusercontent.com/a/photo-2' }, publishTime: '2026-06-02T10:00:00Z', relativePublishTimeDescription: language === 'en' ? '5 months ago' : 'il y a 5 mois', googleMapsUri: 'https://www.google.com/maps/reviews/2' },
    { name: `places/${id}/reviews/3`, rating: 2, text: { text: 'Trop d\'attente.', languageCode: 'fr' }, authorAttribution: { displayName: 'Anonyme', uri: 'https://www.google.com/maps/contrib/3', photoUri: 'https://lh3.googleusercontent.com/a/photo-3' }, publishTime: '2025-06-02T10:00:00Z', relativePublishTimeDescription: language === 'en' ? 'a year ago' : 'il y a un an', googleMapsUri: 'https://www.google.com/maps/reviews/3' },
  ],
})

function places(req) {
  const error = (code, status, message, reason) => ({ status: code, json: { error: { code, message, status, details: reason ? [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason, domain: 'googleapis.com' }] : [] } } })
  const url = new URL(req.url, 'http://faux')
  const id = /^\/google-places\/v1\/places\/([^/]+)$/.exec(url.pathname)?.[1]
  if (!id || req.method !== 'GET') return error(404, 'NOT_FOUND', 'Not found.')
  const key = req.headers['x-goog-api-key']
  if (!key || key === PLACES_KEY_INVALID) return error(400, 'INVALID_ARGUMENT', 'API key not valid. Please pass a valid API key.', 'API_KEY_INVALID')
  if (key === PLACES_KEY_NO_API) return error(403, 'PERMISSION_DENIED', 'Places API (New) has not been used in project 1 before or it is disabled.', 'SERVICE_DISABLED')
  if (!req.headers['x-goog-fieldmask']) return error(400, 'INVALID_ARGUMENT', 'FieldMask is a required parameter.')
  if (id === PLACE_DOWN) return error(503, 'UNAVAILABLE', 'The service is currently unavailable.')
  if (id === PLACE_UNKNOWN) return error(404, 'NOT_FOUND', 'Place ID not found.')
  if (id === PLACE_NEW) return { status: 200, json: { id, displayName: { text: 'Cabinet tout neuf', languageCode: 'fr' }, businessStatus: 'OPERATIONAL', googleMapsUri: `https://maps.google.com/?cid=${id}` } }
  return { status: 200, json: samplePlace(id, url.searchParams.get('languageCode') ?? 'en') }
}

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
    if (req.url.startsWith('/google-sc/')) return searchConsole(req, body)
    if (req.url.startsWith('/google-places/')) return places(req)
    if (req.url.startsWith('/google-analytics/')) return analyticsData(req, body)
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
