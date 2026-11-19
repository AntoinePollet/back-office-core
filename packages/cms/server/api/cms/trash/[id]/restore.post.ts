/** Restaure un élément de la corbeille : il retrouve sa place, son historique et, si possible, son adresse. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  return restoreTrash(event, user, getRouterParam(event, 'id')!)
})
