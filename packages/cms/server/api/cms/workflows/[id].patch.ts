import { eq } from 'drizzle-orm'

/** Active ou met en pause un workflow. Corps : { enabled: boolean }. */
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { enabled } = await readBody<{ enabled?: boolean }>(event)
  const id = getRouterParam(event, 'id')!
  const [row] = await useDb(event).update(schema.workflows).set({ enabled: !!enabled, updatedAt: new Date() }).where(eq(schema.workflows.id, id)).returning({ name: schema.workflows.name })
  if (row) logActivity(event, { action: 'workflow.toggled', actor: admin, details: { name: row.name, to: enabled ? 'on' : 'off' }, target: { kind: 'workflow', id } })
  return { ok: true }
})
