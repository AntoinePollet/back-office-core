import { requireAssistant, translateEntry } from '../../../cms-modules/assistant'

/**
 * Traduit un contenu vers une autre langue du site : `{ type, from, to, values }`, où `values` porte les champs de
 * la langue de départ tels qu'ils sont dans le formulaire. Réponse : `{ values }` pour la langue d'arrivée (textes
 * traduits, le reste repris tel quel). Rien n'est enregistré : c'est le formulaire qui reçoit la traduction.
 */
export default defineEventHandler(async (event) => {
  const { user, settings } = await requireAssistant(event)
  if (Number(getRequestHeader(event, 'content-length') ?? 0) > 1_000_000) throw createError({ statusCode: 413, message: 'Contenu trop long.' })
  const body = await readBody<{ type?: unknown; from?: unknown; to?: unknown; values?: unknown }>(event).catch(() => null)
  return translateEntry(event, user, settings, { type: body?.type, from: body?.from, to: body?.to, values: body?.values })
})
