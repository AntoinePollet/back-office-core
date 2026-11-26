import { describeAppointments, requireAppointmentsAccess } from '../../../cms-modules/appointments'

/** Les rendez-vous à venir et passés, les réglages, et l'état de ce dont le module dépend (e-mails, Stripe). */
export default defineEventHandler(async (event) => {
  await requireAppointmentsAccess(event)
  return describeAppointments(event)
})
