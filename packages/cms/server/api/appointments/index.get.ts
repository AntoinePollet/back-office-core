import { publicAppointments } from '../../cms-modules/appointments'

/** Ce que le site montre avant une réservation (module `appointments`) : les prestations, leur durée, l'acompte. Route publique. */
export default defineEventHandler(async (event) => {
  await requireModule(event, 'appointments')
  return publicAppointments(event)
})
