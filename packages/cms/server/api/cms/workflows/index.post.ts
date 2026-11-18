export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const data = parseWorkflow(await readBody(event))
  const now = new Date()
  const row = { id: crypto.randomUUID(), ...data, createdAt: now, updatedAt: now }
  await useDb(event).insert(schema.workflows).values(row)
  return row
})
