import { eq, gt } from 'drizzle-orm'

/** Liste des comptes, avec leur état : actif, ou en attente du choix d'un mot de passe. */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = useDb(event)
  const [users, accounts, pending, limits] = await Promise.all([
    db.select().from(schema.user).orderBy(schema.user.createdAt),
    db.select({ userId: schema.account.userId }).from(schema.account).where(eq(schema.account.providerId, 'credential')),
    db.select({ userId: schema.invites.userId }).from(schema.invites).where(gt(schema.invites.expiresAt, new Date())),
    db.select().from(schema.userAccess),
  ])
  const typesOf = new Map(limits.map(l => [l.userId, l.types]))
  const active = new Set(accounts.map(a => a.userId))
  const invited = new Set(pending.map(p => p.userId))
  return users.map(u => ({
    id: u.id, name: u.name, email: u.email, role: u.role, createdAt: u.createdAt,
    /** Contenus auxquels le compte est limité ; null : tous ceux de son rôle. Sans effet pour un administrateur. */
    types: typesOf.get(u.id) ?? null,
    status: active.has(u.id) ? 'active' : invited.has(u.id) ? 'invited' : 'expired',
    pendingLink: invited.has(u.id),
  }))
})
