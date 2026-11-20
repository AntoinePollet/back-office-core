/** Un module et ses réglages, tels que l'écran peut les montrer : jamais la valeur d'une clé d'API. */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return describeModule(event, requireKnownModule(getRouterParam(event, 'id')!))
})
