import { requireAssistant, suggestDescription } from '../../../cms-modules/assistant'

/**
 * Propose la description d'une page pour les moteurs de recherche : `{ type, locale, values }`, où `values` est le
 * contenu tel qu'il est dans le formulaire (enregistré ou non). Réponse : `{ description }`. Rien n'est enregistré.
 */
export default defineEventHandler(async (event) => {
  const { user, settings } = await requireAssistant(event)
  if (Number(getRequestHeader(event, 'content-length') ?? 0) > 1_000_000) throw createError({ statusCode: 413, message: 'Contenu trop long.' })
  const body = await readBody<{ type?: unknown; locale?: unknown; values?: unknown }>(event).catch(() => null)
  return suggestDescription(event, user, settings, { type: body?.type, locale: body?.locale, values: body?.values })
})
