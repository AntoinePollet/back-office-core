/** Ajoute une redirection à la main. Corps : { source, target: { kind: 'page', type, id, locale } | { kind: 'url', url }, status, flatten? }. */
export default defineEventHandler(event => saveRedirect(event))
