export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const data = await parseWorkflow(event, await readBody(event))
  const now = new Date()
  const row = { id: crypto.randomUUID(), ...data, createdAt: now, updatedAt: now }
  // En base, l'adresse d'un webhook est chiffrée ; la réponse la rend telle qu'elle vient d'être saisie.
  await useDb(event).insert(schema.workflows).values({ ...row, actions: await sealWorkflowActions(event, row.actions) })
  logActivity(event, { action: 'workflow.created', actor: admin, details: { name: row.name }, target: { kind: 'workflow', id: row.id } })
  return row
})
