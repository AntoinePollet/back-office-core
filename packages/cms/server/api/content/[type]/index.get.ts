/**
 * Contenus publiés, pour le site public.
 * - Collection : tableau trié selon la configuration.
 * - Avec `?limit=10&page=2` : { items, total, page, limit, pageCount }.
 * - Avec `?where[champ]=valeur` : seulement les contenus dont le champ a cette valeur (cumulable avec la pagination).
 * - Singleton : un objet, ou null s'il n'est pas publié.
 */
export default defineEventHandler(async (event) => {
  const { def, items, positionOf, sorted, paging } = await readPublic(event, getRouterParam(event, 'type')!)
  if (def.kind === 'singleton') {
    // Un `null` JSON explicite : sans cela, une réponse vide ferait échouer la lecture côté site.
    setResponseHeader(event, 'content-type', 'application/json')
    return JSON.stringify(items[0] ?? null)
  }
  if (paging) return { items, ...paging }
  if (sorted) return items
  return sortEntries(def, items, (item, key) => (key === 'position' ? positionOf(item.id) : (item as Record<string, unknown>)[key]))
})
