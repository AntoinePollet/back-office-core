import { CHANNELS, channelOfRow } from '../../../../shared/attribution'
import { subscribersCsv } from '../../../../shared/newsletter'
import { allSubscribers, requireNewsletterAccess, unsubscribeUrl } from '../../../cms-modules/newsletter'

/**
 * Tous les inscrits en CSV, avec le lien de désinscription de chacun : de quoi envoyer la lettre depuis un autre
 * outil en respectant les désinscriptions. `?status=confirmed` (défaut) : seulement les inscrits ; `all` : tout.
 */
export default defineEventHandler(async (event) => {
  const user = await requireNewsletterAccess(event)
  const everything = getQuery(event).status === 'all'
  const rows = (await allSubscribers(event)).filter(r => everything || r.status === 'confirmed')
  const lines = []
  for (const r of rows) lines.push({ ...r, channel: CHANNELS[channelOfRow(r.origin)], campaign: r.origin?.campaign ?? '', unsubscribeUrl: r.status === 'confirmed' ? await unsubscribeUrl(event, r) : '' })
  logActivity(event, { action: 'newsletter.exported', category: 'settings', phrase: `a exporté la liste des inscrits à la lettre d'information (${rows.length})`, actor: user })
  setResponseHeaders(event, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="lettre-inscrits-${new Date().toISOString().slice(0, 10)}.csv"`, 'cache-control': NO_CACHE })
  return subscribersCsv(lines, siteTimeZone())
})
