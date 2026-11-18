/** Enregistre les réglages d'un module. Une clé d'API absente de l'envoi est conservée ; `null` la retire. */
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const definition = requireModule(getRouterParam(event, 'id')!)
  await saveModuleSettings(event, definition, (await readBody(event)) ?? {}, admin.id)
  // Une balise ajoutée ou retirée, une clé publique changée : le site doit le montrer tout de suite, malgré le cache.
  if (definition.affectsSite) return { ...(await describeModule(event, definition)), purgeFailed: !(await purgeSiteCache(event)) }
  return describeModule(event, definition)
})
