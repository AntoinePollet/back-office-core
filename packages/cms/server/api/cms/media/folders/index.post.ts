import { checkFolderCreate, cleanFolderName } from '../../../../../shared/media-folders'

/** Crée un dossier. Corps : { name, parentId? } (sans parentId : à la racine). */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  assertCanOrganizeMedia(user)
  const body = await readBody<{ name?: unknown; parentId?: unknown }>(event)
  const clean = cleanFolderName(body?.name)
  if (clean.error) throw createError({ statusCode: 400, message: clean.error })
  const parentId = typeof body?.parentId === 'string' && body.parentId ? body.parentId : null
  const refusal = checkFolderCreate(await listMediaFolders(event), parentId, clean.name!)
  if (refusal) throw createError({ statusCode: refusal.includes('introuvable') ? 404 : 409, message: refusal })
  const row = { id: crypto.randomUUID(), name: clean.name!, parentId, createdAt: new Date() }
  await useDb(event).insert(schema.mediaFolders).values(row)
  logActivity(event, { action: 'folder.created', actor: user, details: { name: row.name }, target: { kind: 'folder', id: row.id } })
  return { id: row.id, name: row.name, parentId }
})
