/**
 * Version installée du core et, pour information, version plus récente s'il en existe une (voir server/utils/updates.ts).
 * Réservé aux administrateurs : mettre à jour est l'affaire de la personne qui gère le site.
 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return cmsUpdateStatus(event)
})
