/** Vide la corbeille : tout ce qu'elle contient est supprimé définitivement. Administrateur seulement. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  return emptyTrash(event, user)
})
