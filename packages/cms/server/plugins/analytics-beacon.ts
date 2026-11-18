import { analyticsBeacon } from '../cms-modules/analytics'

/**
 * Mesure d'audience : ajoute la balise du fournisseur à la fin des pages du site rendues par le serveur.
 * Jamais dans le back-office ni dans un aperçu de brouillon (on ne mesure que les vraies visites).
 * Les pages en cache sont purgées quand les réglages du module changent : la balise apparaît ou disparaît tout de suite.
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:html', async (html, { event }) => {
    const path = getRequestURL(event).pathname
    if (path === '/admin' || path.startsWith('/admin/') || 'preview' in getQuery(event)) return
    const tag = await analyticsBeacon(event).catch((error) => {
      console.error('[cms] mesure d\'audience : balise non ajoutée', error)
      return null
    })
    if (tag) html.bodyAppend.push(tag)
  })
})
