import { serverError } from '../../shared/monitoring'
import { captureError, monitoringActive } from '../cms-modules/monitoring'

/**
 * Suivi des erreurs (module `monitoring`) :
 * - toute erreur inattendue du serveur (réponse 500 et au-delà) est enregistrée, sans rien changer à la réponse ;
 * - les pages rendues par le serveur reçoivent le signal qui fait relever les erreurs du navigateur : une balise
 *   `<meta>`, pas un script, pour ne rien demander à une politique de sécurité du contenu (CSP) stricte
 *   (voir app/plugins/cms-monitoring.client.ts). Sans le module, ni l'un ni l'autre.
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('error', (error, context) => {
    const event = context?.event
    const status = Number((error as { statusCode?: number }).statusCode ?? 500)
    // Une page introuvable ou un accès refusé ne sont pas des pannes. Le suivi lui-même n'est pas suivi.
    if (!event || status < 500 || event.path.startsWith('/api/monitoring/')) return
    const run = captureError(event, serverError(error, { path: event.path, method: event.method, status }))
    event.waitUntil(run)
  })
  nitroApp.hooks.hook('render:html', async (html, { event }) => {
    if ('preview' in getQuery(event)) return
    if (await monitoringActive(event).catch(() => false)) html.head.push('<meta name="cms-monitoring" content="1">')
  })
})
