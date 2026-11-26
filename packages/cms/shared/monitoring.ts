/**
 * Suivi des erreurs et surveillance du site (module `monitoring`) : règles sans dépendance, partagées par le
 * serveur, l'écran du back-office et leurs tests.
 *
 * ── Ce que fait le module ──
 * - **Erreurs.** Les erreurs inattendues du serveur (réponses 500) et celles du navigateur des visiteurs sont
 *   regroupées (une ligne par erreur, avec son nombre et sa dernière date) dans l'écran « Surveillance ». Avec une
 *   adresse Sentry (DSN), chacune est aussi transmise à Sentry.
 * - **Surveillance.** Toutes les cinq minutes, le site demande sa propre page d'accueil et vérifie sa base. Après
 *   deux échecs de suite, un e-mail part ; un autre au retour à la normale.
 *
 * ── Ce qu'il ne peut pas faire ──
 * Un site ne peut pas constater sa propre disparition : si l'hébergement entier est en panne, la vérification ne
 * tourne pas non plus. Pour ce cas, le module peut signaler à un service extérieur qu'il est vivant (« adresse de
 * battement ») : c'est ce service qui alerte quand les signaux cessent.
 *
 * ── Données personnelles ──
 * D'une erreur, on garde le message, la pile d'appels, la page (sans ses paramètres) et la famille du navigateur.
 * Ni adresse IP, ni identifiant, ni contenu de formulaire.
 */

export const MONITORING = {
  /** Erreurs distinctes gardées ; au-delà, les plus anciennes sont effacées. */
  maxErrors: 300,
  /** Une erreur qui ne s'est pas reproduite depuis ce nombre de jours est effacée. */
  errorDays: 90,
  /** Vérifications gardées : sept jours, une toutes les cinq minutes. */
  checkDays: 7,
  /** Échecs de suite avant d'alerter : un seul peut être un simple raté du réseau. */
  failuresBeforeAlert: 2,
  /** Délai accordé à la page d'accueil pour répondre. */
  checkTimeoutMs: 10_000,
  /** Au-delà, la page a répondu mais trop lentement pour être dite en bonne santé. */
  slowMs: 5_000,
  /** Erreurs de navigateur acceptées par visiteur (adresse IP) et par fenêtre de dix minutes. */
  maxPerWindow: 20,
  windowMs: 10 * 60_000,
  /** Écritures en base par minute et par instance : une tempête d'erreurs ne doit pas saturer la base. */
  maxWritesPerMinute: 30,
} as const

type Settings = Record<string, string | undefined>

// ───────────────────────── Réglages ─────────────────────────

export type SentryDsn = { key: string; host: string; projectId: string; envelopeUrl: string }

/** Une adresse Sentry (« https://clé@o123.ingest.sentry.io/456 ») → de quoi lui écrire ; null si ce n'en est pas une. */
export function parseDsn(value: unknown): SentryDsn | null {
  try {
    const url = new URL(String(value ?? '').trim())
    const projectId = url.pathname.replace(/^\/+|\/+$/g, '').split('/').pop() ?? ''
    if (url.protocol !== 'https:' || !url.username || !/^\d+$/.test(projectId)) return null
    const base = url.pathname.replace(/\/+$/, '').split('/').slice(0, -1).join('/')
    return { key: url.username, host: url.host, projectId, envelopeUrl: `https://${url.host}${base}/api/${projectId}/envelope/` }
  }
  catch { return null }
}

const isEmail = (text: string) => /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@.<>,;]{2,}$/.test(text)
/** Destinataires des alertes : une ou plusieurs adresses, séparées par une virgule. */
export const alertRecipients = (value: unknown) => String(value ?? '').split(/[,;\s]+/).map(v => v.trim().toLowerCase()).filter(Boolean)
/** Une adresse en https ; en http seulement pour la machine elle-même (développement). */
const isHttps = (value: string) => { try { const url = new URL(value); return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)) } catch { return false } }

export function monitoringSettingsErrors(settings: Settings): Record<string, string> {
  const errors: Record<string, string> = {}
  const recipients = alertRecipients(settings.alertEmail)
  if (recipients.length > 5 || recipients.some(r => !isEmail(r))) errors.alertEmail = 'Destinataires des alertes : une à cinq adresses e-mail, séparées par une virgule.'
  if (settings.dsn && !parseDsn(settings.dsn)) errors.dsn = 'L\'adresse Sentry (DSN) s\'écrit « https://clé@o123.ingest.sentry.io/456 » : copiez-la depuis Sentry (Settings → Client Keys).'
  if (settings.checkUrl && !isHttps(settings.checkUrl)) errors.checkUrl = 'L\'adresse à surveiller commence par « https:// ».'
  return errors
}

// ───────────────────────── Erreurs ─────────────────────────

export type ErrorSource = 'server' | 'browser'
export type CapturedError = {
  source: ErrorSource
  /** Nom de l'erreur (« TypeError ») et son message. */
  type: string
  message: string
  stack: string
  /** Page ou route où l'erreur est survenue, sans paramètres. */
  path: string
  method: string
  status: number | null
  /** Famille du navigateur (« Chrome », « Safari »…), pour une erreur de navigateur. */
  browser: string
}

const clip = (text: unknown, max: number) => String(text ?? '').replace(/\u0000/g, '').slice(0, max)

/** Une adresse de page sans ses paramètres ni son ancre (ils peuvent porter une donnée personnelle), ni identifiants longs. */
export function safePath(input: unknown): string {
  const text = String(input ?? '')
  let path = text
  try { path = new URL(text, 'https://site.invalid').pathname }
  catch { path = text.split(/[?#]/)[0] ?? '' }
  return clip(path || '/', 200)
}

/** Famille du navigateur d'après son en-tête : assez pour reproduire, trop peu pour identifier quelqu'un. */
export function browserFamily(userAgent: unknown): string {
  const ua = String(userAgent ?? '')
  if (!ua) return ''
  if (/bot|crawl|spider|slurp|preview|monitor/i.test(ua)) return 'Robot'
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : ''
  const name = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Autre navigateur'
  return os ? `${name} (${os})` : name
}

/**
 * Une erreur de navigateur que le site n'y peut rien : script d'une autre origine (« Script error. » sans détail),
 * extension du navigateur, coupure de réseau, navigation interrompue. Elles ne sont pas gardées.
 */
export function isNoise(error: Pick<CapturedError, 'message' | 'stack'>): boolean {
  const { message, stack } = error
  if (!message.trim() || /^Script error\.?$/i.test(message.trim())) return true
  if (/(chrome|moz|safari|safari-web)-extension:\/\//.test(stack) || /(chrome|moz|safari|safari-web)-extension:\/\//.test(message)) return true
  return /ResizeObserver loop|Load failed|Failed to fetch|NetworkError when attempting|Importing a module script failed|error loading dynamically imported module|The operation was aborted|AbortError|cancelled|annulé/i.test(message)
}

/** Ce que le navigateur envoie, contrôlé : null si ce n'est pas une erreur exploitable. */
export function cleanBrowserError(input: unknown, userAgent: unknown): CapturedError | null {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  if (typeof raw.message !== 'string') return null
  const error: CapturedError = {
    source: 'browser', type: clip(raw.type, 80) || 'Error', message: clip(raw.message, 500), stack: clip(raw.stack, 4000),
    path: safePath(raw.path), method: 'GET', status: null, browser: browserFamily(userAgent),
  }
  return isNoise(error) || error.browser === 'Robot' ? null : error
}

/** Une erreur levée par le serveur, mise en forme. */
export function serverError(error: unknown, request: { path: string; method: string; status: number | null }): CapturedError {
  const e = (error && typeof error === 'object' ? error : { message: String(error) }) as { name?: unknown; message?: unknown; stack?: unknown; cause?: unknown }
  const cause = e.cause && typeof e.cause === 'object' ? e.cause as { name?: unknown; message?: unknown; stack?: unknown } : null
  // L'erreur d'origine dit plus que son enveloppe (« fetch failed » → la vraie raison).
  const source = cause?.message ? cause : e
  return {
    source: 'server', type: clip(source.name, 80) || 'Error', message: clip(source.message, 500) || 'Erreur sans message', stack: clip(source.stack ?? e.stack, 4000),
    path: safePath(request.path), method: clip(request.method, 10).toUpperCase(), status: request.status, browser: '',
  }
}

/** Première ligne de la pile qui désigne du code (sans numéro de colonne, sans empreinte de fichier) : là où l'erreur naît. */
export function topFrame(stack: string): string {
  const line = stack.split('\n').map(l => l.trim()).find(l => /^at\s/.test(l) || /@/.test(l)) ?? ''
  return line.replace(/\?[^):\s]*/g, '').replace(/[.-][0-9a-zA-Z_-]{8,}(\.m?js)/g, '$1').replace(/:\d+:\d+\)?$/, m => (m.endsWith(')') ? ')' : '')).slice(0, 200)
}

/**
 * Ce qui fait que deux erreurs sont « la même » : leur origine, leur nom, leur message débarrassé de ce qui change
 * d'une fois à l'autre (nombres, identifiants, adresses), et l'endroit du code où elles naissent.
 */
export function fingerprintSource(error: CapturedError): string {
  const message = error.message.replace(/https?:\/\/\S+/g, '<url>').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '<id>').replace(/\b[0-9a-f]{16,}\b/gi, '<id>').replace(/\d+/g, '0').replace(/"[^"]{0,80}"|'[^']{0,80}'/g, '""')
  return [error.source, error.type, message, topFrame(error.stack)].join('|')
}

/** Empreinte courte d'un texte (FNV-1a, 64 bits en deux moitiés) : stable, sans dépendance, suffisante pour regrouper. */
export function shortHash(text: string): string {
  let a = 0x811c9dc5, b = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193) >>> 0
    b = Math.imul(b ^ c, 0x811c9dc5) >>> 0
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')
}
export const errorFingerprint = (error: CapturedError) => shortHash(fingerprintSource(error))

// ───────────────────────── Sentry ─────────────────────────

/** Les lignes d'une pile (« at fn (fichier:ligne:colonne) ») sous la forme que Sentry attend, de la plus ancienne à la plus récente. */
export function sentryFrames(stack: string) {
  const frames: { function?: string; filename: string; lineno?: number; colno?: number; in_app: boolean }[] = []
  for (const line of stack.split('\n')) {
    const match = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/.exec(line) ?? /^\s*(.*?)@(.+?):(\d+):(\d+)\s*$/.exec(line)
    if (!match) continue
    frames.push({ ...(match[1] ? { function: match[1] } : {}), filename: match[2]!, lineno: Number(match[3]), colno: Number(match[4]), in_app: !/node_modules|node:internal/.test(match[2]!) })
  }
  return frames.reverse().slice(-50)
}

/**
 * L'enveloppe Sentry d'une erreur (https://develop.sentry.dev/sdk/envelopes/) : trois lignes de JSON. Rien de
 * personnel n'y figure : ni adresse IP (Sentry est prié de ne pas la relever), ni paramètres d'adresse.
 */
export function sentryEnvelope(error: CapturedError, input: { dsn: string; eventId: string; at: number; release: string; site: string; environment: string }) {
  const event = {
    event_id: input.eventId,
    timestamp: input.at / 1000,
    platform: error.source === 'server' ? 'node' : 'javascript',
    level: 'error',
    release: input.release,
    environment: input.environment,
    server_name: input.site,
    transaction: `${error.method} ${error.path}`,
    tags: { source: error.source, ...(error.browser ? { browser: error.browser } : {}), ...(error.status ? { status: String(error.status) } : {}) },
    request: { url: `https://${input.site}${error.path}`, method: error.method },
    user: { ip_address: null },
    exception: { values: [{ type: error.type, value: error.message, stacktrace: { frames: sentryFrames(error.stack) } }] },
  }
  return [
    JSON.stringify({ event_id: input.eventId, sent_at: new Date(input.at).toISOString(), dsn: input.dsn }),
    JSON.stringify({ type: 'event', content_type: 'application/json' }),
    JSON.stringify(event),
  ].join('\n') + '\n'
}
export const sentryAuth = (dsn: SentryDsn, version: string) => `Sentry sentry_version=7, sentry_key=${dsn.key}, sentry_client=backoffice-core/${version}`

// ───────────────────────── Surveillance ─────────────────────────

export type CheckResult = { ok: boolean; status: number | null; ms: number; detail: string }

/** Verdict d'une vérification : la page a-t-elle répondu correctement, assez vite, et la base est-elle joignable ? */
export function checkVerdict(input: { status: number | null; ms: number; database: boolean; error?: string }): CheckResult {
  const { status, ms } = input
  if (!input.database) return { ok: false, status, ms, detail: 'La base de données ne répond pas.' }
  if (status === null) return { ok: false, status, ms, detail: input.error || 'Le site n\'a pas répondu.' }
  if (status >= 400) return { ok: false, status, ms, detail: `La page d'accueil répond ${status}.` }
  if (ms > MONITORING.slowMs) return { ok: false, status, ms, detail: `La page d'accueil a mis ${(ms / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s à répondre.` }
  return { ok: true, status, ms, detail: '' }
}

/** État de la surveillance, gardé d'une vérification à l'autre. */
export type MonitorState = {
  /** Échecs de suite. */
  failures: number
  /** Début de la panne en cours (instant du premier échec), ou null. */
  downSince: number | null
  /** L'alerte de cette panne est partie. */
  alerted: boolean
  lastDetail: string
}
export const INITIAL_STATE: MonitorState = { failures: 0, downSince: null, alerted: false, lastDetail: '' }

/**
 * Ce qu'une vérification change : le nouvel état, et l'alerte à envoyer s'il y en a une. « down » part une seule
 * fois par panne, au deuxième échec de suite ; « up » ne part que si « down » était parti.
 */
export function nextState(state: MonitorState, result: CheckResult, now: number): { state: MonitorState; alert: 'down' | 'up' | null } {
  if (result.ok) return { state: { ...INITIAL_STATE }, alert: state.alerted ? 'up' : null }
  const failures = state.failures + 1
  const downSince = state.downSince ?? now
  const due = !state.alerted && failures >= MONITORING.failuresBeforeAlert
  return { state: { failures, downSince, alerted: state.alerted || due, lastDetail: result.detail }, alert: due ? 'down' : null }
}

/** « 12 minutes », « 2 h 05 », « 3 jours ». */
export function formatDowntime(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''}`
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`
  return `${Math.round(minutes / 1440)} jours`
}

const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]!)

/** Les e-mails d'alerte : le site ne répond plus, le site répond de nouveau, une erreur nouvelle est apparue. */
export function alertEmail(kind: 'down' | 'up' | 'error', input: { siteName: string; url: string; adminUrl: string; detail?: string; since?: number; now: number; timeZone: string; error?: Pick<CapturedError, 'type' | 'message' | 'path' | 'source'> }) {
  const time = (at: number) => new Date(at).toLocaleString('fr-FR', { timeZone: input.timeZone, dateStyle: 'long', timeStyle: 'short' })
  const link = `<p><a href="${escape(input.adminUrl)}">Ouvrir l'écran « Surveillance »</a></p>`
  if (kind === 'error') {
    const e = input.error!
    return {
      subject: `Nouvelle erreur sur ${input.siteName}`,
      html: [
        `<p>Une erreur qui n'avait pas encore été vue vient de se produire ${e.source === 'server' ? 'sur le serveur' : 'dans le navigateur d\'un visiteur'}.</p>`,
        `<p><strong>${escape(e.type)}</strong> : ${escape(e.message)}<br>Page : ${escape(e.path)}</p>`,
        '<p style="font-size:13px;color:#555">Un seul e-mail part par erreur nouvelle : ses répétitions sont comptées dans le back-office.</p>',
        link,
      ].join('\n'),
    }
  }
  if (kind === 'down') {
    return {
      subject: `${input.siteName} ne répond plus`,
      html: [
        `<p>Le site <a href="${escape(input.url)}">${escape(input.url)}</a> ne répond plus correctement depuis le ${escape(time(input.since ?? input.now))}.</p>`,
        `<p><strong>${escape(input.detail || 'Le site n\'a pas répondu.')}</strong></p>`,
        '<p style="font-size:13px;color:#555">Deux vérifications de suite ont échoué. Un autre e-mail partira quand le site répondra de nouveau.</p>',
        link,
      ].join('\n'),
    }
  }
  return {
    subject: `${input.siteName} répond de nouveau`,
    html: [
      `<p>Le site <a href="${escape(input.url)}">${escape(input.url)}</a> répond de nouveau depuis le ${escape(time(input.now))}.</p>`,
      `<p>La panne a duré environ ${escape(formatDowntime(input.now - (input.since ?? input.now)))}.</p>`,
      link,
    ].join('\n'),
  }
}

/** Part du temps où le site a répondu, sur des vérifications : « 99,8 % » ; null sans vérification. */
export function uptimePercent(checks: { ok: boolean }[]): string | null {
  if (!checks.length) return null
  const ratio = checks.filter(c => c.ok).length / checks.length
  // Jamais « 100 % » s'il y a eu un échec.
  const shown = ratio < 1 ? Math.min(99.9, Math.floor(ratio * 1000) / 10) : 100
  return `${shown.toLocaleString('fr-FR', { minimumFractionDigits: ratio < 1 ? 1 : 0, maximumFractionDigits: 1 })} %`
}

export type Incident = { from: number; to: number | null; detail: string }
/** Les pannes d'une suite de vérifications (de la plus ancienne à la plus récente) : du premier échec au retour. */
export function incidents(checks: { at: number; ok: boolean; detail: string }[]): Incident[] {
  const out: Incident[] = []
  let open: Incident | null = null
  for (const check of checks) {
    if (!check.ok && !open) open = { from: check.at, to: null, detail: check.detail }
    else if (check.ok && open) { out.push({ ...open, to: check.at }); open = null }
  }
  if (open) out.push(open)
  return out.reverse()
}
