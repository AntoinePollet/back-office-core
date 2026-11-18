import { eq } from 'drizzle-orm'

/** Supprime le thème enregistré : le site retrouve l'apparence prévue dans son code. */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  await useDb(event).delete(schema.settings).where(eq(schema.settings.key, 'theme'))
  return { theme: null, purgeFailed: !(await purgeSiteCache(event)) }
})
