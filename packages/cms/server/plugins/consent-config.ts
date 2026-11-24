import { consentConfigTag } from '../../shared/consent'
import { consentConfig } from '../cms-modules/consent'

/**
 * Consentement : donne aux pages du site rendues par le serveur ce qu'il faut pour afficher le bandeau (finalités,
 * lien vers la politique de confidentialité). Jamais dans le back-office ni dans un aperçu de brouillon.
 * Les pages en cache sont purgées quand les réglages du module changent.
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:html', async (html, { event }) => {
    const path = getRequestURL(event).pathname
    if (path === '/admin' || path.startsWith('/admin/') || 'preview' in getQuery(event)) return
    const config = await consentConfig(event).catch((error) => {
      console.error('[cms] consentement : bandeau non ajouté', error)
      return null
    })
    if (config) html.bodyAppend.push(consentConfigTag(config))
  })
})
