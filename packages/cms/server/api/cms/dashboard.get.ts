/** L'accueil du back-office : ce qui attend la personne connectée, ses contenus récents, l'état du site. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  return dashboard(event, user)
})
