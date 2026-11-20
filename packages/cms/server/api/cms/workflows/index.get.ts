/** Workflows, dernier résultat de chacun, et ce que l'éditeur de workflow a besoin de savoir. */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const [rows, runs] = await Promise.all([
    useDb(event).select().from(schema.workflows).orderBy(schema.workflows.createdAt),
    lastRuns(event, 200),
  ])
  const mail = await mailStatus(event)
  return {
    workflows: rows.map(w => ({ ...w, lastRun: runs.find(r => r.workflowId === w.id && !r.test) ?? null })),
    /** Déclencheurs proposés, chacun avec ses variables et ce sur quoi on peut le restreindre. */
    events: await workflowCatalog(event),
    emailConfigured: mail.configured,
    /** Module chargé d'envoyer les e-mails, s'il y en a un d'actif : l'interface y renvoie pour le régler. */
    emailModule: mail.module,
  }
})
