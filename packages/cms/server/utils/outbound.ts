import { fetchPublic } from '../../shared/outbound'

/**
 * Appelle une adresse extérieure choisie par quelqu'un (lien à vérifier, webhook d'un workflow) : jamais la machine
 * elle-même ni un réseau privé, au départ comme après une redirection (voir shared/outbound.ts). Lève
 * `PrivateAddressError` dans ce cas. `allowLocal` : en développement et dans les tests, une adresse locale est permise.
 */
export const fetchOutside = (input: string | URL, init: RequestInit = {}, allowLocal: boolean = import.meta.dev) =>
  fetchPublic(input, init, { allowLocal, resolve: usePlatform().resolveHost })
