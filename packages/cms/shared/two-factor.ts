/**
 * Double authentification : règles partagées entre le serveur et le navigateur (aucun accès à la base ici).
 *
 * Le second facteur est un code à 6 chiffres donné par une application d'authentification (norme TOTP), ou un code
 * de secours à usage unique. Les codes sont créés et vérifiés par Better Auth (server/utils/auth.ts).
 */

/** Qui doit activer la double authentification : personne (au choix de chacun), les administrateurs, ou tout le monde. */
export type TwoFactorPolicy = 'off' | 'admins' | 'all'
export const TWO_FACTOR_POLICIES: TwoFactorPolicy[] = ['off', 'admins', 'all']
export const TWO_FACTOR_POLICY_LABELS: Record<TwoFactorPolicy, string> = {
  off: 'Au choix de chacun',
  admins: 'Obligatoire pour les administrateurs',
  all: 'Obligatoire pour tous les comptes',
}

/** Réglage lu en base : toute valeur inconnue (ou absente) vaut « au choix de chacun ». */
export const normalizeTwoFactorPolicy = (value: unknown): TwoFactorPolicy =>
  TWO_FACTOR_POLICIES.includes(value as TwoFactorPolicy) ? value as TwoFactorPolicy : 'off'

/** Ce rôle doit-il avoir activé la double authentification ? Un rôle personnalisé n'est concerné que par « tous ». */
export const twoFactorRequired = (policy: TwoFactorPolicy, role: string | null | undefined) =>
  policy === 'all' || (policy === 'admins' && role === 'admin')

/** Le compte doit activer la double authentification avant de pouvoir faire quoi que ce soit d'autre. */
export const twoFactorSetupRequired = (policy: TwoFactorPolicy, user: { role?: string | null; twoFactorEnabled?: boolean | null }) =>
  !user.twoFactorEnabled && twoFactorRequired(policy, user.role)

/** Code d'application saisi : espaces retirés. Renvoie les 6 chiffres, ou null si ce n'est pas un code. */
export function normalizeTotpCode(input: string): string | null {
  const code = input.replace(/\s+/g, '')
  return /^\d{6}$/.test(code) ? code : null
}

/**
 * Code de secours saisi (forme « aB3dE-fG7hI », majuscules et minuscules distinctes) : espaces retirés, tiret remis
 * s'il a été oublié. Renvoie null si la saisie n'a pas la forme d'un code.
 */
export function normalizeBackupCode(input: string): string | null {
  const raw = input.replace(/\s+/g, '').replace(/[‐‑‒–—]/g, '-')
  const code = /^[a-zA-Z0-9]{10}$/.test(raw) ? `${raw.slice(0, 5)}-${raw.slice(5)}` : raw
  return /^[a-zA-Z0-9]{5}-[a-zA-Z0-9]{5}$/.test(code) ? code : null
}

/** Ce que contient l'adresse `otpauth://` codée dans le code QR. */
export type OtpauthInfo = { secret: string; issuer: string; account: string; digits: number; period: number }

/** Lit une adresse `otpauth://totp/…`. Renvoie null si ce n'en est pas une. */
export function parseOtpauth(uri: string): OtpauthInfo | null {
  const match = /^otpauth:\/\/totp\/([^?]*)\?(.+)$/.exec(uri)
  if (!match) return null
  const params = new URLSearchParams(match[2])
  const secret = params.get('secret') ?? ''
  if (!/^[A-Z2-7]+=*$/i.test(secret)) return null
  let label: string
  try { label = decodeURIComponent(match[1]!) }
  catch { return null }
  const colon = label.indexOf(':')
  return {
    secret: secret.replace(/=+$/, '').toUpperCase(),
    issuer: params.get('issuer') ?? (colon >= 0 ? label.slice(0, colon) : ''),
    account: (colon >= 0 ? label.slice(colon + 1) : label).trim(),
    digits: Number(params.get('digits') ?? 6),
    period: Number(params.get('period') ?? 30),
  }
}

/** Clé à saisir à la main, découpée par groupes de 4 pour être recopiée sans se perdre. */
export const formatTotpSecret = (secret: string) => secret.replace(/(.{4})(?=.)/g, '$1 ')

/** Contenu du fichier texte des codes de secours proposé au téléchargement. */
export function backupCodesText(site: string, account: string, codes: string[], date = new Date()) {
  return [
    `Codes de secours — ${site}`,
    `Compte : ${account}`,
    `Créés le ${date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`,
    '',
    'Chaque code remplace une fois le code de votre application d\'authentification',
    '(téléphone perdu, changé ou déchargé). Un code utilisé ne fonctionne plus.',
    'Gardez cette liste en lieu sûr, ailleurs que sur votre téléphone.',
    '',
    ...codes,
    '',
  ].join('\n')
}

/** Message en français pour un code d'erreur de Better Auth sur les routes de double authentification. */
export function twoFactorErrorMessage(code: string | undefined, status: number): string | null {
  switch (code) {
    case 'INVALID_CODE': return 'Code incorrect. Vérifiez l\'heure de votre téléphone et saisissez le code affiché en ce moment.'
    case 'INVALID_BACKUP_CODE': return 'Code de secours incorrect ou déjà utilisé.'
    case 'INVALID_PASSWORD': return 'Mot de passe incorrect.'
    case 'INVALID_TWO_FACTOR_COOKIE': return 'La vérification a expiré. Saisissez à nouveau votre mot de passe.'
    case 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE': return 'Trop de codes incorrects. Saisissez à nouveau votre mot de passe.'
    case 'ACCOUNT_TEMPORARILY_LOCKED': return 'Trop de codes incorrects : ce compte est bloqué quelques minutes. Réessayez plus tard.'
    case 'TOTP_ALREADY_ENABLED': return 'La double authentification est déjà activée sur ce compte.'
    case 'TOTP_NOT_ENABLED':
    case 'TWO_FACTOR_NOT_ENABLED':
    case 'BACKUP_CODES_NOT_ENABLED': return 'La double authentification n\'est pas activée sur ce compte.'
    case 'UNAUTHORIZED': return 'Connexion requise.'
  }
  return status === 429 ? 'Trop de tentatives. Patientez quelques secondes avant de réessayer.' : null
}
