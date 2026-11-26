import { APPOINTMENTS } from '../../../shared/appointments'
import { publicSlots } from '../../cms-modules/appointments'

/**
 * Créneaux libres d'une prestation : `?service=…&from=AAAA-MM-JJ&days=14`. Route publique. Les jours et les heures
 * sont ceux du site ; chaque créneau porte aussi son instant (`at`), à renvoyer tel quel pour réserver.
 */
export default defineEventHandler(async (event) => {
  await requireModule(event, 'appointments')
  const query = getQuery(event)
  const days = Math.min(Math.max(Math.trunc(Number(query.days)) || 14, 1), APPOINTMENTS.maxDaysPerQuery)
  return publicSlots(event, String(query.service ?? ''), String(query.from ?? ''), days)
})
