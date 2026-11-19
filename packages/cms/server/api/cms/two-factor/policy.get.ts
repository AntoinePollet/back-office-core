/** Règle du site : qui doit avoir activé la double authentification. */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return { policy: await twoFactorPolicy(event) }
})
