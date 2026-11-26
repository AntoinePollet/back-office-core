import { sendNewsletterPage, subscriberFromLink, unsubscribe } from '../../cms-modules/newsletter'

/** Désinscription demandée par le bouton de la page de désinscription. */
export default defineEventHandler(async (event) => {
  await requireModule(event, 'newsletter')
  const row = await subscriberFromLink(event, 'unsubscribe')
  if (!row) return sendNewsletterPage(event, { kind: 'invalid' }, cmsConfig.site.defaultLocale)
  await unsubscribe(event, row)
  return sendNewsletterPage(event, { kind: 'left' }, row.locale)
})
