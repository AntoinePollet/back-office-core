import { describeNewsletter, requireNewsletterAccess } from '../../../cms-modules/newsletter'

/** Les inscrits à la lettre d'information (les plus récents), leur nombre par état, et l'état des réglages. */
export default defineEventHandler(async (event) => {
  await requireNewsletterAccess(event)
  return describeNewsletter(event)
})
