import { RESTORE_WORD } from '../../../../../shared/backup'

/**
 * Remet les contenus et les réglages du site dans l'état d'une sauvegarde. L'action la plus lourde du back-office :
 * réservée aux administrateurs, et seulement si le mot de confirmation a été saisi.
 */
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const body = await readBody<{ confirm?: string }>(event)
  if (String(body?.confirm ?? '').trim() !== RESTORE_WORD) throw createError({ statusCode: 400, message: `Pour confirmer, saisissez le mot ${RESTORE_WORD}.` })
  const name = getRouterParam(event, 'name') ?? ''
  const result = await restoreBackup(event, name)
  // Le journal d'activité n'est pas remonté dans le temps par la restauration : cette ligne y reste.
  logActivity(event, { action: 'backup.restored', category: 'settings', phrase: `a restauré le site à partir de la sauvegarde ${name}`, actor: admin })
  return { ...result, purgeFailed: !(await purgeSiteCache(event)) }
})
