/** Télécharge le fichier d'une sauvegarde. Réservé aux administrateurs ; jamais mis en cache. */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const { name, object } = await openBackup(event, getRouterParam(event, 'name') ?? '')
  setResponseHeaders(event, {
    'content-type': 'application/gzip',
    'content-length': object.size,
    'content-disposition': `attachment; filename="sauvegarde-${name}"`,
    'x-content-type-options': 'nosniff',
  })
  return object.body
})
