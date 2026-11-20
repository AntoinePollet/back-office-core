export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const data = await parseWorkflow(event, await readBody(event))
  const now = new Date()
  const row = { id: crypto.randomUUID(), ...data, createdAt: now, updatedAt: now }
  await useDb(event).insert(schema.workflows).values(row)
  logActivity(event, { action: 'workflow.created', actor: admin, details: { name: row.name }, target: { kind: 'workflow', id: row.id } })
  return row
})
