import { eq, inArray, lt, sql } from 'drizzle-orm'
import type { H3Event } from 'h3'

// ───────────── Compteurs génériques (table cms_rate_limits, clé libre) ─────────────

/** Un compteur et le nombre d'occurrences qu'il tolère par fenêtre de temps. */
export type RateLimit = { key: string; max: number }

/** Adresse du visiteur. Sur Cloudflare, elle est dans cet en-tête, que le visiteur ne peut pas falsifier. */
export const clientIp = (event: H3Event) => getRequestHeader(event, 'cf-connecting-ip') ?? getRequestIP(event) ?? 'inconnue'

/** Répond 429 si l'un des compteurs a atteint son maximum dans sa fenêtre en cours. Ne compte rien. */
export async function assertRateLimit(event: H3Event, limits: RateLimit[], message: (minutes: number) => string) {
  if (!limits.length) return
  const rows = await useDb(event).select().from(schema.rateLimits).where(inArray(schema.rateLimits.key, limits.map(l => l.key)))
  const now = Date.now()
  for (const row of rows) {
    const max = limits.find(l => l.key === row.key)!.max
    const wait = row.resetAt.getTime() - now
    if (wait > 0 && row.count >= max) {
      setResponseHeader(event, 'retry-after', Math.ceil(wait / 1000))
      throw createError({ statusCode: 429, message: message(Math.ceil(wait / 60_000)) })
    }
  }
}

/** Ajoute une occurrence à chaque compteur et renvoie leur nouvelle valeur. Un compteur repart de 1 quand sa fenêtre précédente est terminée. */
export async function hitRateLimit(event: H3Event, keys: string[], windowMs: number) {
  const counts = new Map<string, number>()
  const db = useDb(event)
  const { rateLimits } = schema
  const now = Date.now()
  const expired = sql`${rateLimits.resetAt} <= ${now}`
  for (const key of keys) {
    // Une seule requête, pour que deux occurrences simultanées soient comptées toutes les deux.
    const [row] = await db.insert(rateLimits).values({ key, count: 1, resetAt: new Date(now + windowMs) }).onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${expired} then 1 else ${rateLimits.count} + 1 end`,
        resetAt: sql`case when ${expired} then ${now + windowMs} else ${rateLimits.resetAt} end`,
      },
    }).returning({ count: rateLimits.count })
    if (row) counts.set(key, row.count)
  }
  // Ménage des compteurs terminés depuis plus d'un jour.
  await db.delete(rateLimits).where(lt(rateLimits.resetAt, new Date(now - 86_400_000)))
  return counts
}

export async function clearRateLimit(event: H3Event, keys: string[]) {
  if (keys.length) await useDb(event).delete(schema.rateLimits).where(inArray(schema.rateLimits.key, keys))
}

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`

// ───────────── Connexion : on compte les échecs ─────────────

/** Fenêtre de comptage des échecs de connexion. */
const LOGIN_WINDOW_MS = 15 * 60_000
/** Échecs tolérés par fenêtre : par adresse e-mail (devinette ciblée) et par adresse IP (balayage de comptes). */
const MAX_FAILURES = { email: 8, ip: 40 }

export type LoginKeys = { email: string | null; ip: string }

export function loginKeys(event: H3Event, email: string): LoginKeys {
  return { email: email ? `login:email:${email}` : null, ip: `login:ip:${clientIp(event)}` }
}

const loginList = (keys: LoginKeys) => [keys.email, keys.ip].filter((k): k is string => !!k)

/** Refuse la tentative (429) si trop d'échecs récents ont été enregistrés pour ce compte ou cette adresse IP. */
export async function assertLoginAllowed(event: H3Event, keys: LoginKeys) {
  await assertRateLimit(
    event,
    loginList(keys).map(key => ({ key, max: key === keys.ip ? MAX_FAILURES.ip : MAX_FAILURES.email })),
    minutes => `Trop de tentatives de connexion. Réessayez dans ${plural(minutes, 'minute')}.`,
  )
}

/** Nombre d'échecs de suite, pour un même compte, à partir duquel le journal d'activité le signale (une seule ligne). */
const FAILURES_NOTED = 3

/**
 * Enregistre un échec de connexion. Le journal d'activité n'en garde que les répétitions, avec retenue : une ligne au
 * 3ᵉ échec de suite d'un compte existant, une quand le compte est bloqué, une quand une adresse IP est bloquée.
 * L'adresse saisie n'est inscrite que si un compte la porte (on ne recopie pas ce que quelqu'un a tapé par erreur
 * dans le champ e-mail) ; le mot de passe essayé n'est jamais lu ici.
 */
export async function recordLoginFailure(event: H3Event, keys: LoginKeys, email = '') {
  const counts = await hitRateLimit(event, loginList(keys), LOGIN_WINDOW_MS)
  const ip = clientIp(event)
  const forEmail = keys.email ? counts.get(keys.email) : undefined
  if (forEmail === FAILURES_NOTED || forEmail === MAX_FAILURES.email) {
    const [account] = await useDb(event).select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, email))
    if (account) logActivity(event, { action: forEmail === FAILURES_NOTED ? 'auth.failures' : 'auth.blocked', actor: null, details: { email, count: forEmail }, target: { kind: 'user', id: account.id }, ip })
  }
  if (counts.get(keys.ip) === MAX_FAILURES.ip) logActivity(event, { action: 'auth.blocked', actor: null, details: { count: MAX_FAILURES.ip }, ip })
}

/** Une connexion réussie efface le compteur du compte. Celui de l'adresse IP reste : il protège les autres comptes. */
export async function clearLoginFailures(event: H3Event, keys: LoginKeys) {
  if (keys.email) await clearRateLimit(event, [keys.email])
}

// ───────────── Mot de passe oublié : on compte toutes les demandes ─────────────

const RESET_WINDOW_MS = 60 * 60_000
/**
 * Demandes acceptées par heure : par adresse e-mail (personne ne peut recevoir plus de 3 e-mails par heure)
 * et par adresse IP (un même poste ne peut pas solliciter beaucoup d'adresses différentes).
 */
const MAX_RESET_REQUESTS = { email: 3, ip: 10 }

/**
 * Compte une demande de lien et répond 429 au-delà du maximum.
 * Le compteur porte sur l'adresse saisie, qu'un compte existe ou non : la réponse ne renseigne donc pas sur les comptes.
 */
export async function consumePasswordResetRequest(event: H3Event, email: string) {
  const limits = [
    { key: `reset:ip:${clientIp(event)}`, max: MAX_RESET_REQUESTS.ip },
    { key: `reset:email:${email}`, max: MAX_RESET_REQUESTS.email },
  ]
  await assertRateLimit(event, limits, minutes => `Trop de demandes. Réessayez dans ${plural(minutes, 'minute')}.`)
  await hitRateLimit(event, limits.map(l => l.key), RESET_WINDOW_MS)
}
