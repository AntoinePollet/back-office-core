/** Crée un rôle personnalisé. Corps : { name, rights: { types: { services: { edit, publish, delete, own } }, restrictedFields, deleteMedia } }. */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const data = parseRole(await readBody(event))
  const now = new Date()
  const row = { id: `role_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`, ...data, createdAt: now, updatedAt: now }
  await useDb(event).insert(schema.roles).values(row)
  return { id: row.id, name: row.name, rights: row.rights, users: 0 }
})
