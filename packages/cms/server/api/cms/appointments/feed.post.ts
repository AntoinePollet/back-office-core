import { renewAppointmentsFeed } from '../../../cms-modules/appointments'

/**
 * Renouvelle l'adresse de l'agenda à abonner : l'ancienne cesse de répondre, la nouvelle est renvoyée.
 * Administrateur seulement, comme les réglages.
 */
export default defineEventHandler(async (event) => {
  await requireModule(event, 'appointments')
  const user = await requireAdmin(event)
  return renewAppointmentsFeed(event, user)
})
