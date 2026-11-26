import { cleanBooking } from '../../../../shared/appointments'
import { bookAppointment, requireAppointmentsAccess } from '../../../cms-modules/appointments'

/**
 * Saisit un rendez-vous depuis le back-office (pris par téléphone, par exemple) : `{ service, start, name, email, phone?, note? }`.
 * Hors des délais imposés aux visiteurs et sans acompte ; la personne reçoit la même confirmation par e-mail.
 */
export default defineEventHandler(async (event) => {
  const user = await requireAppointmentsAccess(event)
  const body = await readBody<Record<string, unknown>>(event).catch(() => null)
  const { values, errors } = cleanBooking(body)
  if (Object.keys(errors).length) throw createError({ statusCode: 422, message: Object.values(errors).join(' '), data: { errors } })
  const { appointment } = await bookAppointment(event, { service: String(body?.service ?? ''), start: body?.start, values, locale: cmsConfig.site.defaultLocale, origin: null, staff: user })
  return { id: appointment.id }
})
