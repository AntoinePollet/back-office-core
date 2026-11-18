import { eq } from 'drizzle-orm'

/** Modifie le nom ou le rôle d'un compte. */
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const id = getRouterParam(event, 'id')!
  const body = await readBody<{ name?: string; role?: string }>(event)
  const db = useDb(event)
  const [target] = await db.select().from(schema.user).where(eq(schema.user.id, id))
  if (!target) throw createError({ statusCode: 404, message: 'Compte introuvable.' })

  const set: { name?: string; role?: CmsRole; updatedAt: Date } = { updatedAt: new Date() }
  if (body.name?.trim()) set.name = body.name.trim()
  if (body.role !== undefined && body.role !== target.role) {
    if (!CMS_ROLES.includes(body.role as CmsRole)) throw createError({ statusCode: 400, message: 'Rôle inconnu.' })
    if (id === admin.id) throw createError({ statusCode: 400, message: 'Vous ne pouvez pas changer votre propre rôle.' })
    if (target.role === 'admin' && await countAdmins(event) <= 1) throw createError({ statusCode: 400, message: 'Il doit rester au moins un administrateur.' })
    set.role = body.role as CmsRole
  }
  await db.update(schema.user).set(set).where(eq(schema.user.id, id))
  return { ok: true }
})
