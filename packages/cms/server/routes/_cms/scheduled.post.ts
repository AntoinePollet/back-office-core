/**
 * Tâche planifiée : la sauvegarde automatique du jour. Route interne, appelée seulement par le déclencheur planifié
 * (server/plugins/backup-schedule.ts) : pour toute requête venue de l'extérieur, elle n'existe pas.
 */
export default defineEventHandler(async (event) => {
  if (event.context.cmsScheduled !== true) throw createError({ statusCode: 404, message: 'Page introuvable.' })
  const body = await readBody<{ cron?: string; scheduledTime?: number }>(event)
  const time = Number(body?.scheduledTime)
  return runAutoBackup(event, { cron: String(body?.cron ?? ''), now: Number.isFinite(time) && time > 0 ? new Date(time) : new Date() })
})
