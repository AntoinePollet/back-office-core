/** Tous les modules connus et leur état : activés ou non, réglés ou non. Les modules activés d'abord. */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return Promise.all(allModules().map(definition => describeModule(event, definition)))
})
