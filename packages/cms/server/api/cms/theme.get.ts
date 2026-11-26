import { inArray } from 'drizzle-orm'
import type { CustomFont } from '../../../shared/fonts'
import { type CmsTheme, isHexColor } from '../../../shared/theme'

/**
 * Thème du site (null tant qu'aucun n'a été enregistré), polices envoyées dont il se sert, et couleur du back-office
 * (null = couleur par défaut).
 * Public : le site et la page de connexion en ont besoin pour s'afficher.
 */
export default defineEventHandler(async (event) => {
  const rows = await useDb(event).select().from(schema.settings).where(inArray(schema.settings.key, ['theme', 'adminColor', 'fonts']))
  const value = (key: string) => rows.find(r => r.key === key)?.value ?? null
  const adminColor = value('adminColor')
  const theme = value('theme') as CmsTheme | null
  // Polices envoyées : seulement celles dont le thème se sert, les pages du site n'ont pas besoin des autres.
  const used = JSON.stringify(theme?.typography ?? null)
  const fonts = (Array.isArray(value('fonts')) ? value('fonts') as CustomFont[] : []).filter(f => used.includes(JSON.stringify(`custom:${f.family}`)))
  return { theme, adminColor: isHexColor(adminColor) ? adminColor : null, fonts }
})
