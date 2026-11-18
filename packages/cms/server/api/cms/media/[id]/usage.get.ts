/** Liste les contenus qui utilisent ce fichier. */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  return findMediaUsage(event, getRouterParam(event, 'id')!)
})
