/** Dossiers de la médiathèque (tous niveaux). Le nombre de fichiers se compte d'après la liste des fichiers. */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  return listMediaFolders(event)
})
