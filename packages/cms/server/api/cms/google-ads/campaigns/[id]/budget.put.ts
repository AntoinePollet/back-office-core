import { setCampaignBudget } from '../../../../../cms-modules/google-ads'

/**
 * Change le budget par jour d'une campagne Google Ads : `{ amount: '25,50', expectedMicros: 20000000 }`
 * (`expectedMicros` : le budget affiché au moment de la demande). Administrateur seulement.
 */
export default defineEventHandler(async (event) => {
  await requireModule(event, 'google-ads')
  const user = await requireAdmin(event)
  const body = await readBody<{ amount?: unknown; expectedMicros?: unknown }>(event).catch(() => null)
  return setCampaignBudget(event, user, getRouterParam(event, 'id')!, body ?? {})
})
