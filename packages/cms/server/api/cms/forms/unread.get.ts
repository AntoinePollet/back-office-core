import { canReadSubmissions, unreadSubmissions } from '../../../cms-modules/forms'

/** Nombre de messages non lus, pour le menu. Zéro pour qui n'a pas accès aux messages. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  if (!(await activeModule(event, 'forms')) || !canReadSubmissions(user)) return { unread: 0 }
  return { unread: await unreadSubmissions(event) }
})
