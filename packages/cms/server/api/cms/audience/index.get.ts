import { parsePeriod } from '../../../../shared/analytics'
import { canReadAudience, readAudience } from '../../../cms-modules/analytics'

/** Statistiques de fréquentation du site (module « analytics ») : `?period=7` ou `?period=30` jours. */
export default defineEventHandler(async (event) => {
  requireModule('analytics')
  const user = await requireUser(event)
  if (!canReadAudience(user)) throw createError({ statusCode: 403, message: 'L\'audience du site est réservée aux administrateurs et aux éditeurs.' })
  return readAudience(event, parsePeriod(getQuery(event).period))
})
