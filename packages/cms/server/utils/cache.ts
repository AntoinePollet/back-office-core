import type { H3Event } from 'h3'

export const NO_CACHE = 'private, no-store'
/**
 * Réponses publiques : le navigateur revérifie à chaque visite, le réseau Cloudflare garde la réponse une heure.
 * La purge à la publication rend le site à jour tout de suite ; l'heure est le délai maximal si une purge échoue.
 */
const SITE_CACHE = 'public, max-age=0, s-maxage=3600'

/** Autorise la mise en cache d'une réponse publique. Jamais en aperçu : un brouillon ne se met pas en cache. */
export function allowSiteCache(event: H3Event) {
  if ('preview' in getQuery(event)) return
  setResponseHeader(event, 'cache-control', SITE_CACHE)
}

/**
 * Vide le cache du site sur tout le réseau Cloudflare. À appeler après toute modification visible sur le site.
 * En local, il n'y a pas de cache : la fonction ne fait rien.
 */
export async function purgeSiteCache(event: H3Event) {
  const cache = (event.context.cloudflare?.context as { cache?: { purge?: (options: { purgeEverything: true }) => Promise<{ success: boolean; errors?: unknown }> } } | undefined)?.cache
  if (!cache?.purge) return
  try {
    const result = await cache.purge({ purgeEverything: true })
    if (!result.success) console.error('[cms] purge du cache refusée : le site peut rester en retard jusqu\'à une heure', result.errors)
  }
  catch (error) {
    console.error('[cms] purge du cache impossible : le site peut rester en retard jusqu\'à une heure', error)
  }
}
