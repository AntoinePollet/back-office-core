import { eq } from 'drizzle-orm'
import { nameTaken } from '../../../../../shared/media-folders'

/**
 * Supprime un dossier. Aucun fichier n'est supprimé : s'il n'est pas vide, son contenu (fichiers et sous-dossiers)
 * remonte dans le dossier parent, seulement avec ?force=1 (après confirmation dans l'interface). Sans ce paramètre,
 * un dossier non vide est refusé (409) avec ce qu'il contient.
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  assertCanOrganizeMedia(user)
  const id = getRouterParam(event, 'id')!
  const db = useDb(event)
  const folders = await listMediaFolders(event)
  const folder = folders.find(f => f.id === id)
  if (!folder) throw createError({ statusCode: 404, message: 'Dossier introuvable.' })

  const children = folders.filter(f => f.parentId === id)
  const files = await db.select({ id: schema.media.id }).from(schema.media).where(eq(schema.media.folderId, id))
  if ((children.length || files.length) && !getQuery(event).force)
    throw createError({ statusCode: 409, message: 'Ce dossier n\'est pas vide.', data: { files: files.length, folders: children.length } })

  // Un sous-dossier qui remonte ne doit pas prendre le nom d'un dossier déjà présent au-dessus.
  const others = folders.filter(f => f.id !== id && f.parentId !== id)
  const clash = children.find(c => nameTaken(others, folder.parentId, c.name))
  if (clash) throw createError({ statusCode: 409, message: `Le dossier « ${clash.name} » existe déjà au niveau supérieur : renommez l'un des deux avant de supprimer ce dossier.` })

  // Écritures liées : le contenu remonte, puis le dossier disparaît (D1 : un seul lot).
  await db.batch([
    db.update(schema.media).set({ folderId: folder.parentId }).where(eq(schema.media.folderId, id)),
    db.update(schema.mediaFolders).set({ parentId: folder.parentId }).where(eq(schema.mediaFolders.parentId, id)),
    db.delete(schema.mediaFolders).where(eq(schema.mediaFolders.id, id)),
  ])
  return { ok: true, files: files.length, folders: children.length }
})
