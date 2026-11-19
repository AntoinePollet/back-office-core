import { TRASH_DAYS, canPurgeTrash } from '../../../../shared/trash'

/** La corbeille : ce que la personne aurait le droit de supprimer, donc de restaurer. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  return { items: await listTrash(event, user), days: TRASH_DAYS, canPurge: canPurgeTrash(user) }
})
