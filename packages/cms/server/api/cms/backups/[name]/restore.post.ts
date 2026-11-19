import { RESTORE_WORD } from '../../../../../shared/backup'

/**
 * Remet les contenus et les réglages du site dans l'état d'une sauvegarde. L'action la plus lourde du back-office :
 * réservée aux administrateurs, et seulement si le mot de confirmation a été saisi.
 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const body = await readBody<{ confirm?: string }>(event)
  if (String(body?.confirm ?? '').trim() !== RESTORE_WORD) throw createError({ statusCode: 400, message: `Pour confirmer, saisissez le mot ${RESTORE_WORD}.` })
  const result = await restoreBackup(event, getRouterParam(event, 'name') ?? '')
  return { ...result, purgeFailed: !(await purgeSiteCache(event)) }
})
