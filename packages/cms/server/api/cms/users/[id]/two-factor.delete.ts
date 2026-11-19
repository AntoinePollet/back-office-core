import { eq } from 'drizzle-orm'

/**
 * Un administrateur retire la double authentification d'un autre compte (téléphone perdu, codes de secours égarés).
 * La personne se reconnecte avec son seul mot de passe, puis la réactive si le site l'exige.
 * Pour son propre compte, on passe par « Mon compte », avec son mot de passe.
 */
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const id = getRouterParam(event, 'id')!
  if (id === admin.id) throw createError({ statusCode: 400, message: 'Pour votre propre compte, désactivez la double authentification depuis « Mon compte ».' })
  const [target] = await useDb(event).select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.id, id))
  if (!target) throw createError({ statusCode: 404, message: 'Compte introuvable.' })
  await resetTwoFactor(event, id)
  await recordSecurityEvent(event, { action: 'two-factor.reset', userId: id, by: admin.id })
  return { ok: true }
})
