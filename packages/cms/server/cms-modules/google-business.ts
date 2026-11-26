import type { H3Event } from 'h3'
import {
  type GooglePlace, PLACE_FIELDS, type PlaceFailure,
  googleBusinessReady, googleBusinessSettingsErrors, openingHoursSpecification, placeFailure, placeId, placeLanguage, readPlace,
} from '../../shared/google-business'
import type { CmsModuleDefinition, ModuleSettings } from '../utils/modules'

/**
 * Avis Google et fiche d'établissement : la note, les avis et les horaires de l'établissement sur Google Maps, lus
 * par l'API Places (voir `shared/google-business.ts`). Lecture seule. Rien de ce que Google renvoie n'est écrit en
 * base : les réponses sont gardées une heure en mémoire, puis redemandées.
 */

class PlaceError extends Error {
  constructor(public failure: PlaceFailure) { super(failure.message) }
}

/** Adresse de l'API Places. Ne se change que pour les tests : NUXT_GOOGLE_PLACES_API_URL. */
const apiUrl = (event: H3Event) => String(useRuntimeConfig(event).googlePlacesApiUrl).replace(/\/$/, '')

async function fetchPlace(event: H3Event, settings: ModuleSettings, locale: string): Promise<GooglePlace> {
  const response = await fetch(`${apiUrl(event)}/places/${placeId(settings.placeId)}?languageCode=${encodeURIComponent(placeLanguage(locale))}`, {
    headers: { 'x-goog-api-key': settings.apiKey ?? '', 'x-goog-fieldmask': PLACE_FIELDS.join(','), 'accept': 'application/json' },
    signal: AbortSignal.timeout(10_000),
  }).catch((error: Error) => {
    throw new PlaceError({ kind: 'unavailable', message: error.name === 'TimeoutError' ? 'Google Maps n\'a pas répondu après 10 secondes.' : 'Google Maps est injoignable pour le moment.' })
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new PlaceError(placeFailure(response.status, body))
  const place = readPlace(body)
  if (!place) throw new PlaceError({ kind: 'refused', message: 'Google n\'a renvoyé aucun établissement pour cet identifiant.' })
  return place
}

export const googleBusinessModule: CmsModuleDefinition = {
  id: 'google-business',
  category: 'seo',
  label: 'Avis Google',
  // Logo de Google Maps (tracé : Simple Icons) et son vert.
  logo: { style: 'fill', color: '#34A853', paths: ['M19.527 4.799c1.212 2.608.937 5.678-.405 8.173-1.101 2.047-2.744 3.74-4.098 5.614-.619.858-1.244 1.75-1.669 2.727-.141.325-.263.658-.383.992-.121.333-.224.673-.34 1.008-.109.314-.236.684-.627.687h-.007c-.466-.001-.579-.53-.695-.887-.284-.874-.581-1.713-1.019-2.525-.51-.944-1.145-1.817-1.79-2.671L19.527 4.799zM8.545 7.705l-3.959 4.707c.724 1.54 1.821 2.863 2.871 4.18.247.31.494.622.737.936l4.984-5.925-.029.01c-1.741.601-3.691-.291-4.392-1.987a3.377 3.377 0 0 1-.209-.716c-.063-.437-.077-.761-.004-1.198l.001-.007zM5.492 3.149l-.003.004c-1.947 2.466-2.281 5.88-1.117 8.77l4.785-5.689-.058-.05-3.607-3.035zM14.661.436l-3.838 4.563a.295.295 0 0 1 .027-.01c1.6-.551 3.403.15 4.22 1.626.176.319.323.683.377 1.045.068.446.085.773.012 1.22l-.003.016 3.836-4.561A8.382 8.382 0 0 0 14.67.439l-.009-.003zM9.466 5.868L14.162.285l-.047-.012A8.31 8.31 0 0 0 11.986 0a8.439 8.439 0 0 0-6.169 2.766l-.016.018 3.665 3.084z'] },
  description: 'La note, les avis et les horaires de l\'établissement sur Google Maps, à afficher sur le site avec `<CmsGoogleReviews />`. Les horaires de la fiche complètent aussi les données transmises aux moteurs de recherche. Lecture seule.',
  settings: [
    {
      key: 'placeId', label: 'Identifiant de l\'établissement (place ID)', type: 'text', required: true, placeholder: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
      help: 'Sur la page « Place ID Finder » de Google (developers.google.com/maps/documentation/places/web-service/place-id), cherchez l\'établissement : son identifiant s\'affiche sous son nom.',
    },
    {
      key: 'apiKey', label: 'Clé d\'API Google Maps', type: 'secret', required: true, placeholder: 'AIza…',
      help: 'Console Google Cloud : activer « Places API (New) » dans un projet (la facturation doit y être activée), puis « Identifiants » → « Créer des identifiants » → « Clé API ». Restreignez-la à cette seule API, sans restriction de site web : elle ne sort jamais du serveur.',
      env: { key: 'googlePlacesApiKey', name: 'NUXT_GOOGLE_PLACES_API_KEY' },
    },
  ],
  adminPage: { to: '/admin/google-business', label: 'Voir les avis' },
  validate: googleBusinessSettingsErrors,
  // La note et les avis figurent dans les pages du site.
  affectsSite: true,

  async test(event, settings) {
    const invalid = Object.values(googleBusinessSettingsErrors(settings))
    if (invalid.length) throw new Error(invalid.join(' '))
    cache.clear()
    const place = await fetchPlace(event, settings, cmsConfig.site.defaultLocale)
    return `Établissement trouvé : « ${place.name} »${place.address ? `, ${place.address}` : ''}. ${place.rating === null ? 'Il n\'a pas encore d\'avis.' : `Note de ${String(place.rating).replace('.', ',')} sur 5 (${place.count} avis).`}`
  },
}

// ───────────── Lecture, gardée une heure en mémoire ─────────────

/**
 * Google facture chaque lecture et interdit d'enregistrer les avis : la réponse est gardée une heure en mémoire, par
 * langue. La mémoire d'un Worker est propre à chaque instance et peut être vidée à tout moment ; les pages du site,
 * elles, passent par le cache du réseau.
 */
const CACHE_MS = 60 * 60_000
const cache = new Map<string, { at: number; place: GooglePlace }>()

export type GoogleBusinessAnswer =
  | { state: 'ok'; place: GooglePlace; updatedAt: string }
  | { state: 'unconfigured' | 'refused' | 'unavailable'; message: string }

async function digest(parts: unknown[]) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(parts)))
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** La fiche de l'établissement dans une langue, ou pourquoi elle manque. Ne lève pas d'erreur. */
export async function readGoogleBusiness(event: H3Event, locale: string): Promise<GoogleBusinessAnswer> {
  const settings = await moduleSettings(event, 'google-business')
  if (!googleBusinessReady(settings)) return { state: 'unconfigured', message: 'Les avis Google ne sont pas encore réglés.' }
  try {
    const key = await digest([settings, placeLanguage(locale)])
    let hit = cache.get(key)
    if (!hit || Date.now() - hit.at >= CACHE_MS) {
      const place = await fetchPlace(event, settings, locale)
      for (const [k, v] of cache) if (Date.now() - v.at >= CACHE_MS) cache.delete(k)
      hit = { at: Date.now(), place }
      cache.set(key, hit)
    }
    return { state: 'ok', place: hit.place, updatedAt: new Date(hit.at).toISOString() }
  }
  catch (error) {
    if (error instanceof PlaceError) return { state: error.failure.kind, message: error.failure.message }
    console.error('[cms] avis google : lecture impossible', error)
    return { state: 'unavailable', message: 'La fiche Google n\'a pas pu être lue pour le moment.' }
  }
}

/**
 * Horaires de la fiche Google pour le bloc de l'organisme (données structurées de la page d'accueil), quand le
 * site n'en déclare pas lui-même. Vide si le module n'est pas actif, pas réglé, ou si Google ne répond pas.
 */
export async function googleOpeningHours(event: H3Event, locale: string) {
  if (!(await activeModule(event, 'google-business'))) return []
  const answer = await readGoogleBusiness(event, locale)
  return answer.state === 'ok' ? openingHoursSpecification(answer.place.hours) : []
}
