/** Workflows, dernier résultat de chacun, et ce que l'éditeur de workflow a besoin de savoir. */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const [rows, runs] = await Promise.all([
    useDb(event).select().from(schema.workflows).orderBy(schema.workflows.createdAt),
    lastRuns(event, 200),
  ])
  const types = [...Object.entries(cmsConfig.collections ?? {}), ...Object.entries(cmsConfig.singletons ?? {})].map(([key, def]) => ({ key, label: def.label }))
  return {
    workflows: rows.map(w => ({ ...w, lastRun: runs.find(r => r.workflowId === w.id && !r.test) ?? null })),
    events: WORKFLOW_EVENTS,
    variables: WORKFLOW_VARIABLES,
    types,
    emailConfigured: mailSettings(event).configured,
  }
})
