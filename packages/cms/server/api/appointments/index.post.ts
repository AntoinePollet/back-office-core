import { APPOINTMENTS, cleanBooking } from '../../../shared/appointments'
import { cleanOrigin } from '../../../shared/attribution'
import { bookAppointment } from '../../cms-modules/appointments'
import { requireHuman } from '../../cms-modules/turnstile'

/**
 * Prend un rendez-vous (module `appointments`) : `{ service, start, name, email, phone?, note?, locale? }`. Route
 * publique. Le créneau est revérifié par le serveur ; `payUrl` est rempli quand un acompte est demandé : le
 * rendez-vous n'est alors confirmé qu'une fois l'acompte reçu.
 */
export default defineEventHandler(async (event) => {
  await requireModule(event, 'appointments')
  if (Number(getRequestHeader(event, 'content-length') ?? 0) > 20_000) throw createError({ statusCode: 413, message: 'Demande trop longue.' })
  const body = await readBody<Record<string, unknown>>(event).catch(() => null)
  // Champ piège, invisible pour une personne : un robot qui le remplit reçoit une réponse normale, mais rien n'est enregistré.
  if (body?.website) return { ok: true, status: 'confirmed', payUrl: null, manageUrl: null }

  const limit = { key: `appointment:${clientIp(event)}`, max: APPOINTMENTS.maxPerWindow }
  await assertRateLimit(event, [limit], minutes => `Trop de réservations. Réessayez dans ${minutes} minute${minutes > 1 ? 's' : ''}.`)

  const { values, errors } = cleanBooking(body)
  if (Object.keys(errors).length) throw createError({ statusCode: 422, message: 'Certains champs sont à corriger.', data: { errors } })

  // Anti-robots (module `turnstile`, s'il est actif et réglé) : vérifié après les champs, car un jeton ne sert qu'une fois.
  await requireHuman(event, body?.turnstile)
  await hitRateLimit(event, [limit.key], APPOINTMENTS.windowMs)

  const { site } = cmsConfig
  const locale = site.locales.includes(String(body?.locale)) ? String(body!.locale) : site.defaultLocale
  const booked = await bookAppointment(event, { service: String(body?.service ?? ''), start: body?.start, values, locale, origin: cleanOrigin(body?.origin) })
  return { ok: true, status: booked.appointment.status, payUrl: booked.payUrl, manageUrl: booked.manageUrl }
})
