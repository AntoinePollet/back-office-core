import type { H3Event } from 'h3'

/**
 * Événements émis par le back-office. C'est le point d'accroche des futurs workflows
 * (envoi d'e-mail, appel d'un service externe…) : ils s'abonneront à `cms:event`.
 *
 *   // server/plugins/exemple.ts dans un projet client
 *   export default defineNitroPlugin((nitro) => {
 *     nitro.hooks.hook('cms:event', (e) => { if (e.name === 'entry.published') … })
 *   })
 */
export type CmsEvent = { user: { id: string; email: string }; at: string } & (
  | { name: 'entry.created' | 'entry.updated' | 'entry.published' | 'entry.unpublished' | 'entry.deleted'; type: string; id: string; title: string; locale?: string; /** Adresse publique, si le contenu a une page. */ url?: string }
  /** Un lien de mot de passe vient d'être créé : un workflow peut l'envoyer par e-mail à `email`. */
  | { name: 'user.invited'; email: string; recipient: string; link: string; reason: 'invite' | 'reset' }
)

type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never
export type CmsEventInput = DistributiveOmit<CmsEvent, 'at'>

export function emitCmsEvents(event: H3Event, events: CmsEventInput[]) {
  const at = new Date().toISOString()
  const hooks = useNitroApp().hooks as unknown as { callHook: (name: string, payload: CmsEvent) => Promise<void> }
  const payloads = events.map(e => ({ ...e, at }) as CmsEvent)
  const run = Promise.all([
    // Abonnés écrits en code dans le projet client.
    ...payloads.map(p => hooks.callHook('cms:event', p)),
    // Workflows créés depuis le back-office.
    ...payloads.map(p => runWorkflows(event, p)),
  ]).catch(error => console.error('[cms] le traitement d\'un événement a échoué', error))
  // La réponse n'attend pas les abonnés ; sur Workers, waitUntil garde la requête en vie jusqu'à leur fin.
  event.waitUntil(run)
}
