/**
 * Annule ce qui est programmé pour un contenu (ou écarte une programmation qui a échoué). Sans paramètre : tout ;
 * `?action=publish` ou `unpublish` : cette action seulement ; `?locales=fr,en` : ces langues seulement.
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const query = getQuery(event)
  const locales = typeof query.locales === 'string' && query.locales ? query.locales.split(',') : undefined
  return cancelSchedule(event, user, getRouterParam(event, 'type')!, getRouterParam(event, 'id')!, { action: typeof query.action === 'string' ? query.action : undefined, locales })
})
