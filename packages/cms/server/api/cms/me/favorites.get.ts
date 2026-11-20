/** Favoris du menu de la personne connectée, dans son ordre. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  return { favorites: await readFavorites(event, user.id) }
})
