import { saveAppointmentSettings } from '../../../cms-modules/appointments'

/** Enregistre les réglages des rendez-vous : prestations, horaires, délais, fermetures. Administrateur seulement. */
export default defineEventHandler(async (event) => {
  await requireModule(event, 'appointments')
  const user = await requireAdmin(event)
  return saveAppointmentSettings(event, user, await readBody(event).catch(() => null))
})
