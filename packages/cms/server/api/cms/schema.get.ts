/** Le JSON du back-office : tout ce dont l'interface a besoin pour se construire. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  if (user.role === 'admin') return cmsConfig
  // Un éditeur ne voit pas les contenus réservés aux administrateurs.
  const visible = <T extends { adminOnly?: boolean }>(defs?: Record<string, T>) =>
    Object.fromEntries(Object.entries(defs ?? {}).filter(([, def]) => !def.adminOnly))
  return { ...cmsConfig, singletons: visible(cmsConfig.singletons), collections: visible(cmsConfig.collections) }
})
