import { slugify } from '../../../../shared/content'

/** Importe un fichier : il est stocké dans R2 et référencé dans la médiathèque. */
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
  const id = crypto.randomUUID()
  const dot = file.filename.lastIndexOf('.')
  const base = slugify(dot > 0 ? file.filename.slice(0, dot) : file.filename) || 'fichier'
  const ext = dot > 0 ? file.filename.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : ''
  const key = `${id}/${base}${ext ? `.${ext}` : ''}`

  await useBucket(event).put(key, file.data, { httpMetadata: { contentType: file.type } })
  const row = { id, key, name: file.filename, mime: file.type, size: file.data.length, width: dimension('width'), height: dimension('height'), alt: {}, createdAt: new Date() }
  await useDb(event).insert(schema.media).values(row)
  return toAdminMedia(row)
})
