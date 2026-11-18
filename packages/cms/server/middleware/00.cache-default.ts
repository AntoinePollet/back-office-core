/**
 * Par défaut, aucune réponse n'est mise en cache.
 * Le cache de Cloudflare conserve toute réponse sans consigne explicite : sans cette règle,
 * une réponse du back-office destinée à une personne pourrait être servie à une autre.
 * Seules les réponses publiques lèvent cette interdiction, via `allowSiteCache`.
 */
export default defineEventHandler((event) => {
  setResponseHeader(event, 'cache-control', NO_CACHE)
})
