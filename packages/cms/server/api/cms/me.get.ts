/** La personne connectée, avec ses droits sur chaque type de contenu. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  return { id: user.id, name: user.name, email: user.email, role: user.role, types: user.types, access: accessMap(user) }
})
