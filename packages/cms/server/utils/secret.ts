import type { H3Event } from 'h3'

/** Secret utilisé par le serveur de développement quand aucun n'est réglé. Jamais en production. */
const DEV_SECRET = 'secret-de-developpement-a-ne-pas-utiliser-en-production'
/** En dessous, le secret est jugé trop court. `openssl rand -hex 32`, que le README indique, en donne 64. */
const MIN_LENGTH = 32

let warned = false

/**
 * Secret du site (NUXT_AUTH_SECRET). Il signe les sessions et les liens envoyés par e-mail, chiffre les clés d'API des
 * modules, les adresses de webhook et les valeurs sensibles des sauvegardes, et hache les codes de secours.
 *
 * Tout repose sur lui, et rien ne le renforce : il doit être long et tiré au hasard. Un secret trop court est signalé
 * dans les journaux, une fois par démarrage. Le site continue de répondre : changer de secret déconnecte tout le monde
 * et rend illisible ce qu'il a chiffré, c'est une décision à prendre en connaissance de cause, pas une panne à subir.
 */
export function siteSecret(event?: H3Event) {
  const secret = String(useRuntimeConfig(event).authSecret || (import.meta.dev ? DEV_SECRET : ''))
  if (!secret) throw createError({ statusCode: 500, message: 'Variable NUXT_AUTH_SECRET manquante.' })
  if (!import.meta.dev && !warned && secret.length < MIN_LENGTH) {
    warned = true
    console.warn(`[cms] NUXT_AUTH_SECRET est trop court (${secret.length} caractères, ${MIN_LENGTH} au moins) : les sessions, les clés d'API enregistrées et les sauvegardes ne sont protégées que par lui. Remplacez-le par un secret tiré au hasard (openssl rand -hex 32) ; les clés d'API des modules et la double authentification seront alors à régler de nouveau.`)
  }
  return secret
}
