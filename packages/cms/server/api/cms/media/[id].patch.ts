import { eq } from 'drizzle-orm'
import { canHaveFocus, isFocusInput, normalizeFocus } from '../../../../shared/media'

/**
 * Modifie ce qui décrit un fichier, pour tous ses usages. Corps, chaque propriété étant facultative :
 * - `alt` : texte alternatif par langue, `{ fr: '…', en: '…' }` ;
 * - `focus` : point d'intérêt de l'image, `{ x: 0.3, y: 0.2 }` (0 à 1 depuis la gauche et le haut), ou `null` pour le centre.
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = getRouterParam(event, 'id')!
  const body = (await readBody<{ alt?: Record<string, unknown>; focus?: unknown }>(event)) ?? {}
  const db = useDb(event)
  const [before] = await db.select().from(schema.media).where(eq(schema.media.id, id))
  if (!before) throw createError({ statusCode: 404, message: 'Fichier introuvable.' })

  const changes: Partial<typeof schema.media.$inferInsert> = {}
  if (body.alt !== undefined) changes.alt = Object.fromEntries(cmsConfig.site.locales.map(l => [l, String(body.alt?.[l] ?? '').slice(0, 300)]))
  if (body.focus !== undefined) {
    if (!isFocusInput(body.focus)) throw createError({ statusCode: 400, message: 'focus : attendu { "x": 0.3, "y": 0.2 } (deux nombres entre 0 et 1, depuis la gauche et le haut), ou null pour le centre.' })
    if (body.focus !== null && !canHaveFocus(before.mime)) throw createError({ statusCode: 400, message: 'Le point d\'intérêt ne se règle que sur une image JPEG, PNG, WebP ou AVIF.' })
    changes.focus = normalizeFocus(body.focus)
  }
  if (!Object.keys(changes).length) return { ...toAdminMedia(before), purgeFailed: false }

  await db.update(schema.media).set(changes).where(eq(schema.media.id, id))
  const row = { ...before, ...changes }
  const was = normalizeFocus(before.focus), now = normalizeFocus(row.focus)
  if (body.focus !== undefined && (was?.x !== now?.x || was?.y !== now?.y))
    logActivity(event, { action: 'media.focus_changed', actor: user, details: { name: row.name, to: now ? `${Math.round(now.x * 100)} % depuis la gauche, ${Math.round(now.y * 100)} % depuis le haut` : '' }, target: { kind: 'media', id } })
  // Le texte alternatif et le cadrage apparaissent dans les pages.
  return { ...toAdminMedia(row), purgeFailed: !(await purgeSiteCache(event)) }
})
