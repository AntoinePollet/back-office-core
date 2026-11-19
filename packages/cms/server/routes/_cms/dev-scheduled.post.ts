/**
 * En développement seulement : joue le déclencheur planifié de Cloudflare, que `nuxt dev` ne sait pas simuler.
 *
 *   curl -X POST localhost:3000/_cms/dev-scheduled -H 'content-type: application/json' -d '{"cron":"17 3 * * *"}'
 *
 * `scheduledTime` (millisecondes) fixe l'heure prévue du déclenchement, comme le fait Cloudflare. L'appel passe par
 * le même chemin qu'en production (événement `cloudflare:scheduled`). Sur un site construit (`wrangler dev`),
 * utiliser l'adresse fournie par Cloudflare : `/cdn-cgi/handler/scheduled`. Cette route n'existe pas en production.
 */
export default defineEventHandler(async (event) => {
  if (!import.meta.dev) throw createError({ statusCode: 404, message: 'Page introuvable.' })
  const body = await readBody<{ cron?: string; scheduledTime?: number }>(event).catch(() => ({} as { cron?: string; scheduledTime?: number }))
  const hooks = useNitroApp().hooks as unknown as { callHook: (name: string, payload: unknown) => Promise<void> }
  await hooks.callHook('cloudflare:scheduled', {
    controller: { cron: body?.cron ?? '17 3 * * *', scheduledTime: body?.scheduledTime ?? Date.now() },
    env: event.context.cloudflare?.env,
    context: event.context.cloudflare?.context ?? { waitUntil: () => {} },
  })
  return { ok: true }
})
