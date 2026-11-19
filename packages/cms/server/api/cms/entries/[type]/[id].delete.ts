/**
 * Supprime un contenu d'une collection : il part à la corbeille, d'où il peut être restauré pendant 30 jours.
 * Pour le site, il n'existe plus dès maintenant.
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  return trashEntry(event, user, getRouterParam(event, 'type')!, getRouterParam(event, 'id')!)
})
