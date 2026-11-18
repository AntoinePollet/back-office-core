/** Enregistre les réglages d'un module. Une clé d'API absente de l'envoi est conservée ; `null` la retire. */
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const definition = requireModule(getRouterParam(event, 'id')!)
  await saveModuleSettings(event, definition, (await readBody(event)) ?? {}, admin.id)
  return describeModule(event, definition)
})
