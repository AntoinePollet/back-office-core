/** Écran « Sauvegardes » : état de la sauvegarde automatique, liste des sauvegardes, derniers échecs. */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return describeBackups(event)
})
