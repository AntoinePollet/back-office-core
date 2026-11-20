/**
 * Disponibilité du site. Tout compte du back-office lit l'état (le bandeau du back-office le rappelle) ;
 * seul un administrateur reçoit le réglage complet des pages d'attente.
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const availability = await readAvailability(event)
  return user.role === 'admin' ? availability : { mode: availability.mode }
})
