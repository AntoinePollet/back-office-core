/** Restaure une version de l'historique comme brouillon. Rien n'est publié : le contenu est renvoyé pour relecture. */
export default defineEventHandler((event) => {
  return restoreRevision(event, getRouterParam(event, 'type')!, getRouterParam(event, 'id')!, getRouterParam(event, 'revision')!)
})
