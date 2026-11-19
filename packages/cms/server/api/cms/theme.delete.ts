import { eq } from 'drizzle-orm'

/** Supprime le thème enregistré : le site retrouve l'apparence prévue dans son code. */
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  await useDb(event).delete(schema.settings).where(eq(schema.settings.key, 'theme'))
  logActivity(event, { action: 'theme.reset', actor: admin, target: { kind: 'theme' } })
  return { theme: null, purgeFailed: !(await purgeSiteCache(event)) }
})
