import { eq } from 'drizzle-orm'
import { canDeleteMedia } from '../../../../shared/access'

/**
 * Supprime un fichier : il part à la corbeille (récupérable 30 jours) et n'est plus servi par le site.
 * Refusé s'il est utilisé, sauf avec ?force=1.
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  if (!canDeleteMedia(user)) throw createError({ statusCode: 403, message: 'Vous ne pouvez pas supprimer de fichier. Demandez à un éditeur.' })
  const id = getRouterParam(event, 'id')!
  const [row] = await useDb(event).select().from(schema.media).where(eq(schema.media.id, id))
  if (!row) throw createError({ statusCode: 404, message: 'Fichier introuvable.' })

  if (!getQuery(event).force) {
    const usage = await findMediaUsage(event, id)
    if (usage.length) throw createError({ statusCode: 409, message: 'Ce fichier est utilisé par des contenus.', data: { usage } })
  }
  return trashMedia(event, user, row)
})
