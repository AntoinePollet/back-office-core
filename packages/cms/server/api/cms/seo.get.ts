/**
 * Vue d'ensemble du référencement : toutes les pages que la personne peut modifier, avec leur titre, leur description,
 * leur état et leurs points à voir. Sert à l'écran « Référencement » et, dans le formulaire, à repérer les doublons.
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  return seoOverview(event, user)
})
