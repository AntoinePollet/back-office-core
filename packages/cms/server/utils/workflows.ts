import { desc, eq, lt } from 'drizzle-orm'
import type { H3Event } from 'h3'
import type { WorkflowAction, WorkflowStep, WorkflowTrigger } from '../database/schema'
import type { CmsEvent } from './events'

type WorkflowRow = typeof schema.workflows.$inferSelect
type Context = Record<string, Record<string, string>>

/** Déclencheurs proposés dans le back-office. `scope` détermine les variables disponibles. */
export const WORKFLOW_EVENTS = [
  { name: 'entry.published', label: 'Un contenu est publié', done: 'publié', scope: 'entry' },
  { name: 'entry.unpublished', label: 'Un contenu est retiré du site', done: 'retiré du site', scope: 'entry' },
  { name: 'entry.created', label: 'Un contenu est créé', done: 'créé', scope: 'entry' },
  { name: 'entry.updated', label: 'Un contenu est modifié', done: 'modifié', scope: 'entry' },
  { name: 'entry.deleted', label: 'Un contenu est supprimé', done: 'supprimé', scope: 'entry' },
  { name: 'user.invited', label: 'Un lien de mot de passe est créé (invitation ou réinitialisation)', done: '', scope: 'invite' },
] as const

/** Variables utilisables dans les textes, par famille de déclencheur. */
export const WORKFLOW_VARIABLES = {
  common: [
    { key: 'site.name', label: 'Nom du site' },
    { key: 'site.url', label: 'Adresse du site' },
    { key: 'user.email', label: 'E-mail de la personne à l\'origine de l\'action' },
    { key: 'event.label', label: 'Ce qui s\'est passé, en une phrase' },
  ],
  entry: [
    { key: 'entry.title', label: 'Titre du contenu' },
    { key: 'entry.type', label: 'Type de contenu (Services, Accueil…)' },
    { key: 'entry.locale', label: 'Langue concernée' },
    { key: 'entry.url', label: 'Adresse publique de la page' },
    { key: 'entry.adminUrl', label: 'Adresse du contenu dans le back-office' },
  ],
  invite: [
    { key: 'invite.name', label: 'Nom de la personne invitée' },
    { key: 'invite.email', label: 'E-mail de la personne invitée' },
    { key: 'invite.link', label: 'Lien pour choisir son mot de passe' },
  ],
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]!)

/** Remplace {{ famille.variable }} par sa valeur. Une variable inconnue est remplacée par du vide. */
export function renderTemplate(template: string, context: Context) {
  return template.replace(/\{\{\s*(\w+)\.(\w+)\s*\}\}/g, (_, group: string, key: string) => context[group]?.[key] ?? '')
}

/** Texte simple → HTML d'e-mail : caractères protégés, adresses cliquables, retours à la ligne conservés. */
const textToHtml = (text: string) =>
  escapeHtml(text).replace(/https?:\/\/[^\s<]+/g, url => `<a href="${url}">${url}</a>`).replace(/\n/g, '<br>')

function buildContext(event: H3Event, payload: CmsEvent): { context: Context; summary: string } {
  const origin = getRequestURL(event).origin
  const meta = WORKFLOW_EVENTS.find(e => e.name === payload.name)!
  const context: Context = {
    site: { name: cmsConfig.site.name, url: cmsConfig.site.url ?? origin },
    user: { email: payload.user.email },
  }
  let summary: string
  if (payload.name === 'user.invited') {
    context.invite = { name: payload.recipient, email: payload.email, link: payload.link }
    summary = payload.reason === 'reset' ? `Lien de nouveau mot de passe créé pour ${payload.recipient}` : `${payload.recipient} est invité au back-office`
  }
  else {
    const def = getDef(payload.type)
    context.entry = {
      title: payload.title, type: def.label, locale: payload.locale ?? '', url: payload.url ?? '',
      adminUrl: `${origin}/admin/${payload.type}/${payload.id}`,
    }
    summary = def.kind === 'collection'
      ? `${def.label} : « ${payload.title} » ${meta.done}${payload.locale ? ` (${payload.locale})` : ''}`
      : `${def.label} ${meta.done}${payload.locale ? ` (${payload.locale})` : ''}`
  }
  context.event = { label: summary, name: payload.name, date: payload.at }
  return { context, summary }
}

/** Exemple de données pour le bouton « Tester ». */
export function sampleEvent(event: H3Event, trigger: WorkflowTrigger, user: { id: string; email: string }): CmsEvent {
  const at = new Date().toISOString()
  const who = { id: user.id, email: user.email }
  if (trigger.event === 'user.invited')
    return { name: 'user.invited', email: user.email, recipient: 'Personne de test', link: `${getRequestURL(event).origin}/admin/invite/exemple`, reason: 'invite', user: who, at }
  const type = trigger.types[0] ?? Object.keys(cmsConfig.collections ?? {})[0] ?? Object.keys(cmsConfig.singletons ?? {})[0]!
  return { name: trigger.event as 'entry.published', type, id: 'exemple', title: 'Contenu d\'exemple', locale: cmsConfig.site.defaultLocale, url: `${cmsConfig.site.url ?? getRequestURL(event).origin}/exemple`, user: who, at }
}

async function runAction(event: H3Event, action: WorkflowAction, context: Context): Promise<Omit<WorkflowStep, 'ms' | 'kind'>> {
  if (action.kind === 'email') {
    const to = renderTemplate(action.to, context).split(/[,;\s]+/).filter(Boolean)
    const invalid = to.filter(a => !/^\S+@\S+\.\S+$/.test(a))
    if (!to.length || invalid.length) return { status: 'error', detail: to.length ? `Adresse invalide : ${invalid.join(', ')}` : 'Aucun destinataire.' }
    if (!mailSettings(event).configured) return { status: 'skipped', detail: `E-mail non envoyé à ${to.join(', ')} : l'envoi n'est pas configuré sur ce site.` }
    await sendEmail(event, { to, subject: renderTemplate(action.subject, context), html: textToHtml(renderTemplate(action.body, context)) })
    return { status: 'success', detail: `E-mail envoyé à ${to.join(', ')}` }
  }
  const response = await fetch(action.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'backoffice-workflow' },
    body: JSON.stringify(context),
    signal: AbortSignal.timeout(10_000),
  })
  const host = new URL(action.url).host
  return response.ok
    ? { status: 'success', detail: `Appel de ${host} : réponse ${response.status}` }
    : { status: 'error', detail: `Appel de ${host} : réponse ${response.status}` }
}

/** Exécute les actions d'un workflow l'une après l'autre et inscrit le résultat au journal. Une action en échec n'arrête pas les suivantes. */
export async function executeWorkflow(event: H3Event, workflow: Pick<WorkflowRow, 'id' | 'name' | 'actions'>, payload: CmsEvent, test = false) {
  const { context, summary } = buildContext(event, payload)
  const startedAt = new Date()
  const steps: WorkflowStep[] = []
  for (const action of workflow.actions) {
    const t0 = Date.now()
    const result = await runAction(event, action, context).catch((error: Error) => ({
      status: 'error' as const,
      detail: error.name === 'TimeoutError' ? 'Pas de réponse après 10 secondes.' : (error.message || 'Erreur inconnue.').slice(0, 300),
    }))
    steps.push({ kind: action.kind, ...result, ms: Date.now() - t0 })
  }
  const status = steps.some(s => s.status === 'error') ? 'error' : steps.some(s => s.status === 'skipped') ? 'skipped' : 'success'
  const run = { id: crypto.randomUUID(), workflowId: workflow.id, workflowName: workflow.name, event: payload.name, summary, status, test, steps, startedAt, durationMs: Date.now() - startedAt.getTime() } as const
  const db = useDb(event)
  await db.insert(schema.workflowRuns).values(run)
  // Le journal garde 30 jours.
  await db.delete(schema.workflowRuns).where(lt(schema.workflowRuns.startedAt, new Date(Date.now() - 30 * 86400_000)))
  return run
}

/** Déclenche les workflows actifs qui correspondent à un événement. */
export async function runWorkflows(event: H3Event, payload: CmsEvent) {
  const rows = await useDb(event).select().from(schema.workflows).where(eq(schema.workflows.enabled, true))
  const matching = rows.filter(w => w.trigger.event === payload.name
    && (!('type' in payload) || !w.trigger.types.length || w.trigger.types.includes(payload.type)))
  for (const workflow of matching) await executeWorkflow(event, workflow, payload)
}

/** Vérifie et normalise un workflow reçu du back-office. */
export function parseWorkflow(body: any): { name: string; enabled: boolean; trigger: WorkflowTrigger; actions: WorkflowAction[] } {
  const fail = (message: string) => { throw createError({ statusCode: 400, message }) }
  const name = String(body?.name ?? '').trim()
  if (!name) fail('Donnez un nom au workflow.')
  const meta = WORKFLOW_EVENTS.find(e => e.name === body?.trigger?.event)
  if (!meta) fail('Choisissez un déclencheur.')
  const known = [...Object.keys(cmsConfig.collections ?? {}), ...Object.keys(cmsConfig.singletons ?? {})]
  const types = meta!.scope === 'entry' && Array.isArray(body.trigger.types) ? body.trigger.types.filter((t: unknown) => known.includes(t as string)) : []
  if (!Array.isArray(body.actions) || !body.actions.length) fail('Ajoutez au moins une action.')
  if (body.actions.length > 10) fail('Dix actions au maximum par workflow.')

  const actions: WorkflowAction[] = body.actions.map((a: any, i: number) => {
    const n = `Action ${i + 1}`
    if (a?.kind === 'email') {
      const [to, subject, text] = [a.to, a.subject, a.body].map(v => String(v ?? '').trim())
      if (!to) fail(`${n} : indiquez au moins un destinataire.`)
      if (!subject) fail(`${n} : indiquez l'objet de l'e-mail.`)
      if (!text) fail(`${n} : écrivez le message.`)
      return { kind: 'email', to, subject, body: text }
    }
    if (a?.kind === 'webhook') {
      const url = String(a.url ?? '').trim()
      if (!/^https?:\/\/\S+$/.test(url) || !URL.canParse(url)) fail(`${n} : l'adresse doit commencer par https://.`)
      return { kind: 'webhook', url }
    }
    return fail(`${n} : type d'action inconnu.`)
  })
  return { name, enabled: body.enabled !== false, trigger: { event: meta!.name, types }, actions }
}

export async function lastRuns(event: H3Event, limit: number) {
  return useDb(event).select().from(schema.workflowRuns).orderBy(desc(schema.workflowRuns.startedAt)).limit(limit)
}
