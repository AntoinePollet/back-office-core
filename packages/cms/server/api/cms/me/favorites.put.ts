/** Remplace les favoris du menu de la personne connectée : `{ favorites: ['/admin/media', …] }`, dans l'ordre voulu. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const body = await readBody<{ favorites?: unknown }>(event).catch(() => null)
  if (!Array.isArray(body?.favorites)) throw createError({ statusCode: 400, message: 'Liste de favoris attendue.' })
  const favorites = cleanFavorites(body.favorites)
  await saveFavorites(event, user.id, favorites)
  return { favorites }
})
