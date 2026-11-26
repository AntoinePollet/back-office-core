import { eraseAppointment, findAppointment, requireAppointmentsAccess } from '../../../../cms-modules/appointments'

/** Efface un rendez-vous passé ou annulé (demande d'effacement des données d'une personne). Un rendez-vous en cours s'annule d'abord. */
export default defineEventHandler(async (event) => {
  const user = await requireAppointmentsAccess(event)
  const row = await findAppointment(event, getRouterParam(event, 'id')!)
  if (row.status !== 'cancelled' && row.end.getTime() > Date.now()) throw createError({ statusCode: 409, message: 'Ce rendez-vous est en cours : annulez-le d\'abord, la personne sera prévenue.' })
  await eraseAppointment(event, row, user)
  return { ok: true }
})
