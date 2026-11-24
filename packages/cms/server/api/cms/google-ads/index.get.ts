import { parseAdsPeriod } from '../../../../shared/google-ads'
import { canReadGoogleAds, readGoogleAds } from '../../../cms-modules/google-ads'

/** Campagnes Google Ads et contacts du site qu'elles ont amenés : `?days=7`, `30` ou `90`. */
export default defineEventHandler(async (event) => {
  await requireModule(event, 'google-ads')
  const user = await requireUser(event)
  if (!canReadGoogleAds(user)) throw createError({ statusCode: 403, message: 'Les chiffres des annonces sont réservés aux administrateurs et aux éditeurs.' })
  return readGoogleAds(event, parseAdsPeriod(getQuery(event).days))
})
