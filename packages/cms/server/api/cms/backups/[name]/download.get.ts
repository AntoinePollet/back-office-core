/** Télécharge le fichier d'une sauvegarde. Réservé aux administrateurs ; jamais mis en cache. */
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  // Une sauvegarde contient toutes les données du site : son téléchargement est inscrit au journal.
  logActivity(event, { action: 'backup.downloaded', category: 'settings', phrase: `a téléchargé la sauvegarde ${getRouterParam(event, 'name') ?? ''}`, actor: admin })
  const { name, object } = await openBackup(event, getRouterParam(event, 'name') ?? '')
  setResponseHeaders(event, {
    'content-type': 'application/gzip',
    'content-length': object.size,
    'content-disposition': `attachment; filename="sauvegarde-${name}"`,
    'x-content-type-options': 'nosniff',
  })
  return object.body
})
