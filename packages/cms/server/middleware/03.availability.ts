/**
 * Site en construction ou en maintenance : chaque page du site est remplacée par la page d'attente choisie dans le
 * back-office (écran « Disponibilité »). Le mode aperçu (personne connectée, lien d'aperçu partagé) montre le vrai site :
 * ses pages ne sont jamais mises en cache, elles ne peuvent donc pas être resservies au public.
 * Voir shared/availability.ts.
 */
import { isSitePage } from '../../shared/availability'

export default defineEventHandler(async (event) => {
  if (!isSitePage(event.method, event.path)) return
  const availability = await readAvailability(event)
  if (availability.mode === 'online') return
  if ('preview' in getQuery(event) && await previewWho(event)) return
  return sendClosedPage(event, availability)
})
