import { slugify } from '../../../../shared/content'
import { FONT_FORMATS, FONT_MAX_FILES, FONT_MAX_SIZE, type CustomFont, fontFormatOf, guessFont } from '../../../../shared/fonts'

/**
 * Envoie un fichier de police (WOFF2, WOFF, TTF, OTF). Le format est lu dans le fichier lui-même, pas dans son nom ;
 * la famille, la graisse et le style sont proposés d'après le nom du fichier, et se corrigent ensuite.
 * Administrateurs. Le site ne change pas tant que la police n'est pas choisie dans le thème.
 */
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const parts = await readMultipartFormData(event)
  const file = parts?.find(p => p.name === 'file')
  if (!file?.filename) throw createError({ statusCode: 400, message: 'Aucun fichier reçu.' })
  if (file.data.length > FONT_MAX_SIZE) throw createError({ statusCode: 413, message: 'Fichier trop lourd : 2 Mo au maximum pour une police. Préférez le format WOFF2.' })
  const format = fontFormatOf(file.data)
  if (!format) throw createError({ statusCode: 415, message: 'Ce fichier n\'est pas une police. Formats possibles : WOFF2 (le plus léger), WOFF, TTF, OTF.' })
  const fonts = await loadCustomFonts(event)
  if (fonts.length >= FONT_MAX_FILES) throw createError({ statusCode: 400, message: `${FONT_MAX_FILES} fichiers de police au maximum. Supprimez ceux qui ne servent plus.` })

  const id = crypto.randomUUID()
  const dot = file.filename.lastIndexOf('.')
  const key = `${id}/${slugify(dot > 0 ? file.filename.slice(0, dot) : file.filename) || 'police'}.${format}`
  const mime = FONT_FORMATS[format].mime
  await useBucket(event).put(key, file.data, { httpMetadata: { contentType: mime } })
  await useDb(event).insert(schema.media).values({ id, key, name: file.filename, mime, size: file.data.length, width: null, height: null, alt: {}, createdAt: new Date(), folderId: null })
  const font: CustomFont = { id, url: mediaUrl(key), name: file.filename, size: file.data.length, format, ...guessFont(file.filename) }
  await saveCustomFonts(event, [...fonts, font])
  logActivity(event, { action: 'font.uploaded', category: 'settings', actor: admin, phrase: `a envoyé la police « ${file.filename} »`, target: { kind: 'theme' } })
  return font
})
