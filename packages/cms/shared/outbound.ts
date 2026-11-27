/**
 * Appel d'une adresse choisie par quelqu'un (lien d'un contenu à vérifier, webhook d'un workflow) sans jamais
 * atteindre la machine elle-même ni un réseau privé.
 *
 * Contrôler la seule adresse saisie ne suffit pas : une adresse publique peut rediriger vers `http://localhost/…`
 * ou vers le service de métadonnées d'un hébergeur, et un nom de domaine public peut désigner une adresse privée.
 * Ici, chaque étape est contrôlée : l'adresse de départ, puis chaque redirection, suivie une à une au lieu d'être
 * laissée au moteur ; et, si l'hébergement sait résoudre un nom (`resolve`), les adresses qu'il désigne.
 */
import { isPrivateHost } from './health'

/** Levée quand l'adresse, ou une redirection, désigne la machine ou un réseau privé : rien n'a été appelé. */
export class PrivateAddressError extends Error {
  constructor(readonly host: string) {
    super(`Adresse d'un réseau privé (${host}) : non appelée.`)
    this.name = 'PrivateAddressError'
  }
}

export type OutboundGuard = {
  /** En développement et dans les tests seulement : autorise une adresse de la machine. */
  allowLocal?: boolean
  /** Adresses IP que désigne un nom de domaine, si l'hébergement sait le dire (serveur Node). */
  resolve?: (hostname: string) => Promise<string[]>
  /** Règle des adresses refusées ; celle du core par défaut. Ne se change que pour les tests. */
  isPrivate?: (hostname: string) => boolean
}

/** Redirections suivies au plus. */
export const MAX_REDIRECTS = 5

const REDIRECTS = [301, 302, 303, 307, 308]

async function assertPublic(url: URL, guard: OutboundGuard) {
  if (!/^https?:$/.test(url.protocol)) throw new TypeError(`Adresse non prise en charge (${url.protocol}).`)
  if (guard.allowLocal) return
  const isPrivate = guard.isPrivate ?? isPrivateHost
  if (isPrivate(url.hostname)) throw new PrivateAddressError(url.hostname)
  // Un nom introuvable n'est pas une erreur ici : l'appel échouera de lui-même, avec le bon message.
  const addresses = await guard.resolve?.(url.hostname.replace(/^\[|\]$/g, '')).catch(() => [] as string[]) ?? []
  if (addresses.some(isPrivate)) throw new PrivateAddressError(url.hostname)
}

/**
 * Comme `fetch`, pour une adresse extérieure : lève `PrivateAddressError` plutôt que d'appeler une adresse privée,
 * au départ comme après une redirection. Les redirections sont suivies comme le fait un navigateur (un envoi `POST`
 * redirigé par 301, 302 ou 303 se poursuit par une lecture ; 307 et 308 le renvoient tel quel).
 */
export async function fetchPublic(input: string | URL, init: RequestInit = {}, guard: OutboundGuard = {}): Promise<Response> {
  let url = new URL(input)
  let method = (init.method ?? 'GET').toUpperCase()
  let body = init.body
  for (let hop = 0; ; hop++) {
    await assertPublic(url, guard)
    const response = await fetch(url, { ...init, method, body, redirect: 'manual' })
    const location = REDIRECTS.includes(response.status) ? response.headers.get('location') : null
    if (!location) return response
    await response.body?.cancel().catch(() => {})
    if (hop >= MAX_REDIRECTS) throw new Error('Trop de redirections.')
    url = new URL(location, url)
    if (response.status === 303 ? method !== 'HEAD' : (response.status === 301 || response.status === 302) && method === 'POST') {
      method = 'GET'
      body = undefined
    }
  }
}
