import { and, eq } from 'drizzle-orm'

/** Crée un nouveau lien de mot de passe : relance d'une invitation, ou réinitialisation pour un compte actif. */
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const id = getRouterParam(event, 'id')!
  const db = useDb(event)
  const [target] = await db.select().from(schema.user).where(eq(schema.user.id, id))
  if (!target) throw createError({ statusCode: 404, message: 'Compte introuvable.' })
  const [credential] = await db.select({ id: schema.account.id }).from(schema.account).where(and(eq(schema.account.userId, id), eq(schema.account.providerId, 'credential')))
  const invite = await createInviteLink(event, id)
  emitCmsEvents(event, [{ name: 'user.invited', email: target.email, recipient: target.name, link: invite.link, reason: credential ? 'reset' : 'invite', user: { id: admin.id, email: admin.email } }])
  return invite
})
