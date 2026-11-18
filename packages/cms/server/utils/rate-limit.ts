import { inArray, lt, sql } from 'drizzle-orm'
import type { H3Event } from 'h3'

/** Fenêtre de comptage des échecs de connexion. */
const WINDOW_MS = 15 * 60_000
/** Échecs tolérés par fenêtre : par adresse e-mail (devinette ciblée) et par adresse IP (balayage de comptes). */
const MAX_FAILURES = { email: 8, ip: 40 }

export type LoginKeys = { email: string | null; ip: string }

export function loginKeys(event: H3Event, email: string): LoginKeys {
  // Sur Cloudflare, l'adresse du visiteur est dans cet en-tête, que le visiteur ne peut pas falsifier.
  const ip = getRequestHeader(event, 'cf-connecting-ip') ?? getRequestIP(event) ?? 'inconnue'
  return { email: email ? `login:email:${email}` : null, ip: `login:ip:${ip}` }
}

/** Refuse la tentative (429) si trop d'échecs récents ont été enregistrés pour ce compte ou cette adresse IP. */
export async function assertLoginAllowed(event: H3Event, keys: LoginKeys) {
  const wanted = [keys.email, keys.ip].filter((k): k is string => !!k)
  const rows = await useDb(event).select().from(schema.rateLimits).where(inArray(schema.rateLimits.key, wanted))
  const now = Date.now()
  for (const row of rows) {
    const max = row.key === keys.ip ? MAX_FAILURES.ip : MAX_FAILURES.email
    const wait = row.resetAt.getTime() - now
    if (wait > 0 && row.count >= max) {
      const minutes = Math.ceil(wait / 60_000)
      setResponseHeader(event, 'retry-after', Math.ceil(wait / 1000))
      throw createError({ statusCode: 429, message: `Trop de tentatives de connexion. Réessayez dans ${minutes} minute${minutes > 1 ? 's' : ''}.` })
    }
  }
}

/** Enregistre un échec. Le compteur repart de 1 quand la fenêtre précédente est terminée. */
export async function recordLoginFailure(event: H3Event, keys: LoginKeys) {
  const db = useDb(event)
  const { rateLimits } = schema
  const now = Date.now()
  const expired = sql`${rateLimits.resetAt} <= ${now}`
  for (const key of [keys.email, keys.ip]) {
    if (!key) continue
    // Une seule requête, pour que deux tentatives simultanées soient comptées toutes les deux.
    await db.insert(rateLimits).values({ key, count: 1, resetAt: new Date(now + WINDOW_MS) }).onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${expired} then 1 else ${rateLimits.count} + 1 end`,
        resetAt: sql`case when ${expired} then ${now + WINDOW_MS} else ${rateLimits.resetAt} end`,
      },
    })
  }
  // Ménage des compteurs terminés depuis plus d'un jour.
  await db.delete(rateLimits).where(lt(rateLimits.resetAt, new Date(now - 86_400_000)))
}

/** Une connexion réussie efface le compteur du compte. Celui de l'adresse IP reste : il protège les autres comptes. */
export async function clearLoginFailures(event: H3Event, keys: LoginKeys) {
  if (keys.email) await useDb(event).delete(schema.rateLimits).where(inArray(schema.rateLimits.key, [keys.email]))
}
