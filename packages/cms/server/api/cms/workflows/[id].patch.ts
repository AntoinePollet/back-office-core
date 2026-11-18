import { eq } from 'drizzle-orm'

/** Active ou met en pause un workflow. Corps : { enabled: boolean }. */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const { enabled } = await readBody<{ enabled?: boolean }>(event)
  await useDb(event).update(schema.workflows).set({ enabled: !!enabled, updatedAt: new Date() }).where(eq(schema.workflows.id, getRouterParam(event, 'id')!))
  return { ok: true }
})
