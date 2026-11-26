import { sendNewsletterPage, subscriberFromLink } from '../../cms-modules/newsletter'

/**
 * Lien de désinscription : la page pose la question, et c'est son bouton qui désinscrit. Ouvrir le lien ne suffit
 * pas : les messageries et les antivirus ouvrent les liens d'un e-mail avant la personne.
 */
export default defineEventHandler(async (event) => {
  await requireModule(event, 'newsletter')
  const row = await subscriberFromLink(event, 'unsubscribe')
  if (!row) return sendNewsletterPage(event, { kind: 'invalid' }, cmsConfig.site.defaultLocale)
  if (row.status === 'unsubscribed') return sendNewsletterPage(event, { kind: 'left' }, row.locale)
  const url = getRequestURL(event)
  return sendNewsletterPage(event, { kind: 'leave', email: row.email, action: url.pathname + url.search }, row.locale)
})
