/**
 * Fait suivre les contenus quand `cms.config.ts` a changé : voir `server/utils/migrations.ts`.
 * Les fichiers statiques, la connexion et les médias n'en dépendent pas.
 */
export default defineEventHandler(async (event) => {
  const path = event.path
  if (path.startsWith('/_') || path.startsWith('/api/auth/') || path.startsWith('/media/')) return
  await ensureContentSchema(event)
})
