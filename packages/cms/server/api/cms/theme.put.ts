import { parseTheme } from '../../../shared/theme'

/** Enregistre le thème du site. Il s'applique immédiatement. */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const theme = parseTheme(await readBody(event))
  if (typeof theme === 'string') throw createError({ statusCode: 400, message: theme })
  const now = new Date()
  await useDb(event).insert(schema.settings).values({ key: 'theme', value: theme, updatedAt: now })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: theme, updatedAt: now } })
  return { theme, purgeFailed: !(await purgeSiteCache(event)) }
})
