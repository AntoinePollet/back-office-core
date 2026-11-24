import type { VisitOrigin } from '../../shared/attribution'

/**
 * Provenance du visiteur (voir `shared/attribution.ts`) : relevée à son arrivée par le plugin
 * `cms-attribution.client.ts`, envoyée avec les formulaires (`useCmsForm`) et les paiements (`useCmsCheckout`).
 *
 * Gardée en mémoire le temps de la visite. Avec `site.attribution.rememberDays`, elle est aussi gardée sur l'appareil,
 * mais seulement après l'accord du visiteur (`cmsAttributionConsent(true)`), et pour ce nombre de jours.
 */
const STORAGE_KEY = 'cms-origin'
let current: VisitOrigin | null = null
let consent = false

const rememberDays = () => Number((useRuntimeConfig().public.cmsAttribution as { rememberDays?: number } | undefined)?.rememberDays ?? 0)

function readStored(): VisitOrigin | null {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as { origin?: VisitOrigin; expires?: number } | null
    if (raw?.origin && typeof raw.expires === 'number' && raw.expires > Date.now()) return raw.origin
    localStorage.removeItem(STORAGE_KEY)
  }
  catch { /* stockage indisponible ou contenu illisible */ }
  return null
}
function writeStored(origin: VisitOrigin) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ origin, expires: origin.at + rememberDays() * 86_400_000 })) }
  catch { /* stockage indisponible : la provenance reste en mémoire */ }
}

/** Retient une arrivée (la dernière arrivée qui dit d'où vient le visiteur remplace la précédente). */
export function cmsRecordVisit(origin: VisitOrigin) {
  current = origin
  if (consent && rememberDays()) writeStored(origin)
}

/** Provenance à joindre à un envoi : celle de cette visite, sinon celle d'une visite précédente (avec accord). */
export function cmsVisitOrigin(): VisitOrigin | null {
  if (current) return current
  return import.meta.client && consent && rememberDays() ? readStored() : null
}

/**
 * Accord du visiteur pour garder sa provenance d'une visite à l'autre, à appeler par le bandeau de consentement du
 * site (à chaque chargement de page où l'accord est connu). Sans effet si `site.attribution.rememberDays` n'est pas
 * réglé. `false` efface ce qui avait été gardé.
 */
export function cmsAttributionConsent(granted: boolean) {
  if (!import.meta.client) return
  consent = granted
  if (!rememberDays()) return
  if (!granted) {
    try { localStorage.removeItem(STORAGE_KEY) }
    catch { /* stockage indisponible */ }
  }
  else if (current) writeStored(current)
}
