import { eq } from 'drizzle-orm'

/** Supprime un workflow. Son historique reste dans le journal. */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  await useDb(event).delete(schema.workflows).where(eq(schema.workflows.id, getRouterParam(event, 'id')!))
  return { ok: true }
})
