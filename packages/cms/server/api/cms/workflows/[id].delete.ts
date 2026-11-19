import { eq } from 'drizzle-orm'

/** Supprime un workflow. Son historique reste dans le journal. */
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const [row] = await useDb(event).delete(schema.workflows).where(eq(schema.workflows.id, getRouterParam(event, 'id')!)).returning({ name: schema.workflows.name })
  if (row) logActivity(event, { action: 'workflow.deleted', actor: admin, details: { name: row.name } })
  return { ok: true }
})
