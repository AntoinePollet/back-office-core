/** Autorise la mise en cache des pages du site rendues par le serveur. Le back-office et les aperçus en sont exclus. */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:response', (response, { event }) => {
    const path = getRequestURL(event).pathname
    if (response.statusCode !== 200 || path === '/admin' || path.startsWith('/admin/')) return
    // Une page qui a posé sa propre consigne (par exemple une page personnalisée) la garde.
    if (getResponseHeader(event, 'cache-control') !== NO_CACHE) return
    allowSiteCache(event)
  })
})
