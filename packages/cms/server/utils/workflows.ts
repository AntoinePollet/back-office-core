import { desc, eq, lt } from 'drizzle-orm'
import type { H3Event } from 'h3'
import type { WorkflowAction, WorkflowStep, WorkflowTrigger } from '../database/schema'
import type { CmsEvent } from './events'
import type { ModuleWorkflowEvent } from './modules'
import { adminEntryPath } from '../../shared/admin-paths'

type WorkflowRow = typeof schema.workflows.$inferSelect
type Context = Record<string, Record<string, string>>

/** Déclencheurs proposés dans le back-office. `scope` détermine les variables disponibles. */
export const WORKFLOW_EVENTS = [
  { name: 'entry.published', label: 'Un contenu est publié', done: 'publié', scope: 'entry' },
  { name: 'entry.unpublished', label: 'Un contenu est retiré du site', done: 'retiré du site', scope: 'entry' },
  { name: 'entry.created', label: 'Un contenu est créé', done: 'créé', scope: 'entry' },
  { name: 'entry.updated', label: 'Un contenu est modifié', done: 'modifié', scope: 'entry' },
  { name: 'entry.deleted', label: 'Un contenu est supprimé', done: 'supprimé', scope: 'entry' },
  { name: 'entry.review_requested', label: 'Une publication est demandée', done: 'attend d\'être publié', scope: 'review' },
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
  /** Demande de publication : s'ajoutent aux variables d'un contenu. */
  review: [
    { key: 'request.by', label: 'Nom de la personne qui demande la publication' },
    { key: 'request.note', label: 'Message laissé avec la demande' },
    { key: 'entry.title', label: 'Titre du contenu' },
    { key: 'entry.type', label: 'Type de contenu (Services, Accueil…)' },
    { key: 'entry.adminUrl', label: 'Adresse du contenu dans le back-office' },
  ],
  invite: [
    { key: 'invite.name', label: 'Nom de la personne invitée' },
    { key: 'invite.email', label: 'E-mail de la personne invitée' },
    { key: 'invite.link', label: 'Lien pour choisir son mot de passe' },
  ],
}

type Target = { key: string; label: string }
const contentTypes = (): Target[] =>
  [...Object.entries(cmsConfig.collections ?? {}), ...Object.entries(cmsConfig.singletons ?? {})].map(([key, def]) => ({ key, label: def.label }))

/** Déclencheurs apportés par les modules actifs. */
const moduleEvents = (): ModuleWorkflowEvent[] => activeModules().flatMap(m => m.workflowEvents?.() ?? [])

/**
 * Tout ce que l'éditeur de workflow propose sur ce site : les déclencheurs du core et ceux des modules actifs,
 * avec, pour chacun, ses variables et ce sur quoi on peut le restreindre (`targets`).
 */
export function workflowCatalog() {
  const types = contentTypes()
  return [
    ...WORKFLOW_EVENTS.map(e => ({
      name: e.name as string, label: e.label as string,
      variables: [...WORKFLOW_VARIABLES[e.scope], ...WORKFLOW_VARIABLES.common],
      targets: e.scope === 'invite' ? [] : types,
      targetsLabel: 'Pour quels contenus',
    })),
    ...moduleEvents().map(e => ({
      name: e.name, label: e.label,
      // Un événement de module n'a pas forcément d'auteur : pas de {{ user.email }}.
      variables: [...e.variables, ...WORKFLOW_VARIABLES.common.filter(v => v.key !== 'user.email')],
      targets: e.targets ?? [],
      targetsLabel: e.targetsLabel ?? 'Pour lesquels',
    })),
  ]
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
  const site = { name: cmsConfig.site.name, url: cmsConfig.site.url ?? origin }
  if (payload.module !== undefined) {
    const context: Context = { ...payload.context, site, user: { email: payload.user?.email ?? '' } }
    context.event = { label: payload.summary, name: payload.name, date: payload.at }
    return { context, summary: payload.summary }
  }
  const meta = WORKFLOW_EVENTS.find(e => e.name === payload.name)!
  const context: Context = { site, user: { email: payload.user.email } }
  let summary: string
  if (payload.name === 'user.invited') {
    context.invite = { name: payload.recipient, email: payload.email, link: payload.link }
    summary = payload.reason === 'reset' ? `Lien de nouveau mot de passe créé pour ${payload.recipient}` : `${payload.recipient} est invité au back-office`
  }
  else {
    const def = getDef(payload.type)
    context.entry = {
      title: payload.title, type: def.label, locale: payload.locale ?? '', url: payload.url ?? '',
      adminUrl: `${origin}${adminEntryPath(payload.type, payload.id)}`,
    }
    if (payload.name === 'entry.review_requested') context.request = { by: payload.requester, note: payload.note }
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
  const fromModule = activeModules().find(m => m.workflowEvents?.().some(e => e.name === trigger.event))
  if (fromModule) {
    const sample = fromModule.workflowEvents!().find(e => e.name === trigger.event)!.sample(trigger.types[0])
    return { name: trigger.event, module: fromModule.id, ...sample, at }
  }
  if (trigger.event === 'user.invited')
    return { name: 'user.invited', email: user.email, recipient: 'Personne de test', link: `${getRequestURL(event).origin}/admin/invite/exemple`, reason: 'invite', user: who, at }
  const type = trigger.types[0] ?? Object.keys(cmsConfig.collections ?? {})[0] ?? Object.keys(cmsConfig.singletons ?? {})[0]!
  const sample = { type, id: 'exemple', title: 'Contenu d\'exemple', locale: cmsConfig.site.defaultLocale, url: `${cmsConfig.site.url ?? getRequestURL(event).origin}/exemple`, user: who, at }
  if (trigger.event === 'entry.review_requested') return { ...sample, name: 'entry.review_requested', note: 'Message d\'exemple laissé avec la demande.', requester: 'Personne de test' }
  return { ...sample, name: trigger.event as 'entry.published' }
}

async function runAction(event: H3Event, action: WorkflowAction, context: Context): Promise<Omit<WorkflowStep, 'ms' | 'kind'>> {
  if (action.kind === 'email') {
    const to = renderTemplate(action.to, context).split(/[,;\s]+/).filter(Boolean)
    const invalid = to.filter(a => !/^\S+@\S+\.\S+$/.test(a))
    if (!to.length || invalid.length) return { status: 'error', detail: to.length ? `Adresse invalide : ${invalid.join(', ')}` : 'Aucun destinataire.' }
    const replyTo = renderTemplate(action.replyTo ?? '', context).trim()
    if (replyTo && !/^\S+@\S+\.\S+$/.test(replyTo)) return { status: 'error', detail: `Adresse de réponse invalide : ${replyTo}` }
    if (!(await mailStatus(event)).configured) return { status: 'skipped', detail: `E-mail non envoyé à ${to.join(', ')} : l'envoi n'est pas configuré sur ce site.` }
    await sendEmail(event, { to, subject: renderTemplate(action.subject, context), html: textToHtml(renderTemplate(action.body, context)), ...(replyTo ? { replyTo } : {}) })
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
  // Ce sur quoi porte l'événement : un type de contenu, ou la cible indiquée par le module (un formulaire…).
  const target = payload.module !== undefined ? payload.target : 'type' in payload ? payload.type : undefined
  const matching = rows.filter(w => w.trigger.event === payload.name
    && (target === undefined || !w.trigger.types.length || w.trigger.types.includes(target)))
  for (const workflow of matching) await executeWorkflow(event, workflow, payload)
}

/** Vérifie et normalise un workflow reçu du back-office. */
export function parseWorkflow(body: any): { name: string; enabled: boolean; trigger: WorkflowTrigger; actions: WorkflowAction[] } {
  const fail = (message: string) => { throw createError({ statusCode: 400, message }) }
  const name = String(body?.name ?? '').trim()
  if (!name) fail('Donnez un nom au workflow.')
  const meta = workflowCatalog().find(e => e.name === body?.trigger?.event)
  if (!meta) fail('Choisissez un déclencheur.')
  const known = meta!.targets.map(t => t.key)
  const types = Array.isArray(body.trigger.types) ? body.trigger.types.filter((t: unknown) => known.includes(t as string)) : []
  if (!Array.isArray(body.actions) || !body.actions.length) fail('Ajoutez au moins une action.')
  if (body.actions.length > 10) fail('Dix actions au maximum par workflow.')

  const actions: WorkflowAction[] = body.actions.map((a: any, i: number) => {
    const n = `Action ${i + 1}`
    if (a?.kind === 'email') {
      const [to, subject, text] = [a.to, a.subject, a.body].map(v => String(v ?? '').trim())
      if (!to) fail(`${n} : indiquez au moins un destinataire.`)
      if (!subject) fail(`${n} : indiquez l'objet de l'e-mail.`)
      if (!text) fail(`${n} : écrivez le message.`)
      const replyTo = String(a.replyTo ?? '').trim()
      return { kind: 'email', to, subject, body: text, ...(replyTo ? { replyTo } : {}) }
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
