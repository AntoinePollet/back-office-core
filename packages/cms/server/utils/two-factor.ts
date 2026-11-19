import type { BetterAuthPlugin } from 'better-auth'
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from 'better-auth/api'
import { and, eq, like, lt, sql } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { normalizeBackupCode, normalizeTotpCode, normalizeTwoFactorPolicy, type TwoFactorPolicy } from '../../shared/two-factor'

/**
 * Double authentification : ce que le back-office ajoute à l'extension « two-factor » de Better Auth.
 *
 * Better Auth fournit : la clé de l'application (chiffrée en base avec NUXT_AUTH_SECRET), la vérification des codes
 * à 6 chiffres (code courant, précédent ou suivant : 30 secondes de tolérance d'horloge), les codes de secours,
 * l'appareil de confiance (30 jours), 5 essais par connexion et un blocage du compte après 10 codes faux.
 *
 * Ce fichier complète :
 *  - codes de secours **hachés** (Better Auth les chiffre seulement, donc les garde lisibles avec le secret) ;
 *  - un code d'application accepté **une seule fois** (Better Auth accepterait le même pendant sa minute de validité) ;
 *  - la limite de tentatives de la connexion (server/utils/rate-limit.ts) étendue à l'étape du code ;
 *  - la règle « double authentification obligatoire », la remise à zéro par un administrateur.
 */

// ───────────── Règle du site : qui doit l'avoir activée ─────────────

const POLICY_KEY = 'twoFactorPolicy'

/** Règle en vigueur, lue une fois par requête dans `cms_settings`. */
export async function twoFactorPolicy(event: H3Event): Promise<TwoFactorPolicy> {
  return (event.context._cmsTwoFactorPolicy ??= useDb(event).select().from(schema.settings).where(eq(schema.settings.key, POLICY_KEY))
    .then(rows => normalizeTwoFactorPolicy(rows[0]?.value))) as Promise<TwoFactorPolicy>
}

export async function saveTwoFactorPolicy(event: H3Event, policy: TwoFactorPolicy) {
  const now = new Date()
  await useDb(event).insert(schema.settings).values({ key: POLICY_KEY, value: policy, updatedAt: now })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: policy, updatedAt: now } })
  event.context._cmsTwoFactorPolicy = Promise.resolve(policy)
}

// ───────────── Journal ─────────────

export type SecurityEvent =
  | { action: 'two-factor.enabled' | 'two-factor.disabled' | 'two-factor.backup-codes'; userId: string }
  | { action: 'two-factor.reset'; userId: string; by: string }
  | { action: 'two-factor.policy'; by: string; policy: TwoFactorPolicy }

/**
 * Inscrit au journal d'activité chaque changement de double authentification : qui a fait quoi, pour quel compte.
 * Jamais de code, de clé ni de mot de passe.
 */
export async function recordSecurityEvent(event: H3Event, entry: SecurityEvent) {
  if (entry.action === 'two-factor.reset') {
    const [target] = await useDb(event).select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.id, entry.userId))
    logActivity(event, { action: entry.action, category: 'users', phrase: `a réinitialisé la double authentification de ${target?.name ?? 'un compte'}`, actor: { id: entry.by }, target: { kind: 'user', id: entry.userId } })
  }
  else if (entry.action === 'two-factor.policy') {
    const phrase = entry.policy === 'off' ? 'a rendu la double authentification facultative'
      : entry.policy === 'admins' ? 'a rendu la double authentification obligatoire pour les administrateurs'
      : 'a rendu la double authentification obligatoire pour tous les comptes'
    logActivity(event, { action: entry.action, category: 'settings', phrase, actor: { id: entry.by } })
  }
  else {
    const phrase = entry.action === 'two-factor.enabled' ? 'a activé la double authentification sur son compte'
      : entry.action === 'two-factor.disabled' ? 'a désactivé la double authentification sur son compte'
      : 'a créé de nouveaux codes de secours'
    logActivity(event, { action: entry.action, category: 'auth', phrase, actor: { id: entry.userId }, target: { kind: 'user', id: entry.userId } })
  }
}

// ───────────── Remise à zéro ─────────────

/** Oublie tous les « appareils de confiance » d'un compte : le code sera redemandé partout. */
export function forgetTrustedDevices(event: H3Event, userId: string) {
  const { verification } = schema
  return useDb(event).delete(verification).where(and(eq(verification.value, userId), like(verification.identifier, 'trust-device-%')))
}

/**
 * Retire la double authentification d'un compte (téléphone perdu) : clé et codes de secours supprimés, appareils de
 * confiance oubliés, sessions fermées. Le mot de passe n'est pas touché. La personne se reconnecte avec son mot de
 * passe ; si le site l'exige, elle devra réactiver la double authentification aussitôt.
 */
export async function resetTwoFactor(event: H3Event, userId: string) {
  const db = useDb(event)
  const { twoFactor, user, session } = schema
  await db.batch([
    db.delete(twoFactor).where(eq(twoFactor.userId, userId)),
    db.update(user).set({ twoFactorEnabled: false, updatedAt: new Date() }).where(eq(user.id, userId)),
    forgetTrustedDevices(event, userId),
    db.delete(session).where(eq(session.userId, userId)),
  ])
}

// ───────────── Codes de secours hachés ─────────────

const HASH_PREFIX = 'h1:'
const encoder = new TextEncoder()

/**
 * Empreinte d'un code de secours : HMAC-SHA-256 avec le secret du site. Une copie de la base ne permet ni de lire
 * les codes ni de les essayer hors ligne sans ce secret.
 */
export async function backupCodeHash(secret: string, code: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`backoffice-core/backup-code/v1:${code}`)))
  return HASH_PREFIX + btoa(String.fromCharCode(...mac)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Rangement des codes de secours pour Better Auth (option `storeBackupCodes`). Better Auth nous confie la liste des
 * codes en JSON avant de l'écrire, et la relit telle quelle pour y chercher le code saisi : on n'écrit donc que des
 * empreintes, et le code saisi est lui-même remplacé par son empreinte avant la comparaison (voir `twoFactorGuard`).
 * Une liste déjà hachée (réécrite après l'usage d'un code) est laissée telle quelle.
 */
export function backupCodeStore(secret: string) {
  return {
    encrypt: async (json: string) => JSON.stringify(await Promise.all(
      (JSON.parse(json) as string[]).map(code => code.startsWith(HASH_PREFIX) ? code : backupCodeHash(secret, code)),
    )),
    decrypt: async (stored: string) => stored,
  }
}

// ───────────── Vérification d'un code : limite de tentatives, usage unique ─────────────

/** Un code d'application reste valable jusqu'à 90 secondes : on retient qu'il a servi un peu plus longtemps. */
const USED_CODE_MS = 120_000

/**
 * Réserve une clé pour une durée : vrai si elle était libre, faux si elle est déjà prise. Une seule requête SQL :
 * deux demandes simultanées ne peuvent pas l'obtenir toutes les deux.
 */
async function reserveOnce(event: H3Event, key: string, ms: number) {
  const { rateLimits } = schema
  const now = Date.now()
  // Ménage : les codes retenus dont la durée est passée.
  await useDb(event).delete(rateLimits).where(and(like(rateLimits.key, 'totp:%'), lt(rateLimits.resetAt, new Date(now))))
  const rows = await useDb(event).insert(rateLimits).values({ key, count: 1, resetAt: new Date(now + ms) })
    .onConflictDoUpdate({ target: rateLimits.key, set: { resetAt: new Date(now + ms) }, setWhere: sql`${rateLimits.resetAt} <= ${now}` })
    .returning({ key: rateLimits.key })
  return rows.length > 0
}

const VERIFY_TOTP = '/two-factor/verify-totp'
const VERIFY_BACKUP = '/two-factor/verify-backup-code'

/**
 * Extension locale de Better Auth, exécutée autour de la vérification d'un code (à la connexion comme à l'activation).
 * Créée pour une requête : l'état d'une tentative vit dans cette fonction.
 */
export function twoFactorGuard(event: H3Event, secret: string) {
  let attempt: { keys: LoginKeys; usedKey: string | null; /** Compte connecté qui confirme son activation. */ enabling: string | null } | null = null

  return {
    id: 'cms-two-factor-guard',
    hooks: {
      before: [{
        matcher: ctx => ctx.path === VERIFY_TOTP || ctx.path === VERIFY_BACKUP,
        handler: createAuthMiddleware(async (ctx) => {
          const raw = typeof ctx.body?.code === 'string' ? ctx.body.code as string : ''

          // Qui tente : la personne connectée (activation), sinon celle qui vient de donner son mot de passe.
          let who = (await getSessionFromCtx(ctx))?.user as { id: string; email: string; twoFactorEnabled?: boolean | null } | undefined
          const enabling = who && !who.twoFactorEnabled ? who.id : null
          if (!who) {
            const pending = await ctx.getSignedCookie(ctx.context.createAuthCookie('two_factor').name, ctx.context.secret)
            const challenge = pending ? await ctx.context.internalAdapter.findVerificationValue(pending) : null
            who = (challenge && await ctx.context.internalAdapter.findUserById(challenge.value)) || undefined
          }

          if (who) {
            // Même compteur que les mauvais mots de passe : deviner un code n'offre pas d'essais supplémentaires.
            const keys = loginKeys(event, who.email.toLowerCase())
            await assertLoginAllowed(event, keys).catch((e) => {
              throw new APIError('TOO_MANY_REQUESTS', { code: 'TOO_MANY_LOGIN_ATTEMPTS', message: String(e?.message ?? 'Trop de tentatives.') })
            })
            attempt = { keys, usedKey: null, enabling }
          }

          if (ctx.path === VERIFY_BACKUP) {
            // La base ne contient que des empreintes : on compare l'empreinte du code saisi.
            return { context: { body: { code: await backupCodeHash(secret, normalizeBackupCode(raw) ?? raw) } } }
          }

          const code = normalizeTotpCode(raw)
          if (who && code && attempt) {
            const usedKey = `totp:${who.id}:${code}`
            if (!await reserveOnce(event, usedKey, USED_CODE_MS)) {
              await recordLoginFailure(event, attempt.keys)
              attempt = null
              throw new APIError('UNAUTHORIZED', { code: 'CODE_ALREADY_USED', message: 'Ce code a déjà servi. Attendez que votre application en affiche un nouveau.' })
            }
            attempt.usedKey = usedKey
          }
          return { context: { body: { code: code ?? raw } } }
        }),
      }],
      after: [{
        matcher: ctx => ctx.path === VERIFY_TOTP || ctx.path === VERIFY_BACKUP,
        handler: createAuthMiddleware(async (ctx) => {
          if (!attempt) return
          const returned = ctx.context.returned
          if (!isAPIError(returned)) {
            await clearLoginFailures(event, attempt.keys)
            if (attempt.enabling && ctx.path === VERIFY_TOTP) await recordSecurityEvent(event, { action: 'two-factor.enabled', userId: attempt.enabling })
            // Connexion terminée par le code : c'est ici qu'elle est inscrite au journal d'activité.
            const signedIn = (returned as { user?: { id?: string; name?: string; email?: string } } | null)?.user
            if (!attempt.enabling && signedIn?.id) logActivity(event, { action: 'auth.login', actor: signedIn, target: { kind: 'user', id: signedIn.id } })
            return
          }
          // Un code refusé n'a pas servi : sa réservation est levée.
          if (attempt.usedKey) await clearRateLimit(event, [attempt.usedKey])
          if (returned.statusCode === 401) await recordLoginFailure(event, attempt.keys)
        }),
      }, {
        // Désactivation : Better Auth n'oublie que l'appareil qui fait la demande. On les oublie tous.
        matcher: ctx => ctx.path === '/two-factor/disable',
        handler: createAuthMiddleware(async (ctx) => {
          const userId = ctx.context.session?.user.id
          if (!userId || isAPIError(ctx.context.returned)) return
          await forgetTrustedDevices(event, userId)
          await recordSecurityEvent(event, { action: 'two-factor.disabled', userId })
        }),
      }, {
        matcher: ctx => ctx.path === '/two-factor/generate-backup-codes',
        handler: createAuthMiddleware(async (ctx) => {
          const userId = ctx.context.session?.user.id
          if (userId && !isAPIError(ctx.context.returned)) await recordSecurityEvent(event, { action: 'two-factor.backup-codes', userId })
        }),
      }],
    },
  } satisfies BetterAuthPlugin
}
