import { isFontFamily, parseFontWeight } from '../../../../shared/fonts'

/**
 * Corrige ce qui décrit un fichier de police : `{ family?, weight?, style? }`. `weight` : une graisse (400, 700…),
 * ou l'étendue d'une police variable (`[100, 900]`). Une police déjà choisie dans le thème change sur le site : le
 * cache est vidé.
 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = getRouterParam(event, 'id')!
  const body = (await readBody<{ family?: unknown; weight?: unknown; style?: unknown }>(event)) ?? {}
  const fonts = await loadCustomFonts(event)
  const font = fonts.find(f => f.id === id)
  if (!font) throw createError({ statusCode: 404, message: 'Police introuvable.' })
  if (body.family !== undefined) {
    if (!isFontFamily(body.family)) throw createError({ statusCode: 400, message: 'Nom de famille : des lettres, des chiffres et des espaces, 60 caractères au plus.' })
    font.family = body.family.trim()
  }
  if (body.weight !== undefined) {
    const weight = parseFontWeight(body.weight)
    if (!weight) throw createError({ statusCode: 400, message: 'Graisse : un nombre de 100 à 900, ou une étendue pour une police variable.' })
    font.weight = weight
  }
  if (body.style !== undefined) {
    if (body.style !== 'normal' && body.style !== 'italic') throw createError({ statusCode: 400, message: 'Style : normal ou italic.' })
    font.style = body.style
  }
  await saveCustomFonts(event, fonts)
  return { font, purgeFailed: !(await purgeSiteCache(event)) }
})
