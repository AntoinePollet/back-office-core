import type { H3Event } from 'h3'

export const NO_CACHE = 'private, no-store'
/**
 * Réponses publiques : le navigateur revérifie à chaque visite, le réseau Cloudflare garde la réponse une heure.
 * La purge à la publication rend le site à jour tout de suite ; l'heure est le délai maximal si une purge échoue.
 */
const SITE_CACHE = 'public, max-age=0, s-maxage=3600'
/** Réponses publiques d'un site sans cache partagé : rien n'est gardé sans revérification. */
const REVALIDATE = 'public, max-age=0, must-revalidate'

/** Autorise la mise en cache d'une réponse publique. Jamais en aperçu : un brouillon ne se met pas en cache. */
export function allowSiteCache(event: H3Event) {
  if ('preview' in getQuery(event)) return
  // Une mise en ligne ou un retrait programmés : la réponse ne doit pas être gardée au-delà de cette échéance.
  const until = scheduleCacheSeconds()
  if (until === 0) return
  // Sans cache partagé que le core sache vider (serveur Node), aucun intermédiaire ne garde la page : elle est
  // toujours redemandée au site, qui est donc à jour dès la publication.
  if (!usePlatform().sharedCache) return void setResponseHeader(event, 'cache-control', REVALIDATE)
  setResponseHeader(event, 'cache-control', until !== null && until < 3600 ? `public, max-age=0, s-maxage=${until}` : SITE_CACHE)
}

/**
 * Vide le cache du site sur tout le réseau Cloudflare. À appeler après toute modification visible sur le site.
 * Sur un serveur Node, il n'y a pas de cache partagé : rien à vider, la fonction renvoie `true`.
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
  const purge = usePlatform().cachePurger(event)
  if (!purge) return true
  try {
    const result = await purge()
    if (!result.success) console.error('[cms] purge du cache refusée : le site peut rester en retard jusqu\'à une heure', result.errors)
    return result.success
  }
  catch (error) {
    console.error('[cms] purge du cache impossible : le site peut rester en retard jusqu\'à une heure', error)
    return false
  }
}
