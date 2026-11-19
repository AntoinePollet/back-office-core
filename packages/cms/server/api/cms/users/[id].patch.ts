import { eq } from 'drizzle-orm'
import { roleLabel } from '../../../../shared/access'
import type { ActivityInput } from '../../../utils/activity'

/**
 * Modifie le nom, le rôle ou les contenus attribués d'un compte.
 * `types` : liste d'identifiants de contenus auxquels limiter le compte, ou null pour lever la limite.
 */
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const id = getRouterParam(event, 'id')!
  const body = await readBody<{ name?: string; role?: string; types?: unknown }>(event)
  const db = useDb(event)
  const [target] = await db.select().from(schema.user).where(eq(schema.user.id, id))
  if (!target) throw createError({ statusCode: 404, message: 'Compte introuvable.' })

  const set: { name?: string; role?: string; updatedAt: Date } = { updatedAt: new Date() }
  if (body.name?.trim()) set.name = body.name.trim()
  if (body.role !== undefined && body.role !== target.role) {
    if (!await isKnownRole(event, body.role)) throw createError({ statusCode: 400, message: 'Rôle inconnu.' })
    if (id === admin.id) throw createError({ statusCode: 400, message: 'Vous ne pouvez pas changer votre propre rôle.' })
    if (target.role === 'admin' && await countAdmins(event) <= 1) throw createError({ statusCode: 400, message: 'Il doit rester au moins un administrateur.' })
    set.role = body.role
  }
  await db.update(schema.user).set(set).where(eq(schema.user.id, id))
  // Journal d'activité : seulement ce qui a réellement changé.
  const who = { name: set.name ?? target.name, email: target.email }
  const lines: ActivityInput[] = []
  if (set.name && set.name !== target.name) lines.push({ action: 'user.renamed', actor: admin, details: { from: target.name, to: set.name }, target: { kind: 'user', id } })
  if (set.role) {
    const custom = new Map((await db.select({ id: schema.roles.id, name: schema.roles.name }).from(schema.roles)).map(r => [r.id, r.name]))
    const label = (role: string) => custom.get(role) ?? roleLabel(role)
    lines.push({ action: 'user.role_changed', actor: admin, details: { ...who, from: label(target.role), to: label(set.role) }, target: { kind: 'user', id } })
  }

  if (body.types !== undefined) {
    const { userAccess } = schema
    if (body.types === null) {
      await db.delete(userAccess).where(eq(userAccess.userId, id))
      lines.push({ action: 'user.types_changed', actor: admin, details: who, target: { kind: 'user', id } })
    }
    else {
      const known = [...Object.keys(cmsConfig.collections ?? {}), ...Object.keys(cmsConfig.singletons ?? {})]
      if (!Array.isArray(body.types) || !body.types.every(t => known.includes(t as string))) throw createError({ statusCode: 400, message: 'Liste de contenus invalide.' })
      const types = [...new Set(body.types as string[])]
      await db.insert(userAccess).values({ userId: id, types }).onConflictDoUpdate({ target: userAccess.userId, set: { types } })
      lines.push({ action: 'user.types_changed', actor: admin, details: { ...who, list: types.map(t => findDef(t)?.label ?? t) }, target: { kind: 'user', id } })
    }
  }
  logActivity(event, lines)
  return { ok: true }
})
