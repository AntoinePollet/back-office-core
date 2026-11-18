import { formDefinitions, validateSubmission } from '../../../shared/modules'
import { storeSubmission } from '../../cms-modules/forms'

/** Messages acceptés par visiteur (adresse IP) et par fenêtre de dix minutes. */
const MAX_PER_WINDOW = 5
const WINDOW_MS = 10 * 60_000

/**
 * Reçoit un formulaire du site (module `forms`). Route publique : tout ce qui arrive est validé
 * d'après la définition du formulaire, et le nombre d'envois par visiteur est limité.
 */
export default defineEventHandler(async (event) => {
  requireModule('forms')
  const id = getRouterParam(event, 'id')!
  const def = formDefinitions(cmsConfig)[id]
  if (!def) throw createError({ statusCode: 404, message: 'Formulaire introuvable.' })

  // Un formulaire de contact pèse quelques kilo-octets : au-delà, ce n'en est pas un.
  if (Number(getRequestHeader(event, 'content-length') ?? 0) > 100_000) throw createError({ statusCode: 413, message: 'Message trop long.' })
  const body = await readBody<{ values?: unknown; website?: unknown }>(event).catch(() => null)
  // Champ piège, invisible pour une personne : un robot qui le remplit reçoit une réponse normale, mais rien n'est enregistré.
  if (body?.website) return { ok: true }

  const limit = { key: `form:${clientIp(event)}`, max: MAX_PER_WINDOW }
  await assertRateLimit(event, [limit], minutes => `Trop de messages envoyés. Réessayez dans ${minutes} minute${minutes > 1 ? 's' : ''}.`)

  const { values, errors } = validateSubmission(def, body?.values)
  if (Object.keys(errors).length) throw createError({ statusCode: 422, message: 'Certains champs sont à corriger.', data: { errors } })

  await hitRateLimit(event, [limit.key], WINDOW_MS)
  await storeSubmission(event, id, def, values)
  return { ok: true }
})
