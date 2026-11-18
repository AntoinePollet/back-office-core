import { eq } from 'drizzle-orm'

/** Exécute le workflow tout de suite avec des données d'exemple. Les actions sont réellement effectuées. */
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const [workflow] = await useDb(event).select().from(schema.workflows).where(eq(schema.workflows.id, getRouterParam(event, 'id')!))
  if (!workflow) throw createError({ statusCode: 404, message: 'Workflow introuvable.' })
  return executeWorkflow(event, workflow, sampleEvent(event, workflow.trigger, admin), true)
})
