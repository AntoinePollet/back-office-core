/**
 * Anti-robots (module `turnstile`, Cloudflare Turnstile) : la partie qui ne dépend ni du serveur ni du navigateur.
 *
 * Le visiteur obtient un jeton dans la page (le plus souvent sans rien faire), le formulaire l'envoie avec le message,
 * et le serveur le fait vérifier par Cloudflare (« Siteverify ») avec la clé secrète. Un jeton ne sert qu'une fois
 * et expire après cinq minutes.
 */

/** Clé du site (publique) : lettres, chiffres, tirets et soulignés. Validée pour ne rien pouvoir injecter dans la page. */
const SITE_KEY = /^[A-Za-z0-9_-]{10,100}$/
export const isTurnstileSiteKey = (value: string | undefined) => !!value && SITE_KEY.test(value)

export function turnstileSettingsErrors(settings: Record<string, string | undefined>) {
  const errors: Record<string, string> = {}
  if (settings.siteKey && !SITE_KEY.test(settings.siteKey)) errors.siteKey = 'Clé du site : uniquement des lettres, des chiffres et des tirets, sans espace (elle commence en général par « 0x »).'
  return errors
}

/** Clés de test officielles de Cloudflare : elles réussissent ou échouent toujours. À ne pas laisser sur un site en ligne. */
export const isTurnstileTestKey = (value: string | undefined) => !!value && /^[123]x0{10,}A[AB]$|^[123]x0{10,}(BB|FF)$/.test(value)

/** Un jeton plausible : Turnstile en produit de 2 048 caractères au plus. */
export const isTurnstileToken = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 2048

export type SiteverifyResult = { success?: boolean; 'error-codes'?: string[]; hostname?: string }

/** La clé secrète elle-même est refusée par Cloudflare (et non le jeton du visiteur). */
export const secretRefused = (result: SiteverifyResult) =>
  (result['error-codes'] ?? []).some(code => code === 'invalid-input-secret' || code === 'missing-input-secret')

/** Message pour le visiteur quand son jeton est refusé. */
export function visitorMessage(result: SiteverifyResult) {
  const codes = result['error-codes'] ?? []
  if (codes.includes('timeout-or-duplicate')) return 'La vérification anti-robots a expiré. Elle vient d\'être relancée : renvoyez le formulaire dans un instant.'
  return 'La vérification anti-robots a échoué. Elle vient d\'être relancée : réessayez dans un instant.'
}

export const MISSING_TOKEN_MESSAGE = 'La vérification anti-robots n\'est pas terminée. Patientez une seconde, puis renvoyez le formulaire.'
