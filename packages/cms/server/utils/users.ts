import { hashPassword } from 'better-auth/crypto'
import { and, count, eq, gt } from 'drizzle-orm'
import type { H3Event } from 'h3'

const INVITE_DAYS = 7
export const MIN_PASSWORD = 10

async function sha256(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Crée un lien à usage unique pour choisir un mot de passe. Tout lien précédent de cette personne est annulé. */
export async function createInviteLink(event: H3Event, userId: string) {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const db = useDb(event)
  await db.batch([
    db.delete(schema.invites).where(eq(schema.invites.userId, userId)),
    db.insert(schema.invites).values({ tokenHash: await sha256(token), userId, expiresAt: new Date(Date.now() + INVITE_DAYS * 86400_000) }),
  ])
  return { link: `${getRequestURL(event).origin}/admin/invite/${token}`, days: INVITE_DAYS }
}

/** Retrouve la personne visée par un lien encore valable. */
export async function findInvite(event: H3Event, token: string) {
  const db = useDb(event)
  const [invite] = await db.select().from(schema.invites)
    .where(and(eq(schema.invites.tokenHash, await sha256(token)), gt(schema.invites.expiresAt, new Date())))
  if (!invite) return null
  const [user] = await db.select().from(schema.user).where(eq(schema.user.id, invite.userId))
  return user ?? null
}

/** Définit le mot de passe d'une personne, ferme ses sessions et annule ses liens en attente. */
export async function setUserPassword(event: H3Event, userId: string, password: string) {
  const db = useDb(event)
  const { account, session, invites, user } = schema
  const hash = await hashPassword(password)
  const now = new Date()
  const [existing] = await db.select({ id: account.id }).from(account).where(and(eq(account.userId, userId), eq(account.providerId, 'credential')))
  await db.batch([
    existing
      ? db.update(account).set({ password: hash, updatedAt: now }).where(eq(account.id, existing.id))
      // Même forme que les comptes créés par Better Auth : identifiant du compte = identifiant de la personne.
      : db.insert(account).values({ id: crypto.randomUUID(), accountId: userId, providerId: 'credential', userId, password: hash, createdAt: now, updatedAt: now }),
    db.update(user).set({ emailVerified: true, updatedAt: now }).where(eq(user.id, userId)),
    db.delete(session).where(eq(session.userId, userId)),
    db.delete(invites).where(eq(invites.userId, userId)),
  ])
}

export async function countAdmins(event: H3Event) {
  const [row] = await useDb(event).select({ n: count() }).from(schema.user).where(eq(schema.user.role, 'admin'))
  return row?.n ?? 0
}
