import { confirmSubscription, sendNewsletterPage, subscriberFromLink } from '../../cms-modules/newsletter'

/** Lien de l'e-mail de confirmation : l'inscription devient effective, et le visiteur voit une page de confirmation. */
export default defineEventHandler(async (event) => {
  await requireModule(event, 'newsletter')
  const row = await subscriberFromLink(event, 'confirm')
  if (!row) return sendNewsletterPage(event, { kind: 'invalid' }, cmsConfig.site.defaultLocale)
  return sendNewsletterPage(event, await confirmSubscription(event, row), row.locale)
})
