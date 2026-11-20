/**
 * Active ou désactive un module : `{ enabled: true | false }`. Réservé aux administrateurs.
 * Les réglages du module sont gardés. Un module qui change les pages du site (balise, clé publique) vide le cache.
 */
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const definition = requireKnownModule(getRouterParam(event, 'id')!)
  const { enabled } = await readBody<{ enabled?: unknown }>(event) ?? {}
  if (typeof enabled !== 'boolean') throw createError({ statusCode: 400, message: 'Indiquez si le module est activé.' })
  const before = (await describeModule(event, definition)).enabled
  await setModuleEnabled(event, definition, enabled)
  if (before !== enabled) {
    logActivity(event, { action: enabled ? 'module.enabled' : 'module.disabled', actor: admin, details: { name: definition.label }, target: { kind: 'module', id: definition.id } })
  }
  const state = await describeModule(event, definition)
  if (definition.affectsSite && before !== enabled) return { ...state, purgeFailed: !(await purgeSiteCache(event)) }
  return state
})
