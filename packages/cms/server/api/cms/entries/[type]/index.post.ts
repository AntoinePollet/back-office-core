/** Crée un contenu dans une collection. */
export default defineEventHandler((event) => {
  const type = getRouterParam(event, 'type')!
  if (getDef(type).kind !== 'collection') throw createError({ statusCode: 400, message: 'Un singleton ne se crée pas.' })
  return saveDoc(event, type, null)
})
