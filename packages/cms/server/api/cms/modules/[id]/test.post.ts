/** Vérifie les réglages enregistrés d'un module (la clé d'API est-elle acceptée ?). */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const definition = requireModule(getRouterParam(event, 'id')!)
  if (!definition.test) throw createError({ statusCode: 400, message: 'Ce module n\'a rien à vérifier.' })
  try {
    return { ok: true, message: await definition.test(event, await moduleSettings(event, definition.id)) }
  }
  catch (error) {
    const e = error as Error
    return { ok: false, message: e.name === 'TimeoutError' ? 'Pas de réponse après 10 secondes.' : (e.message || 'La vérification a échoué.').slice(0, 300) }
  }
})
