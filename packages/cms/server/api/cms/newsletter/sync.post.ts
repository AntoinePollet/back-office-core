import { requireNewsletterAccess, syncPending } from '../../../cms-modules/newsletter'

/** Reporte dans la liste du service d'envoi les inscrits confirmés qui n'y sont pas encore. Quelques-uns par appel. */
export default defineEventHandler(async (event) => {
  await requireNewsletterAccess(event)
  return syncPending(event)
})
