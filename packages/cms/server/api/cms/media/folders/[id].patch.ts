import { eq } from 'drizzle-orm'
import { checkFolderMove, cleanFolderName, nameTaken } from '../../../../../shared/media-folders'

/**
 * Renomme ou déplace un dossier. Corps : { name? } et/ou { parentId? } (null : à la racine).
 * Rien ne change dans le stockage : les adresses des fichiers restent les mêmes.
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  assertCanOrganizeMedia(user)
  const id = getRouterParam(event, 'id')!
  const body = await readBody<{ name?: unknown; parentId?: unknown }>(event)
  const folders = await listMediaFolders(event)
  const folder = folders.find(f => f.id === id)
  if (!folder) throw createError({ statusCode: 404, message: 'Dossier introuvable.' })

  let parentId = folder.parentId
  if (body && 'parentId' in body) {
    parentId = typeof body.parentId === 'string' && body.parentId ? body.parentId : null
    const refusal = checkFolderMove(folders, id, parentId)
    if (refusal) throw createError({ statusCode: refusal.includes('introuvable') ? 404 : 409, message: refusal })
  }
  let name = folder.name
  if (body && 'name' in body) {
    const clean = cleanFolderName(body.name)
    if (clean.error) throw createError({ statusCode: 400, message: clean.error })
    name = clean.name!
  }
  if (nameTaken(folders, parentId, name, id)) throw createError({ statusCode: 409, message: `Un dossier « ${name} » existe déjà à cet endroit.` })
  await useDb(event).update(schema.mediaFolders).set({ name, parentId }).where(eq(schema.mediaFolders.id, id))
  return { id, name, parentId }
})
