import { eq } from 'drizzle-orm'

/** Supprime un compte et ferme ses sessions. */
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const id = getRouterParam(event, 'id')!
  if (id === admin.id) throw createError({ statusCode: 400, message: 'Vous ne pouvez pas supprimer votre propre compte.' })
  const db = useDb(event)
  const { user, session, account, invites } = schema
  const [target] = await db.select({ id: user.id, name: user.name, email: user.email }).from(user).where(eq(user.id, id))
  if (!target) throw createError({ statusCode: 404, message: 'Compte introuvable.' })
  await db.batch([
    db.delete(session).where(eq(session.userId, id)),
    db.delete(account).where(eq(account.userId, id)),
    db.delete(invites).where(eq(invites.userId, id)),
    db.delete(schema.userAccess).where(eq(schema.userAccess.userId, id)),
    db.delete(user).where(eq(user.id, id)),
    forgetFavorites(event, id),
  ])
  logActivity(event, { action: 'user.deleted', actor: admin, details: { name: target.name, email: target.email }, target: { kind: 'user', id } })
  return { ok: true }
})
