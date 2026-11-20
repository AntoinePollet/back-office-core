/**
 * Redirections manuelles : dernier recours avant la page 404.
 *
 * Ce gestionnaire d'erreurs passe avant celui de Nuxt (voir module.ts). Il ne s'exécute que lorsqu'une demande
 * échoue : une page qui existe ne le traverse jamais. Pour une page introuvable, il cherche une redirection manuelle ;
 * s'il y en a une, il répond 301 ou 302, sinon il note l'adresse (pages introuvables) et laisse Nuxt rendre sa page 404.
 */
import type { H3Error, H3Event } from 'h3'
import { getRequestURL, sendRedirect, setResponseStatus } from 'h3'
import { allowSiteCache } from './utils/cache'
import { findRedirect, noteNotFound } from './utils/redirects'

export default async function redirectsErrorHandler(error: H3Error & { status?: number }, event: H3Event) {
  if (event.handled || (error.statusCode ?? error.status) !== 404 || !['GET', 'HEAD'].includes(event.method)) return
  try {
    const url = getRequestURL(event)
    const hit = await findRedirect(event, url.pathname, url.search)
    if (!hit) return noteNotFound(event, url.pathname)
    // Comme une page : gardée par le réseau jusqu'à la prochaine purge, revérifiée par le navigateur à chaque visite.
    allowSiteCache(event)
    // Le texte d'état laissé par l'erreur (« Page not found ») est remplacé.
    setResponseStatus(event, hit.status, hit.status === 301 ? 'Moved Permanently' : 'Found')
    await sendRedirect(event, hit.location, hit.status)
  }
  catch (failure) {
    // Une panne ici ne doit pas empêcher la page 404 de s'afficher.
    console.error('[cms] la recherche d\'une redirection a échoué', failure)
  }
}
