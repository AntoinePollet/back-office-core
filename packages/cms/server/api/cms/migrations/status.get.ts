/** Nombre de changements de structure en attente : sert à l'avertissement affiché dans tout le back-office. */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  return { pending: await pendingMigrations(event) }
})
