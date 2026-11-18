/** Enregistre un contenu. Corps : par parties `{ shared, locales: { fr: { slug, values } } }` ou à plat `{ values, locale?, translations? }`, avec `publish?: ['fr']`, `unpublish?`. Voir `SaveBody` dans `server/utils/entries.ts`. */
export default defineEventHandler((event) => {
  return saveDoc(event, getRouterParam(event, 'type')!, getRouterParam(event, 'id')!)
})
