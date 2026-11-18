/** Le JSON du back-office : tout ce dont l'interface a besoin pour se construire. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  if (user.role === 'admin') return cmsConfig
  // Chacun ne reçoit que les contenus auxquels il a accès : les autres n'existent pas dans son interface.
  const visible = <T>(defs?: Record<string, T>) =>
    Object.fromEntries(Object.entries(defs ?? {}).filter(([type]) => can(user, type, 'edit')))
  return { ...cmsConfig, singletons: visible(cmsConfig.singletons), collections: visible(cmsConfig.collections) }
})
