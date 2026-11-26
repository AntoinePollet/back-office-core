/**
 * Santé du site : liens, images et fichiers à revoir dans les contenus en ligne que la personne peut modifier.
 * Voir `shared/health.ts`. Les adresses à vérifier (pages du site inconnues, autres sites) sont renvoyées telles
 * quelles : l'écran les vérifie ensuite, sans faire attendre cette réponse.
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  return healthReport(event, user)
})
