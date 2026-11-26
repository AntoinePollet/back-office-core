import { and, asc, count, desc, eq, gte, isNull, lt, notInArray, sql } from 'drizzle-orm'
import type { H3Event } from 'h3'
import {
  type CapturedError, type CheckResult, INITIAL_STATE, MONITORING, type MonitorState,
  alertEmail, alertRecipients, checkVerdict, errorFingerprint, formatDowntime, incidents, monitoringSettingsErrors, nextState, parseDsn, sentryAuth, sentryEnvelope, uptimePercent,
} from '../../shared/monitoring'
import type { CmsModuleDefinition, ModuleSettings, ModuleWorkflowEvent, TemplateContext } from '../utils/modules'

/**
 * Suivi des erreurs et surveillance du site : les erreurs du serveur et du navigateur regroupées dans le
 * back-office (et transmises à Sentry si on le veut), et une vérification du site toutes les cinq minutes, avec un
 * e-mail quand il ne répond plus. Les règles sont dans `shared/monitoring.ts`.
 */

const STATE_KEY = 'monitoring-state'
const version = () => String(useRuntimeConfig().public.cmsVersion ?? '')
const adminUrl = (event: H3Event) => `${getRequestURL(event).origin}/admin/monitoring`
/** Adresse surveillée : celle des réglages, sinon celle du site. */
const checkedUrl = (settings: ModuleSettings) => settings.checkUrl || cmsConfig.site.url || ''

const WORKFLOW_EVENTS = {
  'site.down': 'Le site ne répond plus',
  'site.up': 'Le site répond de nouveau',
  'error.new': 'Une erreur nouvelle apparaît sur le site',
} as const
const SITE_VARIABLES = [
  { key: 'monitor.url', label: 'Adresse surveillée' },
  { key: 'monitor.detail', label: 'Ce qui ne va pas' },
  { key: 'monitor.since', label: 'Début de la panne' },
  { key: 'monitor.duration', label: 'Durée de la panne (au retour)' },
  { key: 'monitor.adminUrl', label: 'Adresse de l\'écran « Surveillance »' },
]
const ERROR_VARIABLES = [
  { key: 'error.type', label: 'Nom de l\'erreur' },
  { key: 'error.message', label: 'Message de l\'erreur' },
  { key: 'error.path', label: 'Page ou route concernée' },
  { key: 'error.source', label: 'Origine : serveur ou navigateur' },
  { key: 'error.adminUrl', label: 'Adresse de l\'écran « Surveillance »' },
]

export const monitoringModule: CmsModuleDefinition = {
  id: 'monitoring',
  category: 'security',
  label: 'Suivi des erreurs et surveillance',
  // Icône « activité » de Lucide.
  logo: { style: 'stroke', color: 'currentColor', paths: ['M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2'] },
  description: 'Relève les erreurs du site (serveur et navigateur des visiteurs) dans l\'écran « Surveillance », et vérifie toutes les cinq minutes que le site répond : un e-mail part quand il tombe, un autre quand il revient. Peut transmettre les erreurs à Sentry.',
  adminPage: { to: '/admin/monitoring', label: 'Surveillance' },
  // La balise qui relève les erreurs du navigateur figure dans les pages du site.
  affectsSite: true,
  settings: [
    {
      key: 'alertEmail', label: 'Destinataires des alertes', type: 'text', placeholder: 'contact@exemple.fr',
      help: 'Une à cinq adresses, séparées par une virgule. Elles reçoivent un e-mail quand le site ne répond plus, quand il répond de nouveau, et à la première apparition d\'une erreur. Demande un module d\'envoi d\'e-mails réglé (Brevo ou Resend). Vide : rien n\'est envoyé, tout se lit dans « Surveillance ».',
    },
    {
      key: 'checkUrl', label: 'Adresse à surveiller', type: 'text', placeholder: 'https://www.exemple.fr/',
      help: 'Facultatif. Vide : l\'adresse du site (site.url). La page est demandée toutes les cinq minutes ; elle doit répondre en moins de cinq secondes.',
    },
    {
      key: 'heartbeatUrl', label: 'Adresse de battement (service extérieur)', type: 'secret', placeholder: 'https://hc-ping.com/…',
      help: 'Facultatif. Un site ne peut pas constater sa propre disparition : si tout l\'hébergement tombe, sa vérification ne tourne plus. Un service de surveillance extérieur (Healthchecks, Better Stack, UptimeRobot « heartbeat »…) donne une adresse à appeler régulièrement et alerte quand les appels cessent. Le site l\'appelle après chaque vérification réussie.',
    },
    {
      key: 'dsn', label: 'Adresse Sentry (DSN)', type: 'secret', placeholder: 'https://…@o123.ingest.sentry.io/456',
      help: 'Facultatif. Avec elle, chaque erreur est aussi transmise à Sentry (Settings → Projects → Client Keys). Sans adresse IP ni paramètres d\'adresse.',
      env: { key: 'sentryDsn', name: 'NUXT_SENTRY_DSN' },
    },
  ],
  validate: monitoringSettingsErrors,

  async test(event, settings) {
    const invalid = Object.values(monitoringSettingsErrors(settings))
    if (invalid.length) throw new Error(invalid.join(' '))
    const parts: string[] = []
    const result = await checkSite(event, settings)
    if (!result.ok) throw new Error(`La vérification du site échoue : ${result.detail} (adresse : ${checkedUrl(settings) || 'aucune'})`)
    parts.push(checkedUrl(settings) ? `Le site répond (${result.status}, ${result.ms} ms).` : 'Aucune adresse à surveiller (site.url est vide) : seule la base est vérifiée.')
    const recipients = alertRecipients(settings.alertEmail)
    const mail = await mailStatus(event)
    if (recipients.length && !mail.configured) throw new Error('Des destinataires sont réglés, mais aucun envoi d\'e-mails ne l\'est (module Brevo ou Resend) : les alertes ne partiraient pas.')
    parts.push(recipients.length ? `Les alertes partent par ${mail.module!.label} à ${recipients.join(', ')}.` : 'Aucun destinataire : les alertes ne sont pas envoyées par e-mail.')
    if (settings.dsn) {
      const status = await sendToSentry(event, settings, { source: 'server', type: 'TestError', message: 'Essai de connexion depuis le back-office', stack: '', path: '/admin/modules/monitoring', method: 'POST', status: null, browser: '' })
      if (status !== 200) throw new Error(`Sentry a refusé l'essai (${status ?? 'pas de réponse'}) : vérifiez l'adresse (DSN).`)
      parts.push('Sentry a bien reçu un événement d\'essai.')
    }
    return parts.join(' ')
  },

  workflowEvents: (): ModuleWorkflowEvent[] => (Object.keys(WORKFLOW_EVENTS) as (keyof typeof WORKFLOW_EVENTS)[]).map(name => ({
    name, label: WORKFLOW_EVENTS[name], variables: name === 'error.new' ? ERROR_VARIABLES : SITE_VARIABLES,
    sample: (): { summary: string; context: TemplateContext } => (name === 'error.new'
      ? { summary: 'Une erreur nouvelle apparaît sur le site : TypeError', context: { error: { type: 'TypeError', message: 'x is not a function', path: '/contact', source: 'navigateur', adminUrl: 'https://exemple.fr/admin/monitoring' } } }
      : { summary: `${WORKFLOW_EVENTS[name]} : https://exemple.fr/`, context: { monitor: { url: 'https://exemple.fr/', detail: name === 'site.down' ? 'La page d\'accueil répond 500.' : '', since: '26 novembre 2026 à 12:00', duration: name === 'site.up' ? '12 minutes' : '', adminUrl: 'https://exemple.fr/admin/monitoring' } } }),
  })),
}

// ───────────── Alertes ─────────────

async function sendAlert(event: H3Event, settings: ModuleSettings, mail: { subject: string; html: string }) {
  const to = alertRecipients(settings.alertEmail)
  if (!to.length || !(await mailStatus(event)).configured) return false
  try { await sendEmail(event, { to, ...mail }); return true }
  catch (error) { console.error('[cms] surveillance : l\'alerte n\'est pas partie', error); return false }
}

// ───────────── Erreurs ─────────────

/** Transmet une erreur à Sentry. Renvoie le code de la réponse, ou null si Sentry n'a pas répondu. */
async function sendToSentry(event: H3Event, settings: ModuleSettings, error: CapturedError): Promise<number | null> {
  const dsn = parseDsn(settings.dsn)
  if (!dsn) return null
  // Adresse de Sentry. Ne se change que pour les tests : NUXT_SENTRY_URL remplace l'hôte de l'adresse (DSN).
  const override = String(useRuntimeConfig(event).sentryUrl || '')
  const url = override ? `${override.replace(/\/$/, '')}/api/${dsn.projectId}/envelope/` : dsn.envelopeUrl
  const site = (() => { try { return new URL(cmsConfig.site.url ?? getRequestURL(event).origin).host } catch { return 'site' } })()
  const body = sentryEnvelope(error, { dsn: settings.dsn!, eventId: crypto.randomUUID().replace(/-/g, ''), at: Date.now(), release: `backoffice-core@${version()}`, site, environment: import.meta.dev ? 'development' : 'production' })
  return fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-sentry-envelope', 'x-sentry-auth': sentryAuth(dsn, version()) }, body, signal: AbortSignal.timeout(5000) })
    .then(response => response.status, () => null)
}

/** Écritures de la minute en cours, par instance : au-delà du plafond, les erreurs suivantes ne sont plus écrites. */
let minute = 0, writes = 0

/**
 * Enregistre une erreur : une ligne par erreur distincte, dont le compteur monte à chaque fois. La première fois,
 * une alerte part (e-mail, workflow). Ne lève jamais d'erreur : le suivi ne doit pas en ajouter une.
 */
export async function captureError(event: H3Event, error: CapturedError) {
  try {
    if (!(await activeModule(event, 'monitoring'))) return
    const now = Date.now()
    if (Math.floor(now / 60_000) !== minute) { minute = Math.floor(now / 60_000); writes = 0 }
    if (++writes > MONITORING.maxWritesPerMinute) return
    const { errors: t } = schema
    const at = new Date(now)
    const fresh = { type: error.type, message: error.message, stack: error.stack, path: error.path, method: error.method, status: error.status, browser: error.browser, release: version(), lastAt: at }
    const [row] = await useDb(event).insert(t).values({ id: crypto.randomUUID(), fingerprint: errorFingerprint(error), source: error.source, ...fresh, count: 1, firstAt: at, resolvedAt: null })
      // Une erreur marquée « corrigée » qui se reproduit redevient ouverte.
      .onConflictDoUpdate({ target: t.fingerprint, set: { ...fresh, count: sql`${t.count} + 1`, resolvedAt: null } }).returning({ count: t.count })
    const settings = await moduleSettings(event, 'monitoring')
    if (settings.dsn) await sendToSentry(event, settings, error)
    if (row?.count !== 1) return
    emitCmsEvents(event, [{
      name: 'error.new', module: 'monitoring', summary: `${WORKFLOW_EVENTS['error.new']} : ${error.type}`,
      context: { error: { type: error.type, message: error.message, path: error.path, source: error.source === 'server' ? 'serveur' : 'navigateur', adminUrl: adminUrl(event) } },
    }])
    await sendAlert(event, settings, alertEmail('error', { siteName: cmsConfig.site.name, url: checkedUrl(settings), adminUrl: adminUrl(event), now, timeZone: siteTimeZone(), error }))
  }
  catch (failure) {
    console.error('[cms] surveillance : l\'erreur n\'a pas pu être enregistrée', failure)
  }
}

/** Le module relève-t-il les erreurs du navigateur sur ce site ? (La balise n'est ajoutée aux pages que dans ce cas.) */
export const monitoringActive = async (event: H3Event) => !!(await activeModule(event, 'monitoring'))

// ───────────── Vérification du site ─────────────

/** Demande la page surveillée et interroge la base. */
async function checkSite(event: H3Event, settings: ModuleSettings): Promise<CheckResult> {
  const database = await useDb(event).select({ n: count() }).from(schema.settings).then(() => true, () => false)
  const url = checkedUrl(settings)
  if (!url) return checkVerdict({ status: 200, ms: 0, database })
  const started = Date.now()
  let status: number | null = null
  let error = ''
  try {
    // L'en-tête dit au site que ce n'est pas une visite (elle n'est pas comptée parmi les pages introuvables).
    const response = await fetch(url, { headers: { 'user-agent': 'backoffice-core-surveillance', 'x-cms-health': '1', 'cache-control': 'no-cache' }, redirect: 'follow', signal: AbortSignal.timeout(MONITORING.checkTimeoutMs) })
    status = response.status
    await response.body?.cancel().catch(() => {})
  }
  catch (failure) {
    error = (failure as Error).name === 'TimeoutError' ? `Le site n'a pas répondu après ${MONITORING.checkTimeoutMs / 1000} secondes.` : 'Le site est injoignable (connexion refusée, nom de domaine ou certificat en cause).'
  }
  return checkVerdict({ status, ms: Date.now() - started, database, error })
}

async function readState(event: H3Event): Promise<MonitorState> {
  const [row] = await useDb(event).select().from(schema.settings).where(eq(schema.settings.key, STATE_KEY))
  return { ...INITIAL_STATE, ...(row?.value && typeof row.value === 'object' ? row.value as Partial<MonitorState> : {}) }
}
async function writeState(event: H3Event, value: MonitorState) {
  const now = new Date()
  await useDb(event).insert(schema.settings).values({ key: STATE_KEY, value, updatedAt: now }).onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: now } })
}

/**
 * Une vérification : le site répond-il ? Le résultat est gardé, et l'alerte part au deuxième échec de suite (puis
 * au retour). Appelé toutes les cinq minutes par la tâche planifiée. Un site fermé exprès (construction,
 * maintenance) n'est pas surveillé : sa page d'attente n'est pas une panne.
 */
export async function runMonitoringCheck(event: H3Event, now = Date.now()) {
  if (!(await activeModule(event, 'monitoring'))) return null
  if ((await siteMode(event)) !== 'online') return { skipped: 'site fermé au public' }
  const db = useDb(event)
  const settings = await moduleSettings(event, 'monitoring')
  const result = await checkSite(event, settings)
  const { uptimeChecks: t, errors } = schema
  await db.insert(t).values({ at: new Date(now), ...result }).onConflictDoNothing()
  const before = await readState(event)
  const { state, alert } = nextState(before, result, now)
  await writeState(event, state)
  const url = checkedUrl(settings)
  if (alert) {
    const since = (alert === 'down' ? state.downSince : before.downSince) ?? now
    const when = new Date(since).toLocaleString('fr-FR', { timeZone: siteTimeZone(), dateStyle: 'long', timeStyle: 'short' })
    emitCmsEvents(event, [{
      name: alert === 'down' ? 'site.down' : 'site.up', module: 'monitoring', summary: `${WORKFLOW_EVENTS[alert === 'down' ? 'site.down' : 'site.up']} : ${url}`,
      // « site » est déjà une variable de tout workflow (nom et adresse du site) : celles-ci ont leur propre nom.
      context: { monitor: { url, detail: alert === 'down' ? result.detail : '', since: when, duration: alert === 'up' ? formatDowntime(now - since) : '', adminUrl: adminUrl(event) } },
    }])
    await sendAlert(event, settings, alertEmail(alert, { siteName: cmsConfig.site.name, url, adminUrl: adminUrl(event), detail: result.detail, since, now, timeZone: siteTimeZone() }))
  }
  // Le service extérieur n'est prévenu que si tout va bien : son silence fait l'alerte.
  if (result.ok && settings.heartbeatUrl) await fetch(settings.heartbeatUrl, { signal: AbortSignal.timeout(5000) }).catch(() => {})
  // Ménage : vérifications de plus de sept jours, erreurs qui ne se reproduisent plus, et au-delà du plafond.
  await db.delete(t).where(lt(t.at, new Date(now - MONITORING.checkDays * 86_400_000)))
  await db.delete(errors).where(lt(errors.lastAt, new Date(now - MONITORING.errorDays * 86_400_000)))
  const kept = await db.select({ id: errors.id }).from(errors).orderBy(desc(errors.lastAt)).limit(MONITORING.maxErrors)
  if (kept.length === MONITORING.maxErrors) await db.delete(errors).where(notInArray(errors.id, kept.map(k => k.id)))
  return { ok: result.ok, status: result.status, ms: result.ms, detail: result.detail, alert }
}

// ───────────── Back-office ─────────────

/** Ce que l'écran « Surveillance » affiche. */
export async function describeMonitoring(event: H3Event) {
  const db = useDb(event)
  const { errors: e, uptimeChecks: c } = schema
  const now = Date.now()
  const [errors, checks, state, settings, mail] = await Promise.all([
    db.select().from(e).orderBy(desc(e.lastAt)).limit(MONITORING.maxErrors),
    db.select().from(c).where(gte(c.at, new Date(now - MONITORING.checkDays * 86_400_000))).orderBy(asc(c.at)),
    readState(event),
    moduleSettings(event, 'monitoring'),
    mailStatus(event),
  ])
  const day = checks.filter(check => check.at.getTime() >= now - 86_400_000)
  const timed = day.filter(check => check.ok && check.ms > 0)
  return {
    errors,
    open: errors.filter(error => !error.resolvedAt).length,
    uptime: { day: uptimePercent(day), week: uptimePercent(checks), checks: checks.length, last: checks.at(-1) ?? null, averageMs: timed.length ? Math.round(timed.reduce((n, check) => n + check.ms, 0) / timed.length) : null },
    /** Les vérifications des dernières 24 heures, pour le graphique. */
    day: day.map(check => ({ at: check.at, ok: check.ok, ms: check.ms })),
    incidents: incidents(checks.map(check => ({ at: check.at.getTime(), ok: check.ok, detail: check.detail }))).slice(0, 20),
    down: state.downSince ? { since: state.downSince, detail: state.lastDetail, alerted: state.alerted } : null,
    settings: { url: checkedUrl(settings), recipients: alertRecipients(settings.alertEmail), mail: mail.configured, sentry: !!parseDsn(settings.dsn), heartbeat: !!settings.heartbeatUrl },
  }
}

/** État de la surveillance pour le tableau de bord de l'administrateur. */
export async function monitoringSummary(event: H3Event) {
  const [state, [open]] = await Promise.all([
    readState(event),
    useDb(event).select({ n: count() }).from(schema.errors).where(and(isNull(schema.errors.resolvedAt), gte(schema.errors.lastAt, new Date(Date.now() - 7 * 86_400_000)))),
  ])
  return { down: state.alerted ? state.downSince : null, detail: state.lastDetail, open: open?.n ?? 0 }
}

export async function findError(event: H3Event, id: string) {
  const [row] = await useDb(event).select().from(schema.errors).where(eq(schema.errors.id, id))
  if (!row) throw createError({ statusCode: 404, message: 'Erreur introuvable.' })
  return row
}
