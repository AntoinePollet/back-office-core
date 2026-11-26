import { requireAssistant, suggestAlt } from '../../../cms-modules/assistant'

/** Propose le texte alternatif d'une image : `{ id, locale? }` → `{ alt }`. Rien n'est enregistré. */
export default defineEventHandler(async (event) => {
  const { settings } = await requireAssistant(event)
  const body = await readBody<{ id?: unknown; locale?: unknown }>(event).catch(() => null)
  return suggestAlt(event, settings, { id: String(body?.id ?? ''), locale: body?.locale })
})
