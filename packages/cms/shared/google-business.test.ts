import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatRating, formatVisit, googleBusinessReady, googleBusinessSettingsErrors, openingHoursSpecification, placeFailure, placeId, placeLanguage, readPlace, reviewTexts } from './google-business.ts'

const PLACE = {
  id: 'ChIJN1t_tDeuEmsRUsoyG83frY4', displayName: { text: 'Cabinet Durand', languageCode: 'fr' }, rating: 4.66, userRatingCount: 128,
  googleMapsUri: 'https://maps.google.com/?cid=1', googleMapsLinks: { reviewsUri: 'https://maps.google.com/reviews', writeAReviewUri: 'https://maps.google.com/write' },
  formattedAddress: '12 rue des Lilas, 69003 Lyon', nationalPhoneNumber: '04 72 00 00 00', businessStatus: 'OPERATIONAL',
  regularOpeningHours: {
    periods: [
      ...[1, 2, 3, 4].map(day => ({ open: { day, hour: 9, minute: 0 }, close: { day, hour: 18, minute: 0 } })),
      { open: { day: 5, hour: 9, minute: 0 }, close: { day: 5, hour: 12, minute: 30 } },
      { open: { day: 6, hour: 20, minute: 0 }, close: { day: 0, hour: 0, minute: 0 } },
    ],
    weekdayDescriptions: ['lundi: 09:00 – 18:00', 'mardi: 09:00 – 18:00'],
  },
  reviews: [
    { name: 'places/x/reviews/1', rating: 5, text: { text: 'Very clear advice.', languageCode: 'fr' }, originalText: { text: 'Conseils très clairs.', languageCode: 'fr' }, authorAttribution: { displayName: 'Jeanne M.', uri: 'https://maps.google.com/contrib/1', photoUri: 'https://lh3.googleusercontent.com/a/1' }, publishTime: '2026-10-02T10:00:00Z', relativePublishTimeDescription: 'il y a un mois', googleMapsUri: 'https://maps.google.com/review/1', flagContentUri: 'https://maps.google.com/flag/1', visitDate: { year: 2026, month: 9 } },
    { rating: 3, authorAttribution: { displayName: 'Paul', uri: 'javascript:alert(1)', photoUri: 'http://sans-https' }, relativePublishTimeDescription: 'il y a 2 ans' },
    { rating: 9, authorAttribution: { displayName: 'Faux' } },
    { rating: 4 },
  ],
}

test('réglages : identifiant d\'établissement contrôlé, module prêt avec la clé', () => {
  assert.equal(placeId(' ChIJN1t_tDeuEmsRUsoyG83frY4 '), 'ChIJN1t_tDeuEmsRUsoyG83frY4')
  for (const bad of ['', 'trop-court', 'avec espace dedans ChIJN1t_tDeuEm', 'https://maps.google.com/?cid=123456789012345678', null]) assert.equal(placeId(bad), '', String(bad))
  assert.deepEqual(Object.keys(googleBusinessSettingsErrors({ placeId: 'x y' })), ['placeId'])
  assert.equal(googleBusinessReady({ placeId: 'ChIJN1t_tDeuEmsRUsoyG83frY4', apiKey: 'AIza' }), true)
  assert.equal(googleBusinessReady({ placeId: 'ChIJN1t_tDeuEmsRUsoyG83frY4' }), false)
  assert.deepEqual([placeLanguage('en'), placeLanguage('fr-CA'), placeLanguage('../x'), placeLanguage(undefined)], ['en', 'fr-CA', 'fr', 'fr'])
})

test('fiche : note arrondie, liens, horaires, fermeture à minuit', () => {
  const place = readPlace(PLACE)!
  assert.deepEqual([place.name, place.rating, place.count, place.address, place.phone, place.closed], ['Cabinet Durand', 4.7, 128, '12 rue des Lilas, 69003 Lyon', '04 72 00 00 00', null])
  assert.deepEqual([place.mapsUrl, place.reviewsUrl, place.writeReviewUrl], ['https://maps.google.com/?cid=1', 'https://maps.google.com/reviews', 'https://maps.google.com/write'])
  assert.equal(place.hours!.periods.length, 6)
  assert.deepEqual(place.hours!.periods.at(-1), { day: 6, open: '20:00', close: '24:00' })
  assert.deepEqual(place.hours!.lines, ['lundi: 09:00 – 18:00', 'mardi: 09:00 – 18:00'])
  assert.equal(readPlace({ rating: 4 }), null)
  assert.equal(readPlace(null), null)
  const bare = readPlace({ displayName: { text: 'Nouveau' }, businessStatus: 'CLOSED_TEMPORARILY' })!
  assert.deepEqual([bare.rating, bare.count, bare.hours, bare.closed, bare.reviews.length], [null, 0, null, 'temporarily', 0])
})

test('avis : auteur exigé, note contrôlée, liens en https seulement, traduction signalée, mois de la visite', () => {
  const { reviews } = readPlace(PLACE)!
  assert.equal(reviews.length, 2)
  assert.deepEqual(reviews[0], {
    author: 'Jeanne M.', authorUrl: 'https://maps.google.com/contrib/1', authorPhoto: 'https://lh3.googleusercontent.com/a/1', rating: 5,
    text: 'Very clear advice.', translated: true, original: 'Conseils très clairs.', when: 'il y a un mois', publishedAt: '2026-10-02T10:00:00Z', visit: '2026-09',
    url: 'https://maps.google.com/review/1', flagUrl: 'https://maps.google.com/flag/1',
  })
  assert.deepEqual([reviews[1]!.author, reviews[1]!.authorUrl, reviews[1]!.authorPhoto, reviews[1]!.text, reviews[1]!.translated, reviews[1]!.visit], ['Paul', null, null, '', false, null])
  assert.equal(readPlace({ ...PLACE, reviews: Array.from({ length: 9 }, () => PLACE.reviews[0]) })!.reviews.length, 5)
})

test('horaires pour les moteurs de recherche : jours aux mêmes heures regroupés, lundi d\'abord', () => {
  const spec = openingHoursSpecification(readPlace(PLACE)!.hours)
  assert.deepEqual(spec, [
    { '@type': 'OpeningHoursSpecification', 'dayOfWeek': ['Monday', 'Tuesday', 'Wednesday', 'Thursday'], 'opens': '09:00', 'closes': '18:00' },
    { '@type': 'OpeningHoursSpecification', 'dayOfWeek': ['Friday'], 'opens': '09:00', 'closes': '12:30' },
    { '@type': 'OpeningHoursSpecification', 'dayOfWeek': ['Saturday'], 'opens': '20:00', 'closes': '23:59' },
  ])
  assert.deepEqual(openingHoursSpecification(null), [])
  const always = readPlace({ displayName: { text: 'Hôtel' }, regularOpeningHours: { periods: [{ open: { day: 0, hour: 0, minute: 0 } }] } })!
  assert.equal(always.hours!.always, true)
  assert.equal(openingHoursSpecification(always.hours)[0]!.dayOfWeek.length, 7)
})

test('refus de Google traduits', () => {
  assert.match(placeFailure(400, { error: { status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.', details: [{ reason: 'API_KEY_INVALID' }] } }).message, /ne reconnaît pas cette clé/)
  assert.match(placeFailure(403, { error: { status: 'PERMISSION_DENIED', details: [{ reason: 'SERVICE_DISABLED' }] } }).message, /Places API \(New\)/)
  assert.match(placeFailure(403, { error: { details: [{ reason: 'API_KEY_HTTP_REFERRER_BLOCKED' }] } }).message, /restreinte/)
  assert.match(placeFailure(403, { error: { details: [{ reason: 'BILLING_DISABLED' }] } }).message, /facturation/)
  assert.match(placeFailure(404, { error: { status: 'NOT_FOUND' } }).message, /ne trouve pas cet établissement/)
  assert.deepEqual([placeFailure(429, {}).kind, placeFailure(503, {}).kind], ['unavailable', 'unavailable'])
  assert.match(placeFailure(400, { error: { message: 'Invalid field mask' } }).message, /\(400\) : Invalid field mask/)
})

test('affichage : note, mois de la visite, textes par langue', () => {
  assert.deepEqual([formatRating(4.7), formatRating(5, 'en'), formatVisit('2026-09'), formatVisit('2026-09', 'en')], ['4,7', '5.0', 'septembre 2026', 'September 2026'])
  assert.equal(reviewTexts('fr').count(128), '128 avis')
  assert.equal(reviewTexts('de').count(1), '1 review')
  assert.equal(reviewTexts('fr-CA').stars(1), '1 étoile sur 5')
})
