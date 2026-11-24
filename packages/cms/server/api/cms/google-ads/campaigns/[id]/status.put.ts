import { setCampaignStatus } from '../../../../../cms-modules/google-ads'

/** Met une campagne Google Ads en pause ou la relance : `{ status: 'PAUSED' | 'ENABLED' }`. Administrateur seulement. */
export default defineEventHandler(async (event) => {
  await requireModule(event, 'google-ads')
  const user = await requireAdmin(event)
  const body = await readBody<{ status?: unknown }>(event).catch(() => null)
  return setCampaignStatus(event, user, getRouterParam(event, 'id')!, body?.status)
})
