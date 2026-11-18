/** Duplique un contenu d'une collection. Renvoie la copie (un brouillon), prête à être ouverte dans le formulaire. */
export default defineEventHandler((event) => {
  return duplicateDoc(event, getRouterParam(event, 'type')!, getRouterParam(event, 'id')!)
})
