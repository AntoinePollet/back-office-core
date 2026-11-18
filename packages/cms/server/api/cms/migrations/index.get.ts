/** Ce qui a changé dans la structure des contenus depuis la dernière version appliquée, et le journal des migrations. */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return migrateContent(event, { apply: false })
})
