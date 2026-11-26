import { cancelAppointment, findAppointment, requireAppointmentsAccess } from '../../../../cms-modules/appointments'

/** Annule un rendez-vous depuis le back-office : `{ message? }`, un mot d'explication joint à l'e-mail envoyé à la personne. */
export default defineEventHandler(async (event) => {
  const user = await requireAppointmentsAccess(event)
  const row = await findAppointment(event, getRouterParam(event, 'id')!)
  const body = await readBody<{ message?: unknown }>(event).catch(() => null)
  const message = typeof body?.message === 'string' ? body.message.trim().slice(0, 500) : ''
  const cancelled = await cancelAppointment(event, row, 'staff', { message: message || undefined, actor: user })
  if (!cancelled) throw createError({ statusCode: 409, message: 'Ce rendez-vous est déjà annulé.' })
  return { ok: true }
})
