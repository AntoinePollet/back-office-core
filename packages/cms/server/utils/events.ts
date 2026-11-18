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
export type CmsEvent = { at: string } & (CoreEvent | ModuleEvent)

/**
 * Événement émis par un module (un formulaire envoyé, par exemple). Il apporte lui-même sa phrase de résumé et
 * les variables que les workflows peuvent utiliser ; `target` permet de restreindre un workflow (à un formulaire…).
 * Il n'a pas forcément d'auteur : un visiteur du site n'a pas de compte.
 */
export type ModuleEvent = { name: string; module: string; summary: string; context: Record<string, Record<string, string>>; target?: string; user?: { id: string; email: string } }

export type CoreEvent = { user: { id: string; email: string }; module?: undefined } & (
  | { name: 'entry.created' | 'entry.updated' | 'entry.published' | 'entry.unpublished' | 'entry.deleted'; type: string; id: string; title: string; locale?: string; /** Adresse publique, si le contenu a une page. */ url?: string }
  /** Quelqu'un qui ne peut pas publier signale qu'un brouillon est prêt. */
  | { name: 'entry.review_requested'; type: string; id: string; title: string; locale?: string; url?: string; note: string; requester: string }
  /** Un lien de mot de passe vient d'être créé : un workflow peut l'envoyer par e-mail à `email`. */
  | { name: 'user.invited'; email: string; recipient: string; link: string; reason: 'invite' | 'reset' }
)

export type CmsEventInput = CoreEvent | ModuleEvent

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
