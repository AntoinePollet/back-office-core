/** Journal des déclenchements, du plus récent au plus ancien. */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return lastRuns(event, 100)
})
