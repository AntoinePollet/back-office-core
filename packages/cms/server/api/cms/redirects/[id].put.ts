/** Modifie une redirection ajoutée à la main. */
export default defineEventHandler(event => saveRedirect(event, getRouterParam(event, 'id')!))
