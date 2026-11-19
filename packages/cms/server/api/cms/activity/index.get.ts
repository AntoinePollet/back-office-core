import { ACTIVITY_DAYS } from '../../../../shared/activity'

/**
 * Journal d'activité, du plus récent au plus ancien. Administrateur seulement.
 * Filtres : actor (e-mail), category, action (codes séparés par des virgules), from et to (dates en millisecondes), q.
 * `before` : curseur renvoyé dans `next`, pour charger la suite.
 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const query = getQuery(event)
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 50))
  const rows = await readActivity(event, parseActivityFilters(event), limit + 1, typeof query.before === 'string' ? query.before : undefined)
  const page = rows.slice(0, limit)
  const [links, actors] = await Promise.all([activityLinks(event, page), query.before ? null : activityActors(event)])
  const last = page.at(-1)
  return {
    items: page.map(r => ({ id: r.id, at: r.at, action: r.action, category: r.category, actorName: r.actorName, actorEmail: r.actorEmail, summary: r.summary, ip: r.ip, link: links.get(r.id) ?? null })),
    next: rows.length > limit && last ? `${last.at.getTime()}:${last.id}` : null,
    /** Personnes présentes dans le journal (première page seulement). */
    actors,
    retentionDays: ACTIVITY_DAYS,
  }
})
