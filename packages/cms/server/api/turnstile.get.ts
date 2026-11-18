import { turnstileSiteKey } from '../cms-modules/turnstile'

/**
 * Clé publique de l'anti-robots, pour `<CmsTurnstile>` sur les pages du site. `siteKey: null` : pas d'anti-robots
 * (module absent ou pas encore réglé), le formulaire s'envoie sans. Réponse identique pour tous : mise en cache,
 * et le cache est vidé quand les réglages du module changent.
 */
export default defineEventHandler(async (event) => {
  const siteKey = await turnstileSiteKey(event)
  allowSiteCache(event)
  return { siteKey }
})
