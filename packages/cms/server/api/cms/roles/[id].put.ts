import { eq } from 'drizzle-orm'

/** Modifie un rôle personnalisé. Les comptes qui le portent prennent les nouveaux droits tout de suite. */
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const id = getRouterParam(event, 'id')!
  const data = parseRole(await readBody(event))
  const db = useDb(event)
  const [existing] = await db.select({ id: schema.roles.id }).from(schema.roles).where(eq(schema.roles.id, id))
  if (!existing) throw createError({ statusCode: 404, message: 'Rôle introuvable.' })
  await db.update(schema.roles).set({ ...data, updatedAt: new Date() }).where(eq(schema.roles.id, id))
  logActivity(event, { action: 'role.updated', actor: admin, details: { name: data.name }, target: { kind: 'role', id } })
  return { id, ...data, users: (await usersPerRole(event)).get(id) ?? 0 }
})
