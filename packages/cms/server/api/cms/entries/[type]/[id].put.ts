/** Enregistre un contenu. Corps : { shared, locales: { fr: { slug, values } }, publish?: ['fr'], unpublish?: ['en'] }. */
export default defineEventHandler((event) => {
  return saveDoc(event, getRouterParam(event, 'type')!, getRouterParam(event, 'id')!)
})
