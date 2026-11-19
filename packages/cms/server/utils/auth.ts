import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { twoFactor } from 'better-auth/plugins/two-factor'
import type { H3Event } from 'h3'
import { CMS_ROLES as SHARED_ROLES, type CmsRole as SharedRole, type CustomRights, isBuiltinRole } from '../../shared/access'
import { twoFactorSetupRequired } from '../../shared/two-factor'

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
      schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification, twoFactor: schema.twoFactor },
    }),
    emailAndPassword: { enabled: true, minPasswordLength: 10 },
    user: {
      additionalFields: { role: { type: 'string', defaultValue: 'editor', input: false } },
    },
    plugins: [
      // Double authentification : code d'une application (TOTP), codes de secours, appareil de confiance 30 jours.
      // Facultative par compte ; la règle du site peut l'exiger (voir requireUser et server/utils/two-factor.ts).
      twoFactor({
        // Nom affiché dans l'application d'authentification.
        issuer: cmsConfig.site.name,
        backupCodeOptions: { storeBackupCodes: backupCodeStore(secret) },
      }),
      twoFactorGuard(event, secret),
    ],
  })
}

export function useAuth(event: H3Event) {
  return (event.context._cmsAuth ??= createAuth(event)) as ReturnType<typeof createAuth>
}

// Déclarés ici (et pas seulement réexportés) pour rester disponibles sans import dans les routes du serveur.
export type CmsRole = SharedRole
export const CMS_ROLES: CmsRole[] = SHARED_ROLES

/** Marque d'un refus « activez d'abord la double authentification » (champ `data.code` de l'erreur 403). */
export const TWO_FACTOR_REQUIRED = 'two-factor-required'

/**
 * Renvoie l'utilisateur connecté, ou répond 401. Le rôle est relu en base à chaque requête.
 *
 * Si le site exige la double authentification pour ce compte et qu'elle n'est pas activée, répond 403 : tant que
 * ce n'est pas fait, aucune route du back-office ne répond. `allowTwoFactorSetup` lève ce refus pour la seule route
 * qui dit au navigateur où en est le compte (`/api/cms/me`) ; l'activation elle-même passe par `/api/auth/two-factor/*`.
 */
export async function requireUser(event: H3Event, options: { allowTwoFactorSetup?: boolean } = {}) {
  const session = await useAuth(event).api.getSession({ headers: event.headers })
  if (!session) throw createError({ statusCode: 401, message: 'Connexion requise.' })
  // La règle n'est lue que pour un compte sans double authentification.
  const twoFactorSetup = !session.user.twoFactorEnabled && twoFactorSetupRequired(await twoFactorPolicy(event), session.user)
  if (twoFactorSetup && !options.allowTwoFactorSetup) {
    throw createError({
      statusCode: 403,
      message: 'Ce site exige la double authentification : activez-la pour continuer.',
      data: { code: TWO_FACTOR_REQUIRED },
    })
  }
  // Les contenus attribués au compte sont lus une fois par requête.
  const types = (event.context._cmsUserTypes ??= await loadUserTypes(event, session.user.id)) as string[] | null
  const role = (session.user as { role?: string }).role ?? 'editor'
  // Rôle personnalisé : ses droits sont lus en base (null s'il a été supprimé : la personne n'a alors plus aucun droit).
  const loaded = isBuiltinRole(role) ? undefined : (event.context._cmsCustomRole ??= await loadCustomRole(event, role)) as { name: string; rights: CustomRights } | null
  return { ...session.user, role, types, custom: loaded === undefined ? undefined : loaded?.rights ?? null, roleName: loaded?.name ?? null, twoFactorSetup } as typeof session.user & {
    role: string; types: string[] | null; custom?: CustomRights | null; roleName: string | null
    /** Vrai si le compte doit activer la double authentification avant toute autre chose. */
    twoFactorSetup: boolean
  }
}

/** Renvoie l'utilisateur connecté s'il est administrateur, sinon répond 403. */
export async function requireAdmin(event: H3Event) {
  const user = await requireUser(event)
  if (user.role !== 'admin') throw createError({ statusCode: 403, message: 'Action réservée aux administrateurs.' })
  return user
}
