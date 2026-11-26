import { findSubscriber, requireNewsletterAccess, unsubscribe } from '../../../../cms-modules/newsletter'

/** Désinscrit quelqu'un à sa demande (reçue par téléphone, par courrier…) : la ligne reste, marquée « désinscrit ». */
export default defineEventHandler(async (event) => {
  const user = await requireNewsletterAccess(event)
  const row = await findSubscriber(event, getRouterParam(event, 'id')!)
  await unsubscribe(event, row)
  logActivity(event, { action: 'newsletter.unsubscribed', category: 'settings', phrase: 'a désinscrit quelqu\'un de la lettre d\'information', actor: user })
  return { ok: true }
})
