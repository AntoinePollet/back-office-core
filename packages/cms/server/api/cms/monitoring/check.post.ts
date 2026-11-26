import { runMonitoringCheck } from '../../../cms-modules/monitoring'

/** Vérifie le site tout de suite, comme le fait la tâche planifiée toutes les cinq minutes. Administrateur seulement. */
export default defineEventHandler(async (event) => {
  await requireModule(event, 'monitoring')
  await requireAdmin(event)
  return runMonitoringCheck(event)
})
