/**
 * Programme la mise en ligne ou le retrait d'un contenu (droit de publier demandé). Corps :
 * `{ action: 'publish' | 'unpublish', date: '2026-12-03', time: '09:00', locales?: ['fr'] }` — l'heure est celle du site —
 * ou `{ action, at: '2026-12-03T09:00:00+01:00' }`. Voir `scheduleEntry` (server/utils/schedule.ts).
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const body = await readBody<Record<string, unknown>>(event) ?? {}
  if (typeof body !== 'object' || Array.isArray(body)) throw createError({ statusCode: 400, message: 'Un objet JSON est attendu.' })
  return scheduleEntry(event, user, getRouterParam(event, 'type')!, getRouterParam(event, 'id')!, body)
})
