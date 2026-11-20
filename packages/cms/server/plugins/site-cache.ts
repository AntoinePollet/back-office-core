/** Autorise la mise en cache des pages du site rendues par le serveur. Le back-office et les aperçus en sont exclus. */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:response', (response, { event }) => {
    const path = getRequestURL(event).pathname
    if (response.statusCode !== 200 || path === '/admin' || path.startsWith('/admin/')) return
    // La page d'erreur (404…) est rendue par une demande interne qui répond 200 : elle ne se met pas en cache pour autant.
    if ((event.context.nuxt as Record<string, unknown> | undefined)?.['~rendering-error']) return
    if ('preview' in getQuery(event)) {
      // Un aperçu ne doit jamais être indexé, et son adresse (qui peut contenir un jeton) ne doit pas fuiter vers d'autres sites.
      setResponseHeaders(event, { 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'same-origin' })
      return
    }
    // Une page qui a posé sa propre consigne (par exemple une page personnalisée) la garde.
    if (getResponseHeader(event, 'cache-control') !== NO_CACHE) return
    allowSiteCache(event)
  })
})
