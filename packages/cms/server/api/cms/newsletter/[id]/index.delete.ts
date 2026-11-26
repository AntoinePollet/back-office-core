import { eraseSubscriber, findSubscriber, requireNewsletterAccess } from '../../../../cms-modules/newsletter'

/** Efface un inscrit : ses données disparaissent du back-office, et il est retiré de la liste du service d'envoi. */
export default defineEventHandler(async (event) => {
  const user = await requireNewsletterAccess(event)
  const row = await findSubscriber(event, getRouterParam(event, 'id')!)
  await eraseSubscriber(event, row)
  // Le journal ne garde pas l'adresse : c'est justement elle qu'on efface.
  logActivity(event, { action: 'newsletter.erased', category: 'settings', phrase: 'a effacé un inscrit à la lettre d\'information', actor: user })
  return { ok: true }
})
