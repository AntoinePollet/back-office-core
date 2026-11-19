/** Supprime définitivement un élément de la corbeille. Administrateur seulement. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  return purgeTrashItem(event, user, getRouterParam(event, 'id')!)
})
