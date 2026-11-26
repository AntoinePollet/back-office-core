import { requireAppointmentsAccess, staffSlots } from '../../../cms-modules/appointments'

/** Moments libres d'un jour pour saisir un rendez-vous : `?service=…&date=AAAA-MM-JJ`. Sans les délais des visiteurs. */
export default defineEventHandler(async (event) => {
  await requireAppointmentsAccess(event)
  const query = getQuery(event)
  return { slots: await staffSlots(event, String(query.service ?? ''), String(query.date ?? '')) }
})
