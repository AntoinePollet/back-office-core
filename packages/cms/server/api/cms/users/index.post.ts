import { eq } from 'drizzle-orm'

/** Invite une personne : crée son compte sans mot de passe et renvoie le lien à lui transmettre. */
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const body = await readBody<{ name?: string; email?: string; role?: string }>(event)
  const name = body.name?.trim()
  const email = body.email?.trim().toLowerCase()
  if (!name || !email || !/^\S+@\S+\.\S+$/.test(email)) throw createError({ statusCode: 400, message: 'Nom et adresse e-mail valides obligatoires.' })
  const role = CMS_ROLES.includes(body.role as CmsRole) ? body.role as CmsRole : 'editor'

  const db = useDb(event)
  const [taken] = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, email))
  if (taken) throw createError({ statusCode: 409, message: 'Un compte existe déjà avec cette adresse e-mail.' })

  const id = crypto.randomUUID()
  const now = new Date()
  await db.insert(schema.user).values({ id, name, email, role, emailVerified: false, createdAt: now, updatedAt: now })
  const invite = await createInviteLink(event, id)
  emitCmsEvents(event, [{ name: 'user.invited', email, recipient: name, link: invite.link, reason: 'invite', user: { id: admin.id, email: admin.email } }])
  return { id, ...invite }
})
