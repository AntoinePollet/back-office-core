import { eq } from 'drizzle-orm'

/** Workflows, dernier résultat de chacun, et ce que l'éditeur de workflow a besoin de savoir. */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = useDb(event)
  const [rows, runs] = await Promise.all([
    db.select().from(schema.workflows).orderBy(schema.workflows.createdAt),
    lastRuns(event, 200),
  ])
  // Mise à niveau, une fois par workflow : une adresse de webhook enregistrée en clair par une version précédente
  // est chiffrée à la première ouverture de cet écran.
  for (const w of rows) if (hasPlainWebhook(w.actions)) await db.update(schema.workflows).set({ actions: await sealWorkflowActions(event, w.actions) }).where(eq(schema.workflows.id, w.id))
  const mail = await mailStatus(event)
  return {
    // L'éditeur reçoit les adresses en clair : seuls les administrateurs lisent cette route.
    workflows: await Promise.all(rows.map(async w => ({ ...w, actions: await openWorkflowActions(event, w.actions), lastRun: runs.find(r => r.workflowId === w.id && !r.test) ?? null }))),
    /** Déclencheurs proposés, chacun avec ses variables et ce sur quoi on peut le restreindre. */
    events: await workflowCatalog(event),
    emailConfigured: mail.configured,
    /** Module chargé d'envoyer les e-mails, s'il y en a un d'actif : l'interface y renvoie pour le régler. */
    emailModule: mail.module,
  }
})
