import { parsePeriod } from '../../../../shared/analytics'
import { audienceModules, canReadAudience, readAudience } from '../../../cms-modules/audience'

/** Statistiques de fréquentation du site (modules de mesure d'audience) : `?period=7` ou `?period=30` jours. */
export default defineEventHandler(async (event) => {
  if (!(await audienceModules(event)).length) throw createError({ statusCode: 404, message: 'Cette fonction n\'est pas activée sur ce site.' })
  const user = await requireUser(event)
  if (!canReadAudience(user)) throw createError({ statusCode: 403, message: 'L\'audience du site est réservée aux administrateurs et aux éditeurs.' })
  return readAudience(event, parsePeriod(getQuery(event).period))
})
