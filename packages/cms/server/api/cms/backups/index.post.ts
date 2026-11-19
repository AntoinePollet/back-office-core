/** « Sauvegarder maintenant » : fait une sauvegarde tout de suite et attend qu'elle soit rangée. */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const outcome = await runBackup(event, { kind: 'manual' })
  if (!outcome.ok) throw createError({ statusCode: 500, message: `La sauvegarde a échoué : ${outcome.error}` })
  return { name: outcome.backup.name, size: outcome.backup.size, rows: outcome.backup.rows, createdAt: outcome.backup.createdAt }
})
