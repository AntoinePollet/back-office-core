/** Supprime une redirection ajoutée à la main. */
export default defineEventHandler(event => deleteRedirect(event, getRouterParam(event, 'id')!))
