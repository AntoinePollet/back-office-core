/** Rôles personnalisés, avec le nombre de comptes qui les portent. */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const [rows, usage] = await Promise.all([useDb(event).select().from(schema.roles).orderBy(schema.roles.createdAt), usersPerRole(event)])
  return rows.map(r => ({ id: r.id, name: r.name, rights: r.rights, users: usage.get(r.id) ?? 0 }))
})
