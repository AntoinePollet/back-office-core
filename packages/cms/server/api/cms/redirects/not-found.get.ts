/** Adresses demandées par des visiteurs et introuvables, de la plus demandée à la moins demandée. */
export default defineEventHandler(async (event) => {
  await requireRedirectsAccess(event)
  return listNotFound(event)
})
