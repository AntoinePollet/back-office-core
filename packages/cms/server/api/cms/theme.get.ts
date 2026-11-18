import { inArray } from 'drizzle-orm'
import { type CmsTheme, isHexColor } from '../../../shared/theme'

/**
 * Thème du site (null tant qu'aucun n'a été enregistré) et couleur du back-office (null = couleur par défaut).
 * Public : le site et la page de connexion en ont besoin pour s'afficher.
 */
export default defineEventHandler(async (event) => {
  const rows = await useDb(event).select().from(schema.settings).where(inArray(schema.settings.key, ['theme', 'adminColor']))
  const value = (key: string) => rows.find(r => r.key === key)?.value ?? null
  const adminColor = value('adminColor')
  return { theme: value('theme') as CmsTheme | null, adminColor: isHexColor(adminColor) ? adminColor : null }
})
