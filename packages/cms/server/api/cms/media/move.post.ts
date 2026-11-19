import { inArray } from 'drizzle-orm'

/**
 * Range des fichiers dans un dossier. Corps : { ids: ['…'], folderId: '…' | null } (null : à la racine).
 * Seul le classement change : clé R2 et adresse publique restent les mêmes, rien n'est à purger sur le site.
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  assertCanOrganizeMedia(user)
  const body = await readBody<{ ids?: unknown; folderId?: unknown }>(event)
  const ids = Array.isArray(body?.ids) ? [...new Set(body.ids.filter((x): x is string => typeof x === 'string'))] : []
  if (!ids.length) throw createError({ statusCode: 400, message: 'Aucun fichier à déplacer.' })
  if (ids.length > 1000) throw createError({ statusCode: 400, message: '1000 fichiers au plus à la fois.' })
  const folderId = typeof body?.folderId === 'string' && body.folderId ? body.folderId : null
  if (folderId && !(await listMediaFolders(event)).some(f => f.id === folderId)) throw createError({ statusCode: 404, message: 'Dossier introuvable.' })

  const db = useDb(event)
  // D1 : une centaine de paramètres au plus par requête, d'où des paquets de 80.
  const updates = []
  for (let i = 0; i < ids.length; i += 80)
    updates.push(db.update(schema.media).set({ folderId }).where(inArray(schema.media.id, ids.slice(i, i + 80))))
  await db.batch(updates as [typeof updates[number], ...typeof updates])
  const [only] = ids.length === 1 ? await db.select({ name: schema.media.name }).from(schema.media).where(inArray(schema.media.id, ids)) : []
  const folderName = folderId ? (await listMediaFolders(event)).find(f => f.id === folderId)?.name : undefined
  logActivity(event, { action: 'media.moved', actor: user, details: { count: ids.length, name: only?.name, to: folderName }, target: ids.length === 1 ? { kind: 'media', id: ids[0] } : { kind: 'folder', id: folderId } })
  return { ok: true, moved: ids.length, folderId }
})
