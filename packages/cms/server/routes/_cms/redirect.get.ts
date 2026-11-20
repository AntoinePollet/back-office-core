/**
 * Question posée par le navigateur quand une navigation interne (sans rechargement) aboutit à une page introuvable :
 * une redirection manuelle vaut-elle pour ce chemin ? Même réponse que celle du serveur à une visite directe
 * (server/redirects-error-handler.ts). Sans redirection, la demande est comptée parmi les pages introuvables.
 */
export default defineEventHandler(async (event) => {
  const path = String(getQuery(event).path ?? '')
  const [pathname = '', search = ''] = path.split(/(?=\?)/)
  if (!pathname.startsWith('/')) return { to: null }
  const hit = await findRedirect(event, pathname, search.split('#')[0])
  if (hit) return { to: hit.location, status: hit.status, external: hit.external }
  noteNotFound(event, pathname)
  return { to: null }
})
