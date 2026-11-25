import { parseAdsPeriod } from '../../../../shared/google-ads'
import { conversionsOverview } from '../../../cms-modules/google-conversions'
import { canReadGoogleAds, readGoogleAds } from '../../../cms-modules/google-ads'

/** Campagnes Google Ads et contacts du site qu'elles ont amenés : `?days=7`, `30` ou `90`. */
export default defineEventHandler(async (event) => {
  await requireModule(event, 'google-ads')
  const user = await requireUser(event)
  if (!canReadGoogleAds(user)) throw createError({ statusCode: 403, message: 'Les chiffres des annonces sont réservés aux administrateurs et aux éditeurs.' })
  const answer = await readGoogleAds(event, parseAdsPeriod(getQuery(event).days))
  // Conversions envoyées à Google : pour l'administrateur seulement (c'est lui qui les règle).
  if (answer.state !== 'ok' || user.role !== 'admin') return answer
  return { ...answer, conversions: await conversionsOverview(event).catch(() => null) }
})
