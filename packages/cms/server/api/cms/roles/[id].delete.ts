import { eq } from 'drizzle-orm'

/** Supprime un rôle personnalisé. Refusé tant que des comptes le portent : il faut d'abord leur donner un autre rôle. */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = getRouterParam(event, 'id')!
  const users = (await usersPerRole(event)).get(id) ?? 0
  if (users) throw createError({ statusCode: 409, message: `${users} compte${users > 1 ? 's portent' : ' porte'} ce rôle. Donnez-${users > 1 ? 'leur' : 'lui'} d'abord un autre rôle.` })
  await useDb(event).delete(schema.roles).where(eq(schema.roles.id, id))
  return { ok: true }
})
