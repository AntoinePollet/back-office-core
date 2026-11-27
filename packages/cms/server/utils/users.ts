import { hashPassword } from 'better-auth/crypto'
import { and, count, eq, gt, lte } from 'drizzle-orm'
import type { H3Event } from 'h3'

const INVITE_DAYS = 7
/** Un lien demandé depuis « Mot de passe oublié » part par e-mail et sert tout de suite : il expire vite. */
const RESET_MINUTES = 60
export const MIN_PASSWORD = 10

async function sha256(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Durée de vie d'un lien selon son type. */
const LINK_LIFETIME_MS = { invite: INVITE_DAYS * 86400_000, reset: RESET_MINUTES * 60_000 }

async function createPasswordLink(event: H3Event, userId: string, kind: keyof typeof LINK_LIFETIME_MS) {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const db = useDb(event)
  const { invites } = schema
  await db.batch([
    kind === 'invite'
      ? db.delete(invites).where(eq(invites.userId, userId))
      // Ménage seulement : les liens encore valables de cette personne restent utilisables.
      : db.delete(invites).where(and(eq(invites.userId, userId), lte(invites.expiresAt, new Date()))),
    db.insert(invites).values({ tokenHash: await sha256(token), userId, expiresAt: new Date(Date.now() + LINK_LIFETIME_MS[kind]) }),
  ])
  return `${linkBase(event)}/admin/invite/${token}`
}

/**
 * Lien créé par un administrateur (invitation, ou nouveau mot de passe pour un compte actif), qu'il transmet lui-même.
 * Valable 7 jours. Tout lien précédent de cette personne est annulé.
 */
export async function createInviteLink(event: H3Event, userId: string) {
  return { link: await createPasswordLink(event, userId, 'invite'), days: INVITE_DAYS }
}

/**
 * Lien demandé par la personne elle-même depuis « Mot de passe oublié », envoyé par e-mail. Valable une heure.
 * Les liens précédents restent en place : sinon n'importe qui pourrait annuler l'invitation ou le lien de quelqu'un
 * d'autre en saisissant son adresse. Leur nombre reste borné par la limitation des demandes.
 */
export async function createResetLink(event: H3Event, userId: string) {
  return { link: await createPasswordLink(event, userId, 'reset'), minutes: RESET_MINUTES }
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]!)

/**
 * Envoie le lien de nouveau mot de passe à l'adresse indiquée, si un compte existe. Ne fait rien sinon.
 * Un compte invité qui n'a pas encore choisi de mot de passe reçoit aussi un lien : l'e-mail arrive à l'adresse
 * que l'administrateur a lui-même invitée, et la personne peut ainsi activer son compte si elle a perdu son invitation.
 * Le mot de passe actuel n'est pas touché tant que la personne n'en a pas choisi un nouveau.
 */
export async function sendPasswordResetEmail(event: H3Event, email: string) {
  const [target] = await useDb(event).select().from(schema.user).where(eq(schema.user.email, email))
  if (!target) return
  const { link, minutes } = await createResetLink(event, target.id)
  const site = escapeHtml(cmsConfig.site.name)
  const delay = minutes === 60 ? 'une heure' : `${minutes} minutes`
  await sendEmail(event, {
    to: [target.email],
    subject: `Votre nouveau mot de passe — ${cmsConfig.site.name}`,
    html: [
      `<p>Bonjour ${escapeHtml(target.name)},</p>`,
      `<p>Vous avez demandé à choisir un nouveau mot de passe pour l'espace d'administration du site ${site}.</p>`,
      `<p><a href="${link}">Choisir mon nouveau mot de passe</a></p>`,
      `<p>Si le lien ne s'ouvre pas, copiez cette adresse dans votre navigateur :<br>${link}</p>`,
      `<p>Ce lien est valable ${delay} et ne peut servir qu'une seule fois.</p>`,
      `<p>Vous n'êtes pas à l'origine de cette demande ? Ignorez ce message : votre mot de passe actuel reste inchangé.</p>`,
      `<p>${site}</p>`,
    ].join('\n'),
  })
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

/** Définit le mot de passe d'une personne, ferme ses sessions et annule ses liens en attente. Ne touche pas à sa double authentification. */
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
    // Un nouveau mot de passe ne remplace pas le second facteur : la double authentification reste en place, et le code
    // sera redemandé même sur un appareil « de confiance ».
    forgetTrustedDevices(event, userId),
  ])
}

export async function countAdmins(event: H3Event) {
  const [row] = await useDb(event).select({ n: count() }).from(schema.user).where(eq(schema.user.role, 'admin'))
  return row?.n ?? 0
}
