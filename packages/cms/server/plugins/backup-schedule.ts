/**
 * Sauvegarde automatique : s'accroche au déclencheur planifié de Cloudflare (Cron Trigger).
 *
 * Le site n'a rien à écrire : une ligne `"triggers": { "crons": ["17 3 * * *"] }` dans son wrangler.jsonc suffit.
 * Nitro transmet chaque déclenchement par l'événement `cloudflare:scheduled`. Le travail est confié à une route
 * interne, pour disposer des mêmes outils qu'une requête ordinaire (base, stockage, workflows, e-mails).
 * Un site qui a d'autres déclencheurs planifiés n'est pas gêné : la sauvegarde ne se fait qu'une fois par jour.
 */
import { SCHEDULED_ROUTE } from '../utils/backup-schedule'

type Scheduled = { controller: { cron?: string; scheduledTime?: number }; env: unknown; context: { waitUntil: (promise: Promise<unknown>) => void } }

export default defineNitroPlugin((nitroApp) => {
  const hooks = nitroApp.hooks as unknown as { hook: (name: string, fn: (payload: Scheduled) => Promise<void>) => void }
  hooks.hook('cloudflare:scheduled', async ({ controller, env, context }) => {
    const site = URL.canParse(cmsConfig.site.url ?? '') ? new URL(cmsConfig.site.url!) : null
    const response = await nitroApp.localFetch(SCHEDULED_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cron: controller.cron ?? '', scheduledTime: controller.scheduledTime ?? Date.now() }),
      host: site?.host ?? 'localhost',
      protocol: site?.protocol ?? 'https:',
      // `cmsScheduled` n'existe que pour un appel venu d'ici : une requête venue d'Internet ne peut pas le poser.
      context: { waitUntil: (promise: Promise<unknown>) => context.waitUntil(promise), _platform: { cloudflare: { env, context }, cmsScheduled: true } },
    } as Parameters<typeof nitroApp.localFetch>[1])
    if (!response.ok) console.error('[cms] la tâche planifiée a répondu', response.status, await response.text().catch(() => ''))
  })
})
