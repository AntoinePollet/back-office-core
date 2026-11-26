import { appointmentFromLink, appointmentIcs } from '../../cms-modules/appointments'

/** « Ajouter à mon agenda » : le rendez-vous au format iCalendar, par le lien signé reçu par e-mail. */
export default defineEventHandler(async (event) => {
  await requireModule(event, 'appointments')
  const row = await appointmentFromLink(event)
  if (!row) throw createError({ statusCode: 404, message: 'Rendez-vous introuvable.' })
  setResponseHeaders(event, { 'content-type': 'text/calendar; charset=utf-8', 'content-disposition': 'attachment; filename="rendez-vous.ics"', 'cache-control': NO_CACHE, 'x-robots-tag': 'noindex' })
  return appointmentIcs(event, row)
})
