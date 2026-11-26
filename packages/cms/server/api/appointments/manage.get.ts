import { appointmentFromLink, sendAppointmentPage } from '../../cms-modules/appointments'

/**
 * Lien « Voir ou annuler mon rendez-vous » reçu par e-mail : affiche le rendez-vous. Rien n'est changé ici (un
 * lecteur d'e-mails ouvre parfois les liens tout seul) ; annuler passe par le bouton de la page.
 */
export default defineEventHandler(async (event) => {
  await requireModule(event, 'appointments')
  return sendAppointmentPage(event, await appointmentFromLink(event), { justPaid: getQuery(event).paid === '1' })
})
