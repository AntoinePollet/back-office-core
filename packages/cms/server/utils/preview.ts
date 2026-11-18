import { and, eq, gt } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { type Who, isBuiltinRole } from '../../shared/access'

/** Durées proposées pour un lien d'aperçu, en jours. */
export const PREVIEW_LINK_DAYS = [1, 7, 30]

export async function hashPreviewToken(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Peut créer un lien d'aperçu : un administrateur, ou quelqu'un qui a le droit de publier au moins un contenu ayant une page
 * sur le site. Partager le site avant sa mise en ligne est une décision de publication : elle revient à qui publie des pages.
 */
export const canSharePreview = (who: Who) => who.role === 'admin'
  || Object.entries(accessMap(who)).some(([type, rights]) => rights.publish && !!getDef(type).path)

/**
 * Au nom de qui un aperçu est demandé, ou null s'il n'y a pas d'aperçu valable :
 * - `?preview=1` : la personne connectée au back-office ;
 * - `?preview=<jeton>` : le créateur du lien partagé, tant que le lien n'a pas expiré et que son compte existe.
 * Le visiteur d'un lien partagé voit donc exactement les brouillons que ce créateur peut ouvrir aujourd'hui.
 */
export async function previewWho(event: H3Event): Promise<Who | null> {
  if (event.context._cmsPreviewWho !== undefined) return event.context._cmsPreviewWho as Who | null
  const raw = getQuery(event).preview
  const value = String((Array.isArray(raw) ? raw[0] : raw) ?? '')
  let who: Who | null = null
  if (value === '1' || value === 'true') who = await requireUser(event).catch(() => null)
  else if (value.length >= 20) who = await linkOwner(event, value)
  return (event.context._cmsPreviewWho = who)
}

async function linkOwner(event: H3Event, token: string): Promise<Who | null> {
  const db = useDb(event)
  const { previewLinks, user } = schema
  const [link] = await db.select().from(previewLinks).where(and(eq(previewLinks.tokenHash, await hashPreviewToken(token)), gt(previewLinks.expiresAt, new Date())))
  if (!link) return null
  const [owner] = await db.select({ id: user.id, role: user.role }).from(user).where(eq(user.id, link.createdBy))
  if (!owner) return null
  const custom = isBuiltinRole(owner.role) ? undefined : (await loadCustomRole(event, owner.role))?.rights ?? null
  return { id: owner.id, role: owner.role, types: await loadUserTypes(event, owner.id), custom }
}
