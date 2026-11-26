/**
 * En-têtes de sécurité, posés sur toute réponse du serveur. Un en-tête que le site a déjà réglé lui-même
 * (`routeRules` de son nuxt.config.ts) est laissé tel quel.
 *
 * - `X-Content-Type-Options: nosniff` : le navigateur ne prend jamais une réponse pour un autre type que celui annoncé.
 * - `Referrer-Policy` : vers un autre site, seule l'origine part, jamais l'adresse complète de la page.
 * - `Strict-Transport-Security`, quand la demande est arrivée en HTTPS : le navigateur ne revient plus en HTTP
 *   pendant un an. Le domaine seul est engagé, pas ses sous-domaines.
 * - Sur le back-office (`/admin`) : il ne s'affiche dans un cadre que sur le site lui-même. Un autre site ne peut
 *   donc pas le montrer sous un décor trompeur pour faire cliquer une personne connectée (détournement de clic).
 *   `base-uri`, `form-action` et `object-src` ferment trois autres portes sans gêner l'interface. Les pages du site,
 *   que le back-office affiche dans ses aperçus, ne sont pas concernées.
 */
const ADMIN_POLICY = 'frame-ancestors \'self\'; base-uri \'self\'; form-action \'self\'; object-src \'none\''

export default defineEventHandler((event) => {
  const headers: Record<string, string> = {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
  }
  if (getRequestProtocol(event) === 'https') headers['strict-transport-security'] = 'max-age=31536000'
  const path = event.path.split('?')[0]!
  if (path === '/admin' || path.startsWith('/admin/')) {
    headers['x-frame-options'] = 'SAMEORIGIN'
    headers['content-security-policy'] = ADMIN_POLICY
  }
  for (const [name, value] of Object.entries(headers)) if (!getResponseHeader(event, name)) setResponseHeader(event, name, value)
})
