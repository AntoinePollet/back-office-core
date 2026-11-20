/**
 * Publication programmée : mise en ligne ou retrait d'un contenu à une date et une heure. Fonctions sans dépendance
 * (heures et fuseaux, règles, phrases affichées) ; l'écriture et l'exécution sont dans server/utils/schedule.ts.
 *
 * ── Les choix ──
 * - **Par langue**, comme la publication : une ligne par contenu, langue et action. La fenêtre « Programmer… » coche
 *   d'office toutes les langues prêtes : sur un site à une langue, la question ne se pose pas.
 * - **Le brouillon tel qu'il est à l'heure dite** est mis en ligne, pas une copie prise au moment de programmer : on peut
 *   continuer à corriger jusqu'au dernier moment. En contrepartie, tant qu'une mise en ligne est programmée, seule une
 *   personne qui a le droit de publier peut encore modifier le contenu.
 * - **L'heure est celle du site** (`site.timeZone` dans cms.config.ts, par défaut Europe/Paris), jamais celle du
 *   navigateur : « le 3 décembre à 9 h » désigne le même instant pour tout le monde. En base, c'est un instant (UTC).
 * - **Sans brouillons** (`drafts: false`), enregistrer c'est publier : il n'y a rien à programmer.
 */

import { joinFr, languageName } from './activity'

export const DEFAULT_TIME_ZONE = 'Europe/Paris'
/** Le déclencheur planifié conseillé passe toutes les 5 minutes : c'est la précision d'une programmation. */
export const SCHEDULE_STEP_MINUTES = 5
/** On ne programme pas à plus de deux ans : au-delà, c'est presque toujours une erreur de saisie de l'année. */
export const SCHEDULE_MAX_DAYS = 730

export type ScheduleAction = 'publish' | 'unpublish'
export const SCHEDULE_ACTIONS: ScheduleAction[] = ['publish', 'unpublish']

/** Une programmation telle que l'API la donne au back-office. */
export type ScheduleInfo = {
  locale: string
  action: ScheduleAction
  /** Instant prévu (ISO, UTC). */
  at: string
  /** Qui a programmé. */
  by: string | null
  byId: string | null
  /** Présent si l'exécution a échoué : la programmation attend alors une décision. */
  failedAt?: string | null
  error?: string | null
}

// ───────────── Fuseaux horaires ─────────────

export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== 'string' || !timeZone) return false
  try { new Intl.DateTimeFormat('fr-FR', { timeZone }); return true }
  catch { return false }
}

type Wall = { year: number; month: number; day: number; hour: number; minute: number }

/** L'heure qu'il est à cet instant dans ce fuseau. */
export function wallTime(at: Date | number, timeZone: string): Wall {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(new Date(at))
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value)
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') }
}

const pad = (n: number, size = 2) => String(n).padStart(size, '0')
const asUtc = (w: Wall) => Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute)

/** Date et heure du fuseau, dans la forme des champs de saisie : « 2026-12-03 » et « 09:00 ». */
export function zonedInputs(at: Date | number | string, timeZone: string) {
  const w = wallTime(new Date(at), timeZone)
  return { date: `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}`, time: `${pad(w.hour)}:${pad(w.minute)}` }
}

/**
 * L'instant qui correspond à une date et une heure saisies dans un fuseau.
 *
 * Changements d'heure : une heure qui n'existe pas (la nuit du passage à l'heure d'été, 2 h 30 n'existe pas) est
 * refusée avec un message ; une heure qui existe deux fois (au passage à l'heure d'hiver) désigne la première.
 */
export function zonedToInstant(date: string, time: string, timeZone: string): { at: Date } | { error: string } {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '')
  const t = /^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(time ?? '')
  if (!d) return { error: 'Indiquez la date.' }
  if (!t) return { error: 'Indiquez l\'heure.' }
  const wanted: Wall = { year: Number(d[1]), month: Number(d[2]), day: Number(d[3]), hour: Number(t[1]), minute: Number(t[2]) }
  const guess = asUtc(wanted)
  const real = new Date(guess)
  if (wanted.hour > 23 || wanted.minute > 59 || real.getUTCMonth() !== wanted.month - 1 || real.getUTCDate() !== wanted.day) return { error: 'Cette date n\'existe pas.' }
  // Décalage du fuseau la veille et le lendemain : l'un des deux est le bon, les deux le sont si l'heure existe deux fois.
  const offset = (instant: number) => asUtc(wallTime(instant, timeZone)) - instant
  const candidates = [...new Set([guess - offset(guess - 86_400_000), guess - offset(guess + 86_400_000)])]
    .filter(instant => asUtc(wallTime(instant, timeZone)) === guess)
  if (!candidates.length) return { error: `Cette heure n'existe pas ce jour-là (${timeZoneLabel(timeZone)}) : c'est la nuit du changement d'heure. Choisissez une autre heure.` }
  return { at: new Date(Math.min(...candidates)) }
}

/** « heure de Paris » ; pour un autre fuseau, son nom en français suivi de son identifiant. */
export function timeZoneLabel(timeZone: string) {
  if (timeZone === 'Europe/Paris') return 'heure de Paris'
  if (timeZone === 'UTC') return 'heure universelle (UTC)'
  let name = ''
  try { name = new Intl.DateTimeFormat('fr-FR', { timeZone, timeZoneName: 'longGeneric' }).formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value ?? '' }
  catch { /* environnement sans ce format : l'identifiant suffit */ }
  return name.startsWith('heure ') && !name.includes(':') ? `${name.replace(/’/g, '\'')} (${timeZone})` : `heure du fuseau ${timeZone}`
}

/** « le 3 décembre à 9 h 00 », dans le fuseau donné ; l'année est dite si ce n'est pas celle en cours. */
export function formatScheduleDate(at: Date | number | string, timeZone: string, now: Date | number = Date.now()) {
  const instant = new Date(at)
  const w = wallTime(instant, timeZone)
  const month = new Intl.DateTimeFormat('fr-FR', { timeZone, month: 'long' }).format(instant)
  const year = w.year === wallTime(now, timeZone).year ? '' : ` ${w.year}`
  return `le ${w.day === 1 ? '1er' : w.day} ${month}${year} à ${w.hour} h ${pad(w.minute)}`
}

/**
 * Lit l'heure demandée : `{ date, time }` (heure du site, ce qu'envoie le formulaire) ou `{ at }` (instant ISO avec
 * son décalage, pour un appel direct de l'API). Refuse une heure passée ou trop lointaine.
 */
export function parseScheduleTime(input: { date?: unknown; time?: unknown; at?: unknown }, timeZone: string, now: Date | number = Date.now()): { at: Date } | { error: string } {
  let at: Date
  if (input.at !== undefined) {
    if (typeof input.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(input.at) || Number.isNaN(Date.parse(input.at)))
      return { error: 'at : un instant complet est attendu, avec son décalage (« 2026-12-03T09:00:00+01:00 »). Pour une heure du site, envoyez plutôt date et time.' }
    at = new Date(input.at)
  }
  else {
    const found = zonedToInstant(String(input.date ?? ''), String(input.time ?? ''), timeZone)
    if ('error' in found) return found
    at = found.at
  }
  const from = new Date(now).getTime()
  if (at.getTime() <= from) return { error: `Cette heure est déjà passée (${timeZoneLabel(timeZone)}). Choisissez un moment à venir, ou publiez tout de suite.` }
  if (at.getTime() - from > SCHEDULE_MAX_DAYS * 86_400_000) return { error: 'Cette date est à plus de deux ans : vérifiez l\'année.' }
  return { at }
}

/** Date et heure proposées à l'ouverture de la fenêtre : le lendemain à 9 h, heure du site. */
export function defaultScheduleInputs(timeZone: string, now: Date | number = Date.now()) {
  const tomorrow = wallTime(new Date(now).getTime() + 86_400_000, timeZone)
  return { date: `${pad(tomorrow.year, 4)}-${pad(tomorrow.month)}-${pad(tomorrow.day)}`, time: '09:00' }
}

// ───────────── Règles ─────────────

/**
 * Peut-on programmer cette action pour cette langue ? Renvoie la raison du refus, ou null.
 * - Mise en ligne : il faut un brouillon ou des modifications en attente — ou un retrait programmé avant (fermeture
 *   saisonnière : retiré le 24, remis en ligne le 2).
 * - Retrait : il faut que la langue soit en ligne — ou qu'une mise en ligne soit programmée avant (une offre mise en
 *   ligne le 3 et retirée le 24).
 */
export function scheduleProblem(input: {
  action: ScheduleAction
  at: Date | number
  /** Statut de la langue ; null : pas encore de contenu dans cette langue. */
  status: 'draft' | 'published' | 'changed' | null
  /** Les autres programmations en attente de cette langue. */
  others: { action: ScheduleAction; at: Date | number | string }[]
}): string | null {
  const at = new Date(input.at).getTime()
  const opposite = input.others.filter(o => o.action !== input.action).map(o => new Date(o.at).getTime())
  if (opposite.some(o => o === at)) return 'Une mise en ligne et un retrait ne peuvent pas être programmés à la même heure.'
  if (input.status === null) return 'Il n\'y a encore rien dans cette langue : enregistrez d\'abord un brouillon.'
  const before = opposite.some(o => o < at)
  if (input.action === 'publish' && input.status === 'published' && !before) return 'Tout est déjà en ligne dans cette langue : il n\'y a rien à mettre en ligne.'
  if (input.action === 'unpublish' && input.status === 'draft' && !before) return 'Cette langue n\'est pas en ligne : programmez d\'abord sa mise en ligne.'
  return null
}

/** Qui peut programmer : qui peut publier, et seulement là où il y a des brouillons. */
export const canSchedule = (def: { drafts?: boolean } | null | undefined, rights: { publish?: boolean } | null | undefined) => !!def?.drafts && !!rights?.publish

/**
 * Un déclencheur planifié qui passe plusieurs fois par jour (« *\/5 * * * * ») : il sert aux publications programmées
 * et ne fait pas la sauvegarde de nuit, qu'il ne rattrape que si elle est en retard.
 */
export function isFrequentCron(cron: string) {
  const [minute = '', hour = ''] = cron.trim().split(/\s+/)
  return !/^\d+$/.test(minute) || !/^\d+$/.test(hour)
}

// ───────────── Ce qui est affiché ─────────────

export const SCHEDULE_NOUNS: Record<ScheduleAction, string> = { publish: 'mise en ligne', unpublish: 'retrait du site' }
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

export type ScheduleGroup = Omit<ScheduleInfo, 'locale'> & { locales: string[] }

/** Réunit les langues programmées ensemble (même action, même heure, même personne) : une phrase au lieu de plusieurs. */
export function groupSchedules(list: ScheduleInfo[], localeOrder: readonly string[] = []): ScheduleGroup[] {
  const groups = new Map<string, ScheduleGroup>()
  for (const s of list) {
    const key = [s.action, new Date(s.at).getTime(), s.byId ?? s.by ?? '', s.failedAt ? `échec:${s.error}` : ''].join('|')
    const { locale, ...rest } = s
    const group = groups.get(key) ?? { ...rest, locales: [] }
    group.locales.push(locale)
    groups.set(key, group)
  }
  const rank = (l: string) => (localeOrder.includes(l) ? localeOrder.indexOf(l) : localeOrder.length)
  return [...groups.values()]
    .map(g => ({ ...g, locales: [...g.locales].sort((a, b) => rank(a) - rank(b)) }))
    // Les échecs d'abord (ils demandent une décision), puis dans l'ordre des dates.
    .sort((a, b) => Number(!!b.failedAt) - Number(!!a.failedAt) || new Date(a.at).getTime() - new Date(b.at).getTime())
}

/**
 * La phrase de l'état : « Mise en ligne programmée le 3 décembre à 9 h 00 (heure de Paris) par Claire Durand ».
 * `locales` : seulement sur un site à plusieurs langues, quand toutes ne sont pas concernées.
 */
export function scheduleSentence(s: { action: ScheduleAction; at: string | Date; by?: string | null; failedAt?: string | Date | null; error?: string | null; locales?: string[] }, timeZone: string, options: { now?: Date | number; me?: boolean } = {}) {
  const when = `${formatScheduleDate(s.at, timeZone, options.now)} (${timeZoneLabel(timeZone)})`
  const langs = s.locales?.length ? ` — ${joinFr(s.locales.map(languageName))}` : ''
  const who = options.me ? ' par vous' : s.by ? ` par ${s.by}` : ''
  if (s.failedAt) return `${s.action === 'publish' ? 'La mise en ligne prévue' : 'Le retrait prévu'} ${when}${langs} n'a pas pu se faire : ${s.error || 'raison inconnue.'}`
  return `${capital(SCHEDULE_NOUNS[s.action])} ${s.action === 'publish' ? 'programmée' : 'programmé'} ${when}${who}${langs}`
}

/** Le statut « Programmé » d'une liste : la prochaine échéance d'un contenu, ou l'échec à traiter. */
export function scheduleBadge(list: { action: ScheduleAction; at: string | Date; failed?: boolean }[], timeZone: string, now: Date | number = Date.now()): { label: string; title: string; failed: boolean } | null {
  if (!list.length) return null
  const failed = list.find(s => s.failed)
  if (failed) return { label: 'Programmation en échec', title: `${failed.action === 'publish' ? 'La mise en ligne prévue' : 'Le retrait prévu'} ${formatScheduleDate(failed.at, timeZone, now)} n'a pas pu se faire : ouvrez le contenu.`, failed: true }
  const next = [...list].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())[0]!
  return {
    label: next.action === 'publish' ? 'Programmé' : 'Retrait programmé',
    title: `${capital(SCHEDULE_NOUNS[next.action])} ${formatScheduleDate(next.at, timeZone, now)} (${timeZoneLabel(timeZone)})`,
    failed: false,
  }
}

/** Erreurs de champs (celles d'un enregistrement refusé) dites en une phrase, pour l'échec d'une exécution. `shared` : les champs communs aux langues, cités sans langue. */
export function describeFieldErrors(errors: Record<string, Record<string, string>>, labels: Record<string, string>, multi: boolean, shared: string[] = []) {
  const parts: string[] = []
  for (const [locale, fields] of Object.entries(errors)) {
    for (const [key, message] of Object.entries(fields)) {
      const label = key === '_' ? '' : key === 'slug' ? 'Adresse de la page' : labels[key.split('.')[0]!] ?? key
      parts.push(`${label ? `« ${label} » : ` : ''}${message.replace(/\.$/, '')}${multi && !shared.includes(key.split('.')[0]!) ? ` (${languageName(locale)})` : ''}`)
    }
  }
  const unique = [...new Set(parts)]
  return `${unique.slice(0, 4).join(' ; ')}${unique.length > 4 ? ` ; et ${unique.length - 4} autre${unique.length > 5 ? 's' : ''}` : ''}.`
}
