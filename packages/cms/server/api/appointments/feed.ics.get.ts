import { appointmentsFeed, isFeedLink } from '../../cms-modules/appointments'

/**
 * Agenda à abonner (Google Agenda, Outlook, Apple) : tous les rendez-vous en cours. L'adresse, donnée par l'écran
 * « Rendez-vous », porte une signature : sans elle, la route n'existe pas.
 */
export default defineEventHandler(async (event) => {
  await requireModule(event, 'appointments')
  if (!(await isFeedLink(event))) throw createError({ statusCode: 404, message: 'Page introuvable.' })
  setResponseHeaders(event, { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': NO_CACHE, 'x-robots-tag': 'noindex' })
  return appointmentsFeed(event)
})
