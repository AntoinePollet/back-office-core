import type { H3Event } from 'h3'
import {
  MISSING_TOKEN_MESSAGE, type SiteverifyResult,
  isTurnstileSiteKey, isTurnstileTestKey, isTurnstileToken, secretRefused, turnstileSettingsErrors, visitorMessage,
} from '../../shared/turnstile'
import type { CmsModuleDefinition, ModuleSettings } from '../utils/modules'

/** Adresse de l'API Turnstile. Ne se change que pour les tests (variable NUXT_TURNSTILE_API_URL). */
const apiUrl = (event: H3Event) => String(useRuntimeConfig(event).turnstileApiUrl).replace(/\/$/, '')

/** Demande à Cloudflare si un jeton est valable. `remoteip` : l'adresse du visiteur, pour un contrôle plus sûr. */
async function siteverify(event: H3Event, secret: string, token: string, remoteip?: string): Promise<SiteverifyResult> {
  const response = await fetch(`${apiUrl(event)}/siteverify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'accept': 'application/json' },
    body: JSON.stringify({ secret, response: token, ...(remoteip ? { remoteip } : {}), idempotency_key: crypto.randomUUID() }),
    signal: AbortSignal.timeout(10_000),
  })
  const result = await response.json().catch(() => null) as SiteverifyResult | null
  if (!result || typeof result.success !== 'boolean') throw new Error(`réponse inattendue de Siteverify (${response.status})`)
  return result
}

/** Anti-robots des formulaires du site, par Cloudflare Turnstile (https://www.cloudflare.com/products/turnstile/). */
export const turnstileModule: CmsModuleDefinition = {
  id: 'turnstile',
  label: 'Anti-robots',
  // Icône « bouclier » de Lucide, dans la couleur de Cloudflare.
  logo: { style: 'stroke', color: '#F38020', paths: ['M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z', 'm9 12 2 2 4-4'] },
  description: 'Protège les formulaires du site contre les robots avec Cloudflare Turnstile, sans image à déchiffrer pour les visiteurs.',
  affectsSite: true,
  settings: [
    {
      key: 'siteKey', label: 'Clé du site', type: 'text', required: true, placeholder: '0x4AAAAAAA…',
      help: 'Tableau de bord Cloudflare → « Turnstile » → « Ajouter un widget » : un nom, le domaine du site (par exemple cabinet-durand.fr), mode « Géré » (Managed). Copiez ensuite la « Clé du site » (Site Key). Elle est publique.',
    },
    {
      key: 'secretKey', label: 'Clé secrète', type: 'secret', required: true,
      help: 'Même écran, juste en dessous : « Clé secrète » (Secret Key). Elle ne doit être saisie qu\'ici.',
    },
  ],
  validate: turnstileSettingsErrors,

  async test(event, settings) {
    const invalid = Object.values(turnstileSettingsErrors(settings))
    if (invalid.length) throw new Error(invalid.join(' '))
    // Un jeton factice : Cloudflare le refuse, mais dit au passage si la clé secrète est la bonne.
    const result = await siteverify(event, settings.secretKey ?? '', 'verification-de-la-cle-secrete')
    if (secretRefused(result)) throw new Error('Cloudflare ne reconnaît pas cette clé secrète.')
    const test = isTurnstileTestKey(settings.siteKey) || isTurnstileTestKey(settings.secretKey)
    return test
      ? 'Clés de test de Cloudflare reconnues. Elles ne protègent de rien : remplacez-les par les vraies clés avant la mise en ligne.'
      : 'Clé secrète reconnue par Cloudflare. Pour vérifier la clé du site, ouvrez une page qui contient un formulaire : la case de vérification doit s\'afficher.'
  },
}

const ready = (settings: ModuleSettings) => isTurnstileSiteKey(settings.siteKey) && !!settings.secretKey

/** Clé publique à donner aux pages du site, ou null si l'anti-robots n'est pas actif et réglé. */
export async function turnstileSiteKey(event: H3Event) {
  if (!activeModule('turnstile')) return null
  const settings = await moduleSettings(event, 'turnstile')
  return ready(settings) ? settings.siteKey! : null
}

/**
 * Exige un jeton Turnstile valable quand l'anti-robots est actif et réglé ; ne fait rien sinon.
 * Répond 400 avec un message clair si le jeton manque ou est refusé, 503 si Cloudflare ne répond pas.
 * Si la clé secrète est refusée par Cloudflare (réglage faux), l'envoi est refusé aussi, et l'erreur est notée
 * dans le journal du serveur : mieux vaut un formulaire bloqué qu'un formulaire ouvert aux robots sans le savoir.
 */
export async function requireHuman(event: H3Event, token: unknown) {
  if (!activeModule('turnstile')) return
  const settings = await moduleSettings(event, 'turnstile')
  if (!ready(settings)) return
  if (!isTurnstileToken(token)) throw createError({ statusCode: 400, message: MISSING_TOKEN_MESSAGE, data: { turnstile: 'missing' } })
  let result: SiteverifyResult
  try {
    const ip = clientIp(event)
    result = await siteverify(event, settings.secretKey!, token, ip === 'inconnue' ? undefined : ip)
  }
  catch (error) {
    console.error('[cms] anti-robots : Siteverify injoignable', error)
    throw createError({ statusCode: 503, message: 'La vérification anti-robots ne répond pas. Réessayez dans un instant.', data: { turnstile: 'unavailable' } })
  }
  if (result.success) return
  if (secretRefused(result)) console.error('[cms] anti-robots : Cloudflare refuse la clé secrète réglée dans le back-office (écran Modules → Anti-robots).')
  throw createError({ statusCode: 400, message: visitorMessage(result), data: { turnstile: 'refused' } })
}
