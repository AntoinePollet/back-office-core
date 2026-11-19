import { TWO_FACTOR_POLICIES, type TwoFactorPolicy } from '../../../../shared/two-factor'

/**
 * Change la règle du site. Les comptes concernés qui n'ont pas encore activé la double authentification y sont
 * conduits à leur prochaine action ; d'ici là, le serveur leur refuse tout le reste (voir `requireUser`).
 */
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { policy } = await readBody<{ policy?: TwoFactorPolicy }>(event)
  if (!policy || !TWO_FACTOR_POLICIES.includes(policy)) throw createError({ statusCode: 400, message: 'Règle inconnue.' })
  // Qui l'impose aux autres l'a d'abord fait pour lui-même : il sait ce qu'il demande, et ne se bloque pas par surprise.
  if (policy !== 'off' && !admin.twoFactorEnabled)
    throw createError({ statusCode: 400, message: 'Activez d\'abord la double authentification sur votre propre compte (« Mon compte »), puis rendez-la obligatoire.' })
  await saveTwoFactorPolicy(event, policy)
  await recordSecurityEvent(event, { action: 'two-factor.policy', by: admin.id, policy })
  return { policy }
})
