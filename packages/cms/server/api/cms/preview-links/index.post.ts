import { lt } from 'drizzle-orm'
import { hashPreviewToken } from '../../../utils/preview'

/**
 * Crée un lien d'aperçu à partager. Corps : { label, days }.
 * L'adresse complète n'est renvoyée qu'ici : seule son empreinte est gardée, elle ne pourra pas être réaffichée.
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  if (!canSharePreview(user)) throw createError({ statusCode: 403, message: 'Vous ne pouvez pas partager d\'aperçu : il faut avoir le droit de publier des pages du site.' })
  const body = await readBody<{ label?: unknown; days?: unknown }>(event) ?? {}
  const label = String(body.label ?? '').trim().slice(0, 80)
  if (!label) throw createError({ statusCode: 400, message: 'Indiquez pour qui est ce lien.' })
  const days = Number(body.days ?? 7)
  if (!PREVIEW_LINK_DAYS.includes(days)) throw createError({ statusCode: 400, message: 'Durée invalide.' })

  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const now = new Date()
  const row = { id: crypto.randomUUID(), tokenHash: await hashPreviewToken(token), label, createdBy: user.id, createdByName: user.name, createdAt: now, expiresAt: new Date(now.getTime() + days * 86400_000) }
  const db = useDb(event)
  await db.insert(schema.previewLinks).values(row)
  // Ménage : les liens expirés depuis plus d'un mois ne servent plus à rien.
  await db.delete(schema.previewLinks).where(lt(schema.previewLinks.expiresAt, new Date(now.getTime() - 30 * 86400_000)))
  // Le lien lui-même n'est jamais inscrit au journal : seulement son nom et sa durée.
  logActivity(event, { action: 'preview_link.created', actor: user, details: { name: label, days } })
  return { id: row.id, label, expiresAt: row.expiresAt, url: `${getRequestURL(event).origin}/?preview=${token}` }
})
