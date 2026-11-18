import { count, eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { cleanCustomRights, isBuiltinRole, ROLE_LABELS } from '../../shared/access'

/** Un rôle existe-t-il : rôle intégré, ou rôle personnalisé enregistré. */
export async function isKnownRole(event: H3Event, role: unknown) {
  if (isBuiltinRole(role)) return true
  if (typeof role !== 'string' || !role) return false
  const [row] = await useDb(event).select({ id: schema.roles.id }).from(schema.roles).where(eq(schema.roles.id, role))
  return !!row
}

/** Vérifie et nettoie un rôle personnalisé reçu du back-office. */
export function parseRole(body: any) {
  const name = String(body?.name ?? '').trim().slice(0, 60)
  if (!name) throw createError({ statusCode: 400, message: 'Donnez un nom au rôle.' })
  if (Object.values(ROLE_LABELS).some(label => label.toLowerCase() === name.toLowerCase()))
    throw createError({ statusCode: 400, message: `« ${name} » est le nom d'un rôle intégré : choisissez-en un autre.` })
  const rights = cleanCustomRights(body?.rights, allTypeKeys())
  if (!Object.keys(rights.types).length) throw createError({ statusCode: 400, message: 'Donnez au rôle l\'accès à au moins un contenu.' })
  return { name, rights }
}

/** Nombre de comptes qui portent chaque rôle. */
export async function usersPerRole(event: H3Event) {
  const rows = await useDb(event).select({ role: schema.user.role, n: count() }).from(schema.user).groupBy(schema.user.role)
  return new Map(rows.map(r => [r.role, r.n]))
}
