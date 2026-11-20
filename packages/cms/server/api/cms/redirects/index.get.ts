/** Toutes les redirections du site, manuelles et automatiques. Administrateur et éditeur. */
export default defineEventHandler(async (event) => {
  await requireRedirectsAccess(event)
  return listRedirects(event)
})
