/** Oublie une adresse introuvable (?path=…), ou toutes (sans paramètre). Elle sera recomptée si elle est redemandée. */
export default defineEventHandler(async (event) => {
  await requireRedirectsAccess(event)
  const path = getQuery(event).path
  await forgetNotFound(event, typeof path === 'string' && path ? path : undefined)
  return { ok: true }
})
