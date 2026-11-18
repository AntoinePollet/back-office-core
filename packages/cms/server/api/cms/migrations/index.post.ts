/**
 * Applique les changements validés par l'administrateur.
 * Corps : { confirmed: ['identifiant', …], choices: { identifiant: 'choix' } } — les identifiants viennent de la lecture.
 */
export default defineEventHandler(async (event) => {
  const user = await requireAdmin(event)
  const body = await readBody<{ confirmed?: unknown; choices?: unknown }>(event)
  const confirmed = Array.isArray(body?.confirmed) ? body.confirmed.filter((id): id is string => typeof id === 'string') : []
  const choices = Object.fromEntries(Object.entries(body?.choices && typeof body.choices === 'object' ? body.choices : {}).filter(([, v]) => typeof v === 'string')) as Record<string, string>
  // `migrateContent` purge le cache du site si des contenus publiés ont changé.
  const report = await migrateContent(event, { apply: true, confirmed, choices, by: user.name })
  return report
})
