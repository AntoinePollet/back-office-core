import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import type { H3Event } from 'h3'
import { CMS_ROLES as SHARED_ROLES, type CmsRole as SharedRole } from '../../shared/access'

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

// Déclarés ici (et pas seulement réexportés) pour rester disponibles sans import dans les routes du serveur.
export type CmsRole = SharedRole
export const CMS_ROLES: CmsRole[] = SHARED_ROLES

/** Renvoie l'utilisateur connecté, ou répond 401. Le rôle est relu en base à chaque requête. */
export async function requireUser(event: H3Event) {
  const session = await useAuth(event).api.getSession({ headers: event.headers })
  if (!session) throw createError({ statusCode: 401, message: 'Connexion requise.' })
  // Les contenus attribués au compte sont lus une fois par requête.
  const types = (event.context._cmsUserTypes ??= await loadUserTypes(event, session.user.id)) as string[] | null
  return { ...session.user, types } as typeof session.user & { role: CmsRole; types: string[] | null }
}

/** Renvoie l'utilisateur connecté s'il est administrateur, sinon répond 403. */
export async function requireAdmin(event: H3Event) {
  const user = await requireUser(event)
  if (user.role !== 'admin') throw createError({ statusCode: 403, message: 'Action réservée aux administrateurs.' })
  return user
}
