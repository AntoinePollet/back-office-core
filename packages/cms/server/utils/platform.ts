import { platform } from '#cms-platform'

/**
 * L'hébergement du site : Cloudflare, ou un serveur Node (voir server/platform/types.ts).
 * Tout ce qui dépend de l'hébergeur (base, fichiers, images, cache, adresse du visiteur) passe par ici.
 */
export const usePlatform = () => platform
