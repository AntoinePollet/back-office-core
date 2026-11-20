import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const id = getRouterParam(event, 'id')!
  const data = await parseWorkflow(event, await readBody(event))
  const db = useDb(event)
  await db.update(schema.workflows).set({ ...data, updatedAt: new Date() }).where(eq(schema.workflows.id, id))
  const [row] = await db.select().from(schema.workflows).where(eq(schema.workflows.id, id))
  if (!row) throw createError({ statusCode: 404, message: 'Workflow introuvable.' })
  logActivity(event, { action: 'workflow.updated', actor: admin, details: { name: row.name }, target: { kind: 'workflow', id } })
  return row
})
