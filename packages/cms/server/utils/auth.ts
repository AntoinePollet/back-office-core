import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import type { H3Event } from 'h3'

function createAuth(event: H3Event) {
  const secret = useRuntimeConfig(event).authSecret || (import.meta.dev ? 'secret-de-developpement-a-ne-pas-utiliser-en-production' : '')
  if (!secret) throw createError({ statusCode: 500, message: 'Variable NUXT_AUTH_SECRET manquante.' })

  return betterAuth({
    // L'adresse vient de la requête : la même installation fonctionne sur n'importe quel domaine client.
    baseURL: getRequestURL(event).origin,
    basePath: '/api/auth',
    secret,
    database: drizzleAdapter(useDb(event), {
      provider: 'sqlite',
      schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
    }),
    emailAndPassword: { enabled: true, minPasswordLength: 10 },
    user: {
      additionalFields: { role: { type: 'string', defaultValue: 'editor', input: false } },
    },
  })
}

export function useAuth(event: H3Event) {
  return (event.context._cmsAuth ??= createAuth(event)) as ReturnType<typeof createAuth>
}

export type CmsRole = 'admin' | 'editor'
export const CMS_ROLES: CmsRole[] = ['admin', 'editor']

/** Renvoie l'utilisateur connecté, ou répond 401. Le rôle est relu en base à chaque requête. */
export async function requireUser(event: H3Event) {
  const session = await useAuth(event).api.getSession({ headers: event.headers })
  if (!session) throw createError({ statusCode: 401, message: 'Connexion requise.' })
  return session.user as typeof session.user & { role: CmsRole }
}

/** Renvoie l'utilisateur connecté s'il est administrateur, sinon répond 403. */
export async function requireAdmin(event: H3Event) {
  const user = await requireUser(event)
  if (user.role !== 'admin') throw createError({ statusCode: 403, message: 'Action réservée aux administrateurs.' })
  return user
}

/** Refuse la modification d'un contenu marqué `adminOnly` à un éditeur. */
export function assertCanEdit(def: { adminOnly?: boolean; label: string }, user: { role: CmsRole }) {
  if (def.adminOnly && user.role !== 'admin')
    throw createError({ statusCode: 403, message: `« ${def.label} » ne peut être modifié que par un administrateur.` })
}
