/** Le JSON du back-office : tout ce dont l'interface a besoin pour se construire. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  // Modules actifs sur ce site (déclarés ou activés dans le back-office), avec leurs options et leur famille : le menu en dépend.
  const modules = (await activeModules(event)).map(m => ({ ...cmsConfig.modules?.find(d => d.id === m.id), id: m.id, category: m.category ?? 'other' }))
  if (user.role === 'admin') return { ...cmsConfig, modules }
  // Chacun ne reçoit que les contenus auxquels il a accès : les autres n'existent pas dans son interface.
  const visible = <T>(defs?: Record<string, T>) =>
    Object.fromEntries(Object.entries(defs ?? {}).filter(([type]) => can(user, type, 'edit')))
  return { ...cmsConfig, modules, singletons: visible(cmsConfig.singletons), collections: visible(cmsConfig.collections) }
})
