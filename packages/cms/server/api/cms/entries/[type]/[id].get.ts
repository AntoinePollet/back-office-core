/** Un contenu complet (brouillon, toutes langues), pour le formulaire. Un singleton est créé vide à la première lecture. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const type = getRouterParam(event, 'type')!
  assertAccess(user, type, 'edit')
  const id = getRouterParam(event, 'id')!
  const def = getDef(type)

  let doc = await loadDoc(event, type, id)
  if (!doc && def.kind === 'singleton' && id === type) {
    const now = new Date()
    await useDb(event).insert(schema.entries).values({ id, type, sharedDraft: {}, createdAt: now, updatedAt: now })
    doc = await loadDoc(event, type, id)
  }
  if (!doc) throw createError({ statusCode: 404, message: 'Contenu introuvable.' })
  return doc
})
