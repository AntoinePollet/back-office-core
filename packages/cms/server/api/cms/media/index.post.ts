import { eq } from 'drizzle-orm'
import { slugify } from '../../../../shared/content'

/** Importe un fichier : il est stocké dans R2 et référencé dans la médiathèque, dans le dossier `folder` s'il est donné. */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const parts = await readMultipartFormData(event)
  const file = parts?.find(p => p.name === 'file')
  if (!file?.filename || !file.type) throw createError({ statusCode: 400, message: 'Aucun fichier reçu.' })
  if (!MEDIA_TYPES.includes(file.type)) throw createError({ statusCode: 415, message: 'Type de fichier non accepté. Formats possibles : JPEG, PNG, WebP, GIF, AVIF, SVG, PDF.' })
  if (file.data.length > MEDIA_MAX_SIZE) throw createError({ statusCode: 413, message: 'Fichier trop lourd : 20 Mo au maximum.' })

  const dimension = (name: string) => {
    const n = Number(parts?.find(p => p.name === name)?.data.toString())
    return Number.isInteger(n) && n > 0 && n < 100000 ? n : null
  }
  // Identifiant choisi par l'appelant : l'outil d'import le calcule d'après le contenu du fichier, pour ne jamais
  // envoyer deux fois le même. S'il est déjà dans la médiathèque, c'est ce fichier-là qui est renvoyé, sans rien écrire.
  const wanted = parts?.find(p => p.name === 'id')?.data.toString()
  if (wanted !== undefined) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(wanted)) throw createError({ statusCode: 400, message: 'id : un identifiant au format UUID est attendu.' })
    const [known] = await useDb(event).select().from(schema.media).where(eq(schema.media.id, wanted))
    if (known) return toAdminMedia(known)
  }
  // Dossier où ranger le fichier (le dossier affiché) : envoyer dans un dossier existant est permis à tous.
  const folderPart = parts?.find(p => p.name === 'folder')?.data.toString() || null
  if (folderPart && !(await listMediaFolders(event)).some(f => f.id === folderPart)) throw createError({ statusCode: 404, message: 'Dossier introuvable : il a peut-être été supprimé. Rechargez la page.' })
  const id = wanted ?? crypto.randomUUID()
  const dot = file.filename.lastIndexOf('.')
  const base = slugify(dot > 0 ? file.filename.slice(0, dot) : file.filename) || 'fichier'
  const ext = dot > 0 ? file.filename.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : ''
  const key = `${id}/${base}${ext ? `.${ext}` : ''}`

  await useBucket(event).put(key, file.data, { httpMetadata: { contentType: file.type } })
  const row = { id, key, name: file.filename, mime: file.type, size: file.data.length, width: dimension('width'), height: dimension('height'), alt: {}, createdAt: new Date(), folderId: folderPart }
  await useDb(event).insert(schema.media).values(row)
  return toAdminMedia(row)
})
