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
 * Renvoie `false` si la purge a échoué : le site peut alors rester en retard jusqu'à une heure, et la route
 * doit le transmettre au back-office (`purgeFailed: true`) pour qu'il ne prétende pas que le site est à jour.
 * En local, il n'y a pas de cache : la fonction ne fait rien et renvoie `true`.
 *
 * Pour vérifier l'affichage de l'avertissement en développement, lancer le serveur avec
 * `CMS_DEV_SIMULATE_PURGE_FAILURE=1` : chaque purge est alors déclarée échouée. Sans effet en production.
 */
export async function purgeSiteCache(event: H3Event): Promise<boolean> {
  if (import.meta.dev && process.env.CMS_DEV_SIMULATE_PURGE_FAILURE === '1') {
    console.warn('[cms] purge du cache : échec simulé (CMS_DEV_SIMULATE_PURGE_FAILURE)')
    return false
  }
  const cache = (event.context.cloudflare?.context as { cache?: { purge?: (options: { purgeEverything: true }) => Promise<{ success: boolean; errors?: unknown }> } } | undefined)?.cache
  if (!cache?.purge) return true
  try {
    const result = await cache.purge({ purgeEverything: true })
    if (!result.success) console.error('[cms] purge du cache refusée : le site peut rester en retard jusqu\'à une heure', result.errors)
    return result.success
  }
  catch (error) {
    console.error('[cms] purge du cache impossible : le site peut rester en retard jusqu\'à une heure', error)
    return false
  }
}
