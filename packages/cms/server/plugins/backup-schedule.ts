/**
 * Tâches planifiées (sauvegarde automatique, publications programmées).
 *
 * Chez Cloudflare, elles s'accrochent au déclencheur planifié (Cron Trigger). Le site n'a rien à écrire : les
 * lignes `"triggers": { "crons": [...] }` de son wrangler.jsonc suffisent. Nitro transmet chaque déclenchement par
 * l'événement `cloudflare:scheduled`.
 *
 * Sur un serveur Node, personne ne déclenche rien : le core tient lui-même l'horloge, aux mêmes heures (la sauvegarde
 * à 3 h 17, heure universelle ; les publications programmées toutes les 5 minutes).
 *
 * Dans les deux cas, le travail est confié à une route interne, pour disposer des mêmes outils qu'une requête
 * ordinaire (base, stockage, workflows, e-mails). Un site qui a d'autres déclencheurs planifiés n'est pas gêné :
 * la sauvegarde ne se fait qu'une fois par jour.
 */
import { SCHEDULED_ROUTE } from '../utils/backup-schedule'

type Scheduled = { controller: { cron?: string; scheduledTime?: number }; env: unknown; context: { waitUntil: (promise: Promise<unknown>) => void } }

const NIGHTLY = '17 3 * * *'
const FREQUENT = '*/5 * * * *'

export default defineNitroPlugin((nitroApp) => {
  /** Appelle la route interne. `platform` rejoint le contexte de la requête (les liaisons Cloudflare, par exemple). */
  const trigger = async (cron: string, scheduledTime: number, waitUntil: (promise: Promise<unknown>) => void, platform: Record<string, unknown> = {}) => {
    const site = URL.canParse(cmsConfig.site.url ?? '') ? new URL(cmsConfig.site.url!) : null
    const response = await nitroApp.localFetch(SCHEDULED_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cron, scheduledTime }),
      host: site?.host ?? 'localhost',
      protocol: site?.protocol ?? 'https:',
      // `cmsScheduled` n'existe que pour un appel venu d'ici : une requête venue d'Internet ne peut pas le poser.
      context: { waitUntil, _platform: { ...platform, cmsScheduled: true } },
    } as Parameters<typeof nitroApp.localFetch>[1])
    if (!response.ok) console.error('[cms] la tâche planifiée a répondu', response.status, await response.text().catch(() => ''))
  }

  const hooks = nitroApp.hooks as unknown as { hook: (name: string, fn: (payload: Scheduled) => Promise<void>) => void }
  hooks.hook('cloudflare:scheduled', ({ controller, env, context }) =>
    trigger(controller.cron ?? '', controller.scheduledTime ?? Date.now(), promise => context.waitUntil(promise), { cloudflare: { env, context } }))

  // Serveur Node : l'horloge du core. En développement, rien ne tourne seul (voir la route /_cms/dev-scheduled).
  if (!usePlatform().ownScheduler || import.meta.dev || import.meta.prerender) return
  const run = (cron: string, time: number) => trigger(cron, time, promise => void promise.catch(() => {}))
    .catch(error => console.error('[cms] la tâche planifiée a échoué', error))
  /** Ce qui est prévu à cette minute (comptée depuis 1970). L'heure du déclenchement est le début de la minute. */
  const minute = (index: number) => {
    const time = index * 60_000
    const at = new Date(time)
    if (at.getUTCMinutes() % 5 === 0) void run(FREQUENT, time)
    if (at.getUTCHours() === 3 && at.getUTCMinutes() === 17) void run(NIGHTLY, time)
  }
  // Un passage par minute, recalé à chaque fois juste après le début de la minute : l'horloge ne dérive pas. Si un
  // passage arrive en retard (serveur occupé), les minutes sautées sont rattrapées, dans la limite de 10. L'horloge
  // ne retient pas l'arrêt du serveur.
  let last = Math.floor(Date.now() / 60_000)
  let timer: ReturnType<typeof setTimeout> | undefined
  const arm = () => {
    timer = setTimeout(() => {
      const current = Math.floor(Date.now() / 60_000)
      for (let index = Math.max(last + 1, current - 10); index <= current; index++) minute(index)
      last = Math.max(last, current)
      arm()
    }, 60_000 - (Date.now() % 60_000) + 1000)
    timer.unref?.()
  }
  arm()
  nitroApp.hooks.hook('close', () => clearTimeout(timer))
})
