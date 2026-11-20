import { isFrequentCron } from '../../../shared/schedule'

/**
 * Tâche planifiée : les publications programmées dues, puis la sauvegarde automatique du jour. Route interne, appelée
 * seulement par le déclencheur planifié (server/plugins/backup-schedule.ts) : pour toute requête venue de l'extérieur,
 * elle n'existe pas.
 *
 * Un site a deux déclencheurs : celui de la nuit (la sauvegarde) et un fréquent (« *\/5 * * * * », les publications
 * programmées). Les publications sont traitées à chaque passage. La sauvegarde reste celle de la nuit : le déclencheur
 * fréquent ne la fait que si elle a pris du retard (plus de 26 heures), comme le fait la visite d'un administrateur.
 */
export default defineEventHandler(async (event) => {
  if (event.context.cmsScheduled !== true) throw createError({ statusCode: 404, message: 'Page introuvable.' })
  const body = await readBody<{ cron?: string; scheduledTime?: number }>(event)
  const time = Number(body?.scheduledTime)
  const cron = String(body?.cron ?? '')
  const now = Number.isFinite(time) && time > 0 ? new Date(time) : new Date()
  const frequent = isFrequentCron(cron)
  // Une erreur ici ne doit pas priver le site de sa sauvegarde.
  const schedules = await (async () => {
    if (frequent) await noteScheduleTick(event, new Date())
    // L'heure prévue du déclenchement peut précéder de quelques secondes l'heure réelle : la plus tardive fait foi.
    return runDueSchedules(event, new Date(Math.max(now.getTime(), Date.now())))
  })().catch((error) => { console.error('[cms] les publications programmées n\'ont pas pu être traitées', error); return null })
  const backup = await runAutoBackup(event, frequent ? { now } : { cron, now })
  return { ...backup, schedules }
})
