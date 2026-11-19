import { activityCsv } from '../../../../shared/activity'

/** Nombre maximal de lignes d'un export. */
const MAX_ROWS = 10_000

/** Le journal d'activité en CSV, avec les mêmes filtres que l'écran. Administrateur seulement. */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const filters = parseActivityFilters(event)
  const rows = []
  let before: string | undefined
  // Par paquets : la réponse d'une requête D1 est limitée en taille.
  while (rows.length < MAX_ROWS) {
    const chunk = await readActivity(event, filters, 1000, before)
    rows.push(...chunk)
    const last = chunk.at(-1)
    if (chunk.length < 1000 || !last) break
    before = `${last.at.getTime()}:${last.id}`
  }
  setResponseHeaders(event, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="activite-${new Date().toISOString().slice(0, 10)}.csv"` })
  return activityCsv(rows)
})
