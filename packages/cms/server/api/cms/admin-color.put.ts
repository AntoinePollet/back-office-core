import { eq } from 'drizzle-orm'
import { isHexColor } from '../../../shared/theme'

/** Enregistre la couleur du back-office. Corps : { color: '#rrggbb' }, ou { color: null } pour revenir à la couleur par défaut. */
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { color } = await readBody<{ color?: unknown }>(event)
  const db = useDb(event)
  if (color == null) {
    await db.delete(schema.settings).where(eq(schema.settings.key, 'adminColor'))
    logActivity(event, { action: 'admin_color.updated', actor: admin, target: { kind: 'theme' } })
    return { adminColor: null }
  }
  if (!isHexColor(color)) throw createError({ statusCode: 400, message: 'Couleur invalide.' })
  const value = color.toLowerCase()
  const now = new Date()
  await db.insert(schema.settings).values({ key: 'adminColor', value, updatedAt: now })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: now } })
  logActivity(event, { action: 'admin_color.updated', actor: admin, target: { kind: 'theme' } })
  return { adminColor: value }
})
