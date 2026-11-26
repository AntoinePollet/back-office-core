import { eq } from 'drizzle-orm'
import { canVisitorCancel } from '../../../shared/appointments'
import { appointmentFromLink, appointmentSettings, cancelAppointment, payAgain, sendAppointmentPage } from '../../cms-modules/appointments'

/**
 * Boutons de la page d'un rendez-vous : annuler, ou (`&do=pay`) régler l'acompte en attente. Le lien signé tient
 * lieu d'identification. L'annulation n'est acceptée que dans le délai réglé.
 */
export default defineEventHandler(async (event) => {
  await requireModule(event, 'appointments')
  const row = await appointmentFromLink(event)
  if (!row) return sendAppointmentPage(event, null)
  if (getQuery(event).do === 'pay') return sendRedirect(event, await payAgain(event, row), 303)
  const settings = await appointmentSettings(event)
  if (row.status === 'pending' || (row.status === 'confirmed' && canVisitorCancel(settings, row.start.getTime()))) {
    const cancelled = await cancelAppointment(event, row, 'visitor')
    if (cancelled) return sendAppointmentPage(event, cancelled)
  }
  // Trop tard, ou déjà annulé : la page dit où en est le rendez-vous.
  const [fresh] = await useDb(event).select().from(schema.appointments).where(eq(schema.appointments.id, row.id))
  return sendAppointmentPage(event, fresh ?? null)
})
