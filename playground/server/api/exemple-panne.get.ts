/**
 * En développement seulement : une route qui échoue exprès, pour voir le module « Suivi des erreurs et
 * surveillance » relever une erreur du serveur (`/api/exemple-panne?numero=42`). Elle n'existe pas en production.
 */
export default defineEventHandler((event) => {
  if (!import.meta.dev) throw createError({ statusCode: 404, message: 'Page introuvable.' })
  throw new Error(`Contenu ${String(getQuery(event).numero ?? '1')} illisible dans la base d'exemple`)
})
