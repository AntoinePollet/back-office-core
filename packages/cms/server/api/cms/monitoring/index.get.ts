import { describeMonitoring } from '../../../cms-modules/monitoring'

/** Erreurs relevées, vérifications du site et pannes des sept derniers jours. Administrateur seulement. */
export default defineEventHandler(async (event) => {
  await requireModule(event, 'monitoring')
  await requireAdmin(event)
  return describeMonitoring(event)
})
