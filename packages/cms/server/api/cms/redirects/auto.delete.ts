/** Supprime une redirection automatique (ancienne adresse d'un contenu), désignée par ?type=&locale=&slug=. */
export default defineEventHandler(event => deleteAutoRedirect(event))
