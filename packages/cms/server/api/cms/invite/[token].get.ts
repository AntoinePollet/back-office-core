/** Vérifie un lien de mot de passe et indique à qui il est destiné. */
export default defineEventHandler(async (event) => {
  const user = await findInvite(event, getRouterParam(event, 'token')!)
  if (!user) throw createError({ statusCode: 404, message: 'Ce lien n\'est plus valable. Demandez-en un nouveau à un administrateur.' })
  return { name: user.name, email: user.email }
})
