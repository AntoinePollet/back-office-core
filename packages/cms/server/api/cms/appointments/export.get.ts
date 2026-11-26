import { appointmentsCsv } from '../../../../shared/appointments'
import { allAppointments, requireAppointmentsAccess } from '../../../cms-modules/appointments'

/** Tous les rendez-vous, en CSV pour un tableur. */
export default defineEventHandler(async (event) => {
  const user = await requireAppointmentsAccess(event)
  const rows = await allAppointments(event)
  logActivity(event, { action: 'appointments.exported', category: 'settings', actor: user, target: { kind: 'appointments' }, phrase: `a exporté les rendez-vous (${rows.length})` })
  setResponseHeaders(event, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="rendez-vous.csv"' })
  return appointmentsCsv(rows, siteTimeZone())
})
