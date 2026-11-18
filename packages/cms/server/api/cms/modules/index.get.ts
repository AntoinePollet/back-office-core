/** Modules actifs sur ce site et leur état : réglés ou non. */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return Promise.all(activeModules().map(definition => describeModule(event, definition)))
})
