/**
 * Avis Google et fiche d'établissement (module `google-business`) : ce que Google Maps dit de l'établissement (note,
 * nombre d'avis, cinq avis, horaires), lu par l'API Places et montré sur le site.
 *
 * Ce fichier porte la logique pure, sans Nuxt : réglages, demande, lecture de la réponse, messages d'erreur,
 * horaires pour les moteurs de recherche. Les appels sont dans `server/cms-modules/google-business.ts`.
 *
 * ── Ce que Google impose (règles de l'API Places, novembre 2026) ──
 * - Les avis ne sont **pas enregistrés** : ils sont relus chez Google et gardés en mémoire une heure, pas en base.
 *   Seul l'identifiant de l'établissement (« place ID ») peut être gardé sans limite.
 * - Chaque avis affiché porte le nom, la photo et le lien de son auteur, et un lien vers l'avis sur Google Maps.
 * - L'ensemble porte la mention « Google Maps », jamais traduite, et dit comment les avis sont rangés.
 * - L'API donne **cinq avis au plus**, « les plus pertinents » selon Google : le site ne les choisit pas.
 *   Le composant `<CmsGoogleReviews />` respecte ces règles ; un affichage écrit à la main doit les respecter aussi.
 */

type Settings = Record<string, string | undefined>
type Obj = Record<string, any>

/** Ce qui est demandé à Google, et rien d'autre : chaque champ a un prix. */
export const PLACE_FIELDS = [
  'id', 'displayName', 'rating', 'userRatingCount', 'googleMapsUri', 'googleMapsLinks', 'formattedAddress', 'nationalPhoneNumber',
  'businessStatus', 'regularOpeningHours', 'reviews',
] as const

/** Un identifiant d'établissement tel que Google les écrit (« ChIJ… ») ; vide si ce n'en est pas un. */
export const placeId = (value: unknown) => {
  const text = String(value ?? '').trim()
  return /^[A-Za-z0-9_-]{20,300}$/.test(text) ? text : ''
}

/** Réglages refusés à l'enregistrement : clé du réglage → message. */
export function googleBusinessSettingsErrors(settings: Settings): Record<string, string> {
  const errors: Record<string, string> = {}
  if (settings.placeId && !placeId(settings.placeId)) errors.placeId = 'L\'identifiant d\'établissement est une suite de lettres et de chiffres, sans espace, qui commence le plus souvent par « ChIJ ».'
  return errors
}

export const googleBusinessReady = (settings: Settings) => !!settings.apiKey && !!placeId(settings.placeId)

/** Langue demandée à Google : celle de la page si elle en est une, sinon le français. */
export const placeLanguage = (locale: unknown) => (/^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(String(locale ?? '')) ? String(locale) : 'fr')

// ───────────────────────── Lecture de la réponse ─────────────────────────

export type GoogleReview = {
  /** Auteur : nom, page de profil et photo, à afficher avec l'avis. */
  author: string
  authorUrl: string | null
  authorPhoto: string | null
  /** Note de 1 à 5. */
  rating: number
  text: string
  /** Vrai si Google a traduit l'avis : `original` porte alors le texte d'origine. */
  translated: boolean
  original: string | null
  /** « il y a 2 mois », écrit par Google dans la langue demandée. */
  when: string
  publishedAt: string | null
  /** Mois de la visite, « 2026-10 », quand Google le donne (à afficher près de l'avis, en France). */
  visit: string | null
  /** L'avis sur Google Maps, et l'adresse où le signaler. */
  url: string | null
  flagUrl: string | null
}

export type OpeningPeriod = { day: number; open: string; close: string }

export type GooglePlace = {
  name: string
  /** Note moyenne (1 à 5) et nombre d'avis ; null tant que l'établissement n'en a pas. */
  rating: number | null
  count: number
  mapsUrl: string | null
  /** Tous les avis sur Google Maps, et la page où en laisser un. */
  reviewsUrl: string | null
  writeReviewUrl: string | null
  address: string
  phone: string
  /** L'établissement est déclaré fermé (temporairement ou définitivement) sur Google Maps. */
  closed: 'temporarily' | 'permanently' | null
  /** Horaires ordinaires : une ligne lisible par jour (dans la langue demandée), et les plages jour par jour. */
  hours: { lines: string[]; periods: OpeningPeriod[]; always: boolean } | null
  reviews: GoogleReview[]
}

const str = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null)
const httpUrl = (value: unknown) => { const text = str(value); return text && /^https:\/\//.test(text) ? text : null }
const pad = (n: number) => String(n).padStart(2, '0')
const point = (p: Obj | undefined) => (Number.isInteger(p?.day) && p!.day >= 0 && p!.day <= 6 && Number.isInteger(p?.hour) ? { day: p!.day as number, time: `${pad(p!.hour)}:${pad(Number(p!.minute) || 0)}` } : null)

function readReview(raw: Obj): GoogleReview | null {
  const rating = Number(raw?.rating)
  const author = str(raw?.authorAttribution?.displayName)
  if (!author || !(rating >= 1 && rating <= 5)) return null
  const text = str(raw.text?.text) ?? ''
  const original = str(raw.originalText?.text)
  const visit = raw.visitDate
  return {
    author, authorUrl: httpUrl(raw.authorAttribution.uri), authorPhoto: httpUrl(raw.authorAttribution.photoUri), rating: Math.round(rating),
    text, translated: !!original && original !== text, original: original && original !== text ? original : null,
    when: str(raw.relativePublishTimeDescription) ?? '', publishedAt: str(raw.publishTime),
    visit: Number.isInteger(visit?.year) && Number.isInteger(visit?.month) ? `${visit.year}-${pad(visit.month)}` : null,
    url: httpUrl(raw.googleMapsUri), flagUrl: httpUrl(raw.flagContentUri),
  }
}

/** Une réponse « Place Details » → ce que le site et le back-office montrent. Null si ce n'est pas un établissement. */
export function readPlace(body: unknown): GooglePlace | null {
  const raw = body as Obj | null
  const name = str(raw?.displayName?.text)
  if (!raw || !name) return null
  const rating = Number(raw.rating)
  const opening = raw.regularOpeningHours as Obj | undefined
  const periods: OpeningPeriod[] = []
  let always = false
  for (const period of Array.isArray(opening?.periods) ? opening!.periods : []) {
    const open = point(period?.open), close = point(period?.close)
    // Ouvert sans interruption : une seule plage, sans fermeture.
    if (open && !period?.close) { always = true; continue }
    if (open && close) periods.push({ day: open.day, open: open.time, close: close.day === open.day || close.time !== '00:00' ? close.time : '24:00' })
  }
  const status = String(raw.businessStatus ?? '')
  return {
    name,
    rating: rating >= 1 && rating <= 5 ? Math.round(rating * 10) / 10 : null,
    count: Number.isInteger(raw.userRatingCount) && raw.userRatingCount > 0 ? raw.userRatingCount : 0,
    mapsUrl: httpUrl(raw.googleMapsUri),
    reviewsUrl: httpUrl(raw.googleMapsLinks?.reviewsUri) ?? httpUrl(raw.googleMapsUri),
    writeReviewUrl: httpUrl(raw.googleMapsLinks?.writeAReviewUri),
    address: str(raw.formattedAddress) ?? '',
    phone: str(raw.nationalPhoneNumber) ?? '',
    closed: status === 'CLOSED_TEMPORARILY' ? 'temporarily' : status === 'CLOSED_PERMANENTLY' ? 'permanently' : null,
    hours: opening ? { lines: (Array.isArray(opening.weekdayDescriptions) ? opening.weekdayDescriptions : []).map((l: unknown) => String(l)).slice(0, 7), periods, always } : null,
    reviews: (Array.isArray(raw.reviews) ? raw.reviews : []).map(readReview).filter((r: GoogleReview | null): r is GoogleReview => !!r).slice(0, 5),
  }
}

// ───────────────────────── Horaires pour les moteurs de recherche ─────────────────────────

/** Jours de la semaine dans l'ordre de Google : 0 est dimanche. */
const SCHEMA_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/**
 * Les horaires de la fiche Google en `OpeningHoursSpecification` (schema.org), pour le bloc de l'organisme : les
 * jours aux mêmes heures sont regroupés. Vide si la fiche n'a pas d'horaires.
 */
export function openingHoursSpecification(hours: GooglePlace['hours']) {
  if (!hours) return []
  if (hours.always) return [{ '@type': 'OpeningHoursSpecification', 'dayOfWeek': SCHEMA_DAYS.slice(1).concat('Sunday'), 'opens': '00:00', 'closes': '23:59' }]
  const groups = new Map<string, number[]>()
  for (const p of hours.periods) groups.set(`${p.open}-${p.close}`, [...(groups.get(`${p.open}-${p.close}`) ?? []), p.day])
  return [...groups].map(([key, days]) => {
    const [opens, closes] = key.split('-') as [string, string]
    // Lundi d'abord, dimanche en dernier.
    const ordered = [...new Set(days)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
    return { '@type': 'OpeningHoursSpecification', 'dayOfWeek': ordered.map(d => SCHEMA_DAYS[d]!), opens, 'closes': closes === '24:00' ? '23:59' : closes }
  })
}

// ───────────────────────── Refus ─────────────────────────

export type PlaceFailure = { kind: 'refused' | 'unavailable'; message: string }

/** Refus de l'API Places, traduit pour la personne qui règle le module. */
export function placeFailure(status: number, body: unknown): PlaceFailure {
  const raw = typeof body === 'string' ? body : JSON.stringify(body ?? '')
  const has = (text: string) => raw.includes(text)
  if (has('API_KEY_INVALID') || has('API key not valid')) return { kind: 'refused', message: 'Google ne reconnaît pas cette clé d\'API.' }
  if (has('SERVICE_DISABLED') || has('has not been used') || has('API_KEY_SERVICE_BLOCKED')) {
    return { kind: 'refused', message: 'Cette clé n\'a pas le droit d\'appeler « Places API (New) » : activez cette API dans le projet Google Cloud, et vérifiez les restrictions d\'API de la clé.' }
  }
  if (has('API_KEY_HTTP_REFERRER_BLOCKED') || has('API_KEY_IP_ADDRESS_BLOCKED')) {
    return { kind: 'refused', message: 'La clé est restreinte à certains sites ou à certaines adresses IP : le serveur du site n\'en fait pas partie. Retirez la restriction « Sites web » (la clé ne sort jamais du serveur).' }
  }
  if (has('BILLING_DISABLED') || has('billing')) return { kind: 'refused', message: 'La facturation n\'est pas activée sur le projet Google Cloud de cette clé : l\'API Places ne répond pas sans elle.' }
  if (status === 404 || has('NOT_FOUND') || (status === 400 && has('place'))) return { kind: 'refused', message: 'Google ne trouve pas cet établissement : vérifiez son identifiant (« place ID »).' }
  if (status === 429 || has('RESOURCE_EXHAUSTED')) return { kind: 'unavailable', message: 'Le quota de l\'API Places est atteint : réessayez plus tard.' }
  if (status >= 500) return { kind: 'unavailable', message: 'Google Maps ne répond pas pour le moment.' }
  const message = String((body as Obj | null)?.error?.message ?? '').slice(0, 200)
  return { kind: 'refused', message: `Google a refusé la demande (${status})${message ? ` : ${message}` : ''}.` }
}

// ───────────────────────── Affichage ─────────────────────────

/** « 4,7 » / « 4.7 ». */
export const formatRating = (rating: number, locale = 'fr') => rating.toLocaleString(locale.startsWith('fr') ? 'fr-FR' : 'en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
/** « octobre 2026 » à partir de « 2026-10 ». */
export const formatVisit = (visit: string, locale = 'fr') => new Date(`${visit}-15T12:00:00Z`).toLocaleDateString(locale.startsWith('fr') ? 'fr-FR' : 'en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })

/** Textes du bloc d'avis, en français et en anglais (une autre langue du site reçoit l'anglais). */
export const reviewTexts = (locale: string) => (locale.toLowerCase().startsWith('fr')
  ? {
      count: (n: number) => `${n.toLocaleString('fr-FR')} avis`, outOf: 'sur 5', all: 'Voir tous les avis', write: 'Laisser un avis',
      order: 'Avis les plus pertinents selon Google. Ils ne sont pas vérifiés.', translated: 'Traduit par Google', visit: (when: string) => `Visite : ${when}`,
      source: 'Voir l\'avis', stars: (n: number) => `${n} étoile${n > 1 ? 's' : ''} sur 5`,
    }
  : {
      count: (n: number) => `${n.toLocaleString('en-US')} review${n > 1 ? 's' : ''}`, outOf: 'out of 5', all: 'See all reviews', write: 'Write a review',
      order: 'Most relevant reviews according to Google. Reviews are not verified.', translated: 'Translated by Google', visit: (when: string) => `Visited: ${when}`,
      source: 'View review', stars: (n: number) => `${n} star${n > 1 ? 's' : ''} out of 5`,
    })
