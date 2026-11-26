/**
 * Prise de rendez-vous (module `appointments`) : règles et textes, sans dépendance, partagés par le serveur, l'écran
 * du back-office, le site et leurs tests.
 *
 * ── Les choix ──
 * - **Un seul agenda** : deux rendez-vous ne se chevauchent jamais, quelle que soit la prestation. C'est le cas d'un
 *   indépendant ou d'un petit cabinet ; un site qui a plusieurs agendas a besoin d'un outil spécialisé.
 * - **Les réglages se font dans le back-office** (prestations, horaires, fermetures), pas dans le code : la personne
 *   qui reçoit les rendez-vous change ses horaires elle-même.
 * - **L'heure est celle du site** (`site.timeZone`), comme pour la publication programmée : « mardi à 9 h » désigne
 *   le même instant pour le visiteur et pour le professionnel. En base, c'est un instant (UTC).
 * - **Tout tombe sur une grille de cinq minutes** : durées, pas des créneaux, horaires. C'est ce qui permet à la base
 *   d'interdire deux réservations du même instant (voir `appointmentCells`).
 * - **Pas de compte pour le visiteur** : il gère son rendez-vous par le lien signé reçu par e-mail.
 */
import { csvCell } from './activity'
import { normalizeEmail } from './newsletter'
import { wallTime, zonedInputs, zonedToInstant } from './schedule'
import { type CmsTheme, DEFAULT_THEME, luminance } from './theme'

export const APPOINTMENTS = {
  /** Grille commune à toutes les heures et durées, en minutes. */
  grid: 5,
  /** Réservations acceptées par visiteur (adresse IP) et par fenêtre de dix minutes. */
  maxPerWindow: 5,
  windowMs: 10 * 60_000,
  /** Jours de créneaux renvoyés par demande, au plus. */
  maxDaysPerQuery: 42,
  /** Un rendez-vous en attente d'acompte garde son créneau ce temps-là, puis le rend. C'est aussi la durée de vie minimale d'une page de paiement Stripe. */
  holdMinutes: 30,
  /** Rendez-vous renvoyés à l'écran du back-office, par liste. */
  listMax: 500,
  /** Identifiant sous lequel un acompte est rangé dans « Paiements » : un nom réservé, jamais celui d'une collection. */
  paymentCollection: 'appointments',
} as const

const MINUTE = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

export type AppointmentStatus = 'pending' | 'confirmed' | 'cancelled'
export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = { pending: 'En attente de l\'acompte', confirmed: 'Confirmé', cancelled: 'Annulé' }

// ───────────────────────── Réglages ─────────────────────────

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export type Weekday = typeof WEEKDAYS[number]
export const WEEKDAY_LABELS: Record<Weekday, string> = { mon: 'Lundi', tue: 'Mardi', wed: 'Mercredi', thu: 'Jeudi', fri: 'Vendredi', sat: 'Samedi', sun: 'Dimanche' }

export type AppointmentService = {
  /** Identifiant stable, gardé avec chaque rendez-vous. */
  id: string
  label: string
  /** Durée en minutes. */
  duration: number
  /** Une phrase montrée au visiteur. */
  description: string
  /** Acompte demandé à la réservation, dans la devise du module Stripe (30 pour 30 €) ; 0 : aucun. */
  deposit: number
}

/** Une plage d'ouverture : [« 09:00 », « 12:30 »]. */
export type HoursRange = [string, string]
export type AppointmentClosure = { from: string; to: string; label: string }

export type AppointmentSettings = {
  services: AppointmentService[]
  /** Horaires d'une semaine ordinaire : pour chaque jour, ses plages (aucune : jour fermé). */
  hours: Record<Weekday, HoursRange[]>
  /** Écart entre deux créneaux proposés, en minutes. */
  step: number
  /** Battement gardé libre après chaque rendez-vous, en minutes. */
  buffer: number
  /** On ne réserve pas à moins de ce nombre d'heures. */
  minNoticeHours: number
  /** Ni à plus de ce nombre de jours. */
  maxAdvanceDays: number
  /** Le visiteur peut annuler lui-même jusqu'à ce nombre d'heures avant. */
  cancelNoticeHours: number
  /** Rappel par e-mail ce nombre d'heures avant ; 0 : pas de rappel. */
  reminderHours: number
  /** Jours fermés (congés, jours fériés) : du … au …, bornes comprises. */
  closed: AppointmentClosure[]
  /** Où a lieu le rendez-vous (adresse, « par téléphone »…) : rappelé dans l'e-mail et l'agenda. */
  location: string
}

export const DEFAULT_APPOINTMENT_SETTINGS: AppointmentSettings = {
  services: [{ id: 'rendez-vous', label: 'Rendez-vous', duration: 30, description: '', deposit: 0 }],
  hours: { mon: [['09:00', '12:00'], ['14:00', '18:00']], tue: [['09:00', '12:00'], ['14:00', '18:00']], wed: [['09:00', '12:00'], ['14:00', '18:00']], thu: [['09:00', '12:00'], ['14:00', '18:00']], fri: [['09:00', '12:00'], ['14:00', '18:00']], sat: [], sun: [] },
  step: 30,
  buffer: 0,
  minNoticeHours: 12,
  maxAdvanceDays: 60,
  cancelNoticeHours: 24,
  reminderHours: 24,
  closed: [],
  location: '',
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
/** « 09:30 » → 570 ; « 24:00 » (fin de journée) → 1440 ; NaN sinon. */
export const minutesOf = (time: string) => {
  if (time === '24:00') return 1440
  const m = TIME.exec(time)
  return m ? Number(m[1]) * 60 + Number(m[2]) : Number.NaN
}
const pad = (n: number) => String(n).padStart(2, '0')
export const timeOf = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
const isRealDate = (date: string) => DATE.test(date) && !Number.isNaN(Date.parse(`${date}T12:00:00Z`)) && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date

const slugify = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)

/**
 * Contrôle des réglages envoyés par l'écran. Renvoie les réglages mis en forme, ou les erreurs à montrer (une
 * phrase par problème). Rien n'est corrigé en silence : un horaire mal écrit est refusé, pas deviné.
 */
export function cleanAppointmentSettings(input: unknown): { settings: AppointmentSettings } | { errors: string[] } {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, any>
  const errors: string[] = []
  const grid = APPOINTMENTS.grid
  const int = (value: unknown, label: string, min: number, max: number, multiple = 1) => {
    const n = Number(value)
    if (!Number.isInteger(n) || n < min || n > max || n % multiple) {
      errors.push(`${label} : un nombre entier entre ${min} et ${max}${multiple > 1 ? `, multiple de ${multiple}` : ''}.`)
      return min
    }
    return n
  }

  const services: AppointmentService[] = []
  const list = Array.isArray(raw.services) ? raw.services : []
  if (!list.length) errors.push('Il faut au moins une prestation.')
  if (list.length > 20) errors.push('Vingt prestations au plus.')
  for (const item of list.slice(0, 20)) {
    const label = String(item?.label ?? '').trim()
    const at = label ? `Prestation « ${label} »` : 'Prestation sans nom'
    if (!label) errors.push('Chaque prestation a un nom.')
    if (label.length > 80) errors.push(`${at} : nom de 80 caractères au plus.`)
    const duration = int(item?.duration, `${at}, durée`, grid, 480, grid)
    const deposit = Number(item?.deposit ?? 0)
    if (!Number.isFinite(deposit) || deposit < 0 || deposit > 10_000 || Math.abs(Math.round(deposit * 100) - deposit * 100) > 1e-6) errors.push(`${at} : l'acompte est un montant entre 0 et 10 000, avec deux décimales au plus.`)
    // L'identifiant d'une prestation existante est gardé : ses rendez-vous y sont rattachés.
    let id = typeof item?.id === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(item.id) ? item.id : slugify(label) || 'prestation'
    for (let n = 2; services.some(s => s.id === id); n++) id = `${id.replace(/-\d+$/, '')}-${n}`
    services.push({ id, label: label.slice(0, 80), duration, description: String(item?.description ?? '').trim().slice(0, 300), deposit: Number.isFinite(deposit) ? deposit : 0 })
  }

  const hours = {} as Record<Weekday, HoursRange[]>
  for (const day of WEEKDAYS) {
    const ranges: HoursRange[] = []
    const given = Array.isArray(raw.hours?.[day]) ? raw.hours[day] : []
    if (given.length > 4) errors.push(`${WEEKDAY_LABELS[day]} : quatre plages au plus.`)
    for (const range of given.slice(0, 4)) {
      const [from, to] = [String(range?.[0] ?? ''), String(range?.[1] ?? '')]
      const [start, end] = [minutesOf(from), minutesOf(to)]
      if (Number.isNaN(start) || Number.isNaN(end)) { errors.push(`${WEEKDAY_LABELS[day]} : les heures s'écrivent « 09:00 ».`); continue }
      if (start % grid || end % grid) { errors.push(`${WEEKDAY_LABELS[day]} : les heures tombent sur un multiple de ${grid} minutes.`); continue }
      if (end <= start) { errors.push(`${WEEKDAY_LABELS[day]} : la plage ${from} – ${to} se termine avant de commencer.`); continue }
      ranges.push([from, to])
    }
    ranges.sort((a, b) => minutesOf(a[0]) - minutesOf(b[0]))
    if (ranges.some((r, i) => i > 0 && minutesOf(r[0]) < minutesOf(ranges[i - 1]![1]))) errors.push(`${WEEKDAY_LABELS[day]} : deux plages se chevauchent.`)
    hours[day] = ranges
  }
  if (!errors.length && WEEKDAYS.every(day => !hours[day].length)) errors.push('Aucun jour n\'est ouvert : indiquez au moins une plage horaire.')

  const closed: AppointmentClosure[] = []
  const closures = Array.isArray(raw.closed) ? raw.closed : []
  if (closures.length > 100) errors.push('Cent fermetures au plus : retirez celles qui sont passées.')
  for (const item of closures.slice(0, 100)) {
    const from = String(item?.from ?? ''), to = String(item?.to || item?.from || '')
    if (!isRealDate(from) || !isRealDate(to)) { errors.push('Une fermeture a une date de début et une date de fin.'); continue }
    if (to < from) { errors.push(`La fermeture du ${from} se termine avant de commencer.`); continue }
    closed.push({ from, to, label: String(item?.label ?? '').trim().slice(0, 80) })
  }
  closed.sort((a, b) => a.from.localeCompare(b.from))

  const settings: AppointmentSettings = {
    services, hours, closed,
    step: int(raw.step, 'Écart entre deux créneaux', grid, 240, grid),
    buffer: int(raw.buffer ?? 0, 'Battement après un rendez-vous', 0, 120, grid),
    minNoticeHours: int(raw.minNoticeHours ?? 0, 'Délai minimal avant un rendez-vous (heures)', 0, 720),
    maxAdvanceDays: int(raw.maxAdvanceDays, 'Réservation possible jusqu\'à (jours)', 1, 365),
    cancelNoticeHours: int(raw.cancelNoticeHours ?? 0, 'Annulation possible jusqu\'à (heures avant)', 0, 720),
    reminderHours: int(raw.reminderHours ?? 0, 'Rappel (heures avant)', 0, 168),
    location: String(raw.location ?? '').trim().slice(0, 200),
  }
  return errors.length ? { errors: [...new Set(errors)] } : { settings }
}

/** Réglages enregistrés (ou rien) → réglages utilisables : ceux par défaut tant que rien de valable n'est enregistré. */
export function readAppointmentSettings(stored: unknown): AppointmentSettings {
  if (!stored || typeof stored !== 'object') return structuredClone(DEFAULT_APPOINTMENT_SETTINGS)
  const cleaned = cleanAppointmentSettings(stored)
  return 'settings' in cleaned ? cleaned.settings : structuredClone(DEFAULT_APPOINTMENT_SETTINGS)
}

// ───────────────────────── Créneaux ─────────────────────────

export type Busy = { start: number; end: number }

const weekdayOf = (date: string): Weekday => WEEKDAYS[(new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7]!
export const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10)
export const isClosedDay = (settings: AppointmentSettings, date: string) => settings.closed.some(c => date >= c.from && date <= c.to)

/**
 * Les créneaux libres d'un jour pour une prestation : des instants (millisecondes), dans l'ordre.
 * `busy` : les rendez-vous déjà pris ce jour-là. Un créneau est proposé s'il tient dans une plage d'ouverture,
 * respecte les délais, et ne touche aucun rendez-vous (battement compris, des deux côtés).
 */
export function daySlots(settings: AppointmentSettings, service: AppointmentService, date: string, timeZone: string, busy: Busy[], now = Date.now()): number[] {
  if (!isRealDate(date) || isClosedDay(settings, date)) return []
  const earliest = now + settings.minNoticeHours * HOUR
  const latest = now + settings.maxAdvanceDays * DAY
  const length = service.duration * MINUTE
  const gap = settings.buffer * MINUTE
  const out: number[] = []
  for (const [from, to] of settings.hours[weekdayOf(date)]) {
    for (let minute = minutesOf(from); minute + service.duration <= minutesOf(to); minute += settings.step) {
      // Une heure qui n'existe pas ce jour-là (nuit du changement d'heure) n'est pas proposée.
      const instant = zonedToInstant(date, timeOf(minute), timeZone)
      if ('error' in instant) continue
      const start = instant.at.getTime()
      if (start < earliest || start > latest) continue
      if (busy.some(b => start < b.end + gap && start + length + gap > b.start)) continue
      out.push(start)
    }
  }
  return out
}

export type SlotDay = { date: string; slots: { at: string; time: string }[] }

/** Les créneaux libres de plusieurs jours de suite, à partir de `from` (un jour du site, AAAA-MM-JJ). */
export function slotsByDay(settings: AppointmentSettings, service: AppointmentService, from: string, days: number, timeZone: string, busy: Busy[], now = Date.now()): SlotDay[] {
  const out: SlotDay[] = []
  for (let i = 0; i < Math.min(days, APPOINTMENTS.maxDaysPerQuery); i++) {
    const date = addDays(from, i)
    out.push({ date, slots: daySlots(settings, service, date, timeZone, busy, now).map(at => ({ at: new Date(at).toISOString(), time: zonedInputs(at, timeZone).time })) })
  }
  return out
}

/** Premier jour proposé : aujourd'hui, à l'heure du site. */
export const today = (timeZone: string, now = Date.now()) => zonedInputs(now, timeZone).date

/**
 * Le créneau demandé est-il un de ceux qu'on propose ? Null s'il l'est, sinon la raison à dire au visiteur.
 * C'est la même règle que l'affichage : rien ne peut être réservé qui n'aurait pas pu être montré.
 */
export function slotProblem(settings: AppointmentSettings, service: AppointmentService, start: number, timeZone: string, busy: Busy[], now = Date.now()): string | null {
  if (!Number.isFinite(start)) return 'Créneau illisible.'
  if (start < now + settings.minNoticeHours * HOUR) return settings.minNoticeHours ? `Ce créneau est trop proche : la réservation se fait au moins ${settings.minNoticeHours} h à l'avance.` : 'Ce créneau est passé.'
  if (start > now + settings.maxAdvanceDays * DAY) return `La réservation n'est ouverte que ${settings.maxAdvanceDays} jours à l'avance.`
  const date = zonedInputs(start, timeZone).date
  if (isClosedDay(settings, date)) return 'Ce jour-là est fermé.'
  if (daySlots(settings, service, date, timeZone, busy, now).includes(start)) return null
  return daySlots(settings, service, date, timeZone, [], now).includes(start) ? 'Ce créneau vient d\'être pris. Choisissez-en un autre.' : 'Ce créneau n\'est pas proposé.'
}

/**
 * Les cases de cinq minutes qu'un rendez-vous occupe, battement compris : la base n'accepte chaque case qu'une
 * fois, ce qui interdit deux réservations simultanées du même créneau, même si elles arrivent au même instant.
 */
export function appointmentCells(start: number, end: number, bufferMinutes: number): number[] {
  const size = APPOINTMENTS.grid * MINUTE
  const cells: number[] = []
  for (let at = Math.floor(start / size) * size; at < end + bufferMinutes * MINUTE; at += size) cells.push(at)
  return cells
}

/** Le visiteur peut-il encore annuler lui-même ? */
export const canVisitorCancel = (settings: AppointmentSettings, start: number, now = Date.now()) => start - now >= settings.cancelNoticeHours * HOUR && start > now

// ───────────────────────── Saisie du visiteur ─────────────────────────

export type BookingInput = { name: string; email: string; phone: string; note: string }

/** Nettoie et contrôle ce que le visiteur a saisi. `errors` : { champ: message }, vide si tout est bon. */
export function cleanBooking(input: unknown): { values: BookingInput; errors: Record<string, string> } {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
  const errors: Record<string, string> = {}
  const name = text(raw.name), phone = text(raw.phone), note = text(raw.note)
  const email = normalizeEmail(raw.email)
  if (!name) errors.name = 'Indiquez votre nom.'
  else if (name.length > 120) errors.name = '120 caractères au plus.'
  if (!email) errors.email = 'Adresse e-mail invalide.'
  if (phone && !/^[+\d][\d\s().-]{5,24}$/.test(phone)) errors.phone = 'Numéro de téléphone invalide.'
  if (note.length > 1000) errors.note = '1000 caractères au plus.'
  return { values: { name, email: email ?? '', phone, note }, errors }
}

// ───────────────────────── Dates lisibles ─────────────────────────

const isFr = (locale: string) => locale.toLowerCase().startsWith('fr')

/** « mardi 3 décembre 2026 à 9 h 30 » / « Tuesday, December 3, 2026 at 9:30 AM », à l'heure du site. */
export function formatAppointment(start: Date | number | string, timeZone: string, locale = 'fr') {
  const at = new Date(start)
  if (!isFr(locale)) return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(at)
  const w = wallTime(at, timeZone)
  const day = new Intl.DateTimeFormat('fr-FR', { timeZone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(at)
  return `${day.replace(/ 1 /, ' 1er ')} à ${w.hour} h${w.minute ? ` ${pad(w.minute)}` : ''}`
}

export const formatDuration = (minutes: number, locale = 'fr') => {
  const h = Math.floor(minutes / 60), m = minutes % 60
  if (!isFr(locale)) return [h ? `${h} h` : '', m ? `${m} min` : ''].filter(Boolean).join(' ')
  return h ? `${h} h${m ? ` ${pad(m)}` : ''}` : `${m} min`
}

// ───────────────────────── Fichier d'agenda (.ics) ─────────────────────────

export type IcsEvent = {
  uid: string
  start: Date | number
  end: Date | number
  summary: string
  description?: string
  location?: string
  url?: string
  cancelled?: boolean
  /** Dernière modification : un agenda garde la version la plus récente d'un même événement. */
  updatedAt?: Date | number
}

const icsDate = (at: Date | number) => new Date(at).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
const icsText = (text: string) => text.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1')
/** Une ligne iCalendar ne dépasse pas 75 octets : elle se poursuit sur la suivante, qui commence par une espace. */
function icsFold(line: string) {
  const bytes = new TextEncoder().encode(line)
  if (bytes.length <= 75) return line
  const parts: string[] = []
  let current = '', size = 0
  for (const char of line) {
    const length = new TextEncoder().encode(char).length
    if (size + length > (parts.length ? 74 : 75)) { parts.push(current); current = ''; size = 0 }
    current += char
    size += length
  }
  parts.push(current)
  return parts.join('\r\n ')
}

/** Un calendrier iCalendar (RFC 5545) : un rendez-vous à ajouter à son agenda, ou tous ceux du professionnel. */
export function buildIcs(events: IcsEvent[], calendar: { name: string; host: string; stamp?: Date | number }) {
  const stamp = icsDate(calendar.stamp ?? Date.now())
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//backoffice-core//rendez-vous//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${icsText(calendar.name)}`]
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${icsText(e.uid)}@${icsText(calendar.host)}`,
      `DTSTAMP:${stamp}`,
      `LAST-MODIFIED:${icsDate(e.updatedAt ?? calendar.stamp ?? Date.now())}`,
      `SEQUENCE:${e.cancelled ? 1 : 0}`,
      `DTSTART:${icsDate(e.start)}`,
      `DTEND:${icsDate(e.end)}`,
      `SUMMARY:${icsText(e.summary)}`,
      ...(e.description ? [`DESCRIPTION:${icsText(e.description)}`] : []),
      ...(e.location ? [`LOCATION:${icsText(e.location)}`] : []),
      ...(e.url ? [`URL:${e.url}`] : []),
      `STATUS:${e.cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return lines.map(icsFold).join('\r\n') + '\r\n'
}

// ───────────────────────── Textes vus par le visiteur ─────────────────────────

type Texts = {
  confirmSubject: (site: string) => string
  confirmIntro: (name: string) => string
  cancelSubject: (site: string) => string
  cancelIntroVisitor: string
  cancelIntroStaff: (site: string) => string
  reminderSubject: (site: string) => string
  reminderIntro: (name: string) => string
  service: string
  when: string
  where: string
  duration: string
  manageButton: string
  manageHint: (hours: number) => string
  calendarLink: string
  reason: string
  title: Record<AppointmentPageKind, string>
  text: Record<AppointmentPageKind, string>
  cancelButton: string
  payButton: (amount: string) => string
  tooLate: (hours: number) => string
  paid: (amount: string) => string
  back: string
}

export type AppointmentPageKind = 'manage' | 'pending' | 'cancelled' | 'past' | 'invalid'

/** Français et anglais ; une autre langue du site reçoit l'anglais. */
const TEXTS: Record<'fr' | 'en', Texts> = {
  fr: {
    confirmSubject: site => `Votre rendez-vous est confirmé — ${site}`,
    confirmIntro: name => `Bonjour ${name}, votre rendez-vous est confirmé.`,
    cancelSubject: site => `Votre rendez-vous est annulé — ${site}`,
    cancelIntroVisitor: 'Votre rendez-vous a bien été annulé.',
    cancelIntroStaff: site => `${site} a dû annuler votre rendez-vous. Vous pouvez en reprendre un autre sur le site.`,
    reminderSubject: site => `Rappel de votre rendez-vous — ${site}`,
    reminderIntro: name => `Bonjour ${name}, nous vous rappelons votre rendez-vous.`,
    service: 'Prestation', when: 'Date', where: 'Lieu', duration: 'Durée',
    manageButton: 'Voir ou annuler mon rendez-vous',
    manageHint: hours => (hours ? `Vous pouvez l'annuler jusqu'à ${hours} h avant.` : 'Vous pouvez l\'annuler jusqu\'au dernier moment.'),
    calendarLink: 'Ajouter à mon agenda',
    reason: 'Message',
    title: { manage: 'Votre rendez-vous', pending: 'Il reste l\'acompte à régler', cancelled: 'Ce rendez-vous est annulé', past: 'Ce rendez-vous est passé', invalid: 'Ce lien n\'est plus valable' },
    text: {
      manage: 'Il est confirmé.',
      pending: 'Votre créneau est gardé une demi-heure : il sera confirmé dès réception de l\'acompte.',
      cancelled: 'Vous pouvez en prendre un autre depuis le site.',
      past: '',
      invalid: 'Le rendez-vous n\'existe plus, ou le lien a été mal recopié.',
    },
    cancelButton: 'Annuler ce rendez-vous',
    payButton: amount => `Régler l'acompte de ${amount}`,
    tooLate: hours => `Il est trop tard pour l'annuler en ligne (moins de ${hours} h avant) : contactez-nous directement.`,
    paid: amount => `Acompte reçu : ${amount}.`,
    back: 'Retour au site',
  },
  en: {
    confirmSubject: site => `Your appointment is confirmed — ${site}`,
    confirmIntro: name => `Hello ${name}, your appointment is confirmed.`,
    cancelSubject: site => `Your appointment is cancelled — ${site}`,
    cancelIntroVisitor: 'Your appointment has been cancelled.',
    cancelIntroStaff: site => `${site} had to cancel your appointment. You can book another one on the website.`,
    reminderSubject: site => `Reminder of your appointment — ${site}`,
    reminderIntro: name => `Hello ${name}, this is a reminder of your appointment.`,
    service: 'Service', when: 'Date', where: 'Location', duration: 'Duration',
    manageButton: 'View or cancel my appointment',
    manageHint: hours => (hours ? `You can cancel it up to ${hours} h before.` : 'You can cancel it until the last moment.'),
    calendarLink: 'Add to my calendar',
    reason: 'Message',
    title: { manage: 'Your appointment', pending: 'The deposit is still to be paid', cancelled: 'This appointment is cancelled', past: 'This appointment is over', invalid: 'This link is no longer valid' },
    text: {
      manage: 'It is confirmed.',
      pending: 'Your slot is held for half an hour: it will be confirmed as soon as the deposit is received.',
      cancelled: 'You can book another one from the website.',
      past: '',
      invalid: 'The appointment no longer exists, or the link was copied incorrectly.',
    },
    cancelButton: 'Cancel this appointment',
    payButton: amount => `Pay the ${amount} deposit`,
    tooLate: hours => `It is too late to cancel online (less than ${hours} h before): please contact us directly.`,
    paid: amount => `Deposit received: ${amount}.`,
    back: 'Back to the website',
  },
}

export const appointmentTexts = (locale: string): Texts => TEXTS[isFr(locale) ? 'fr' : 'en']

const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]!)
const textOn = (hex: string) => (luminance(hex) > 0.179 ? '#111827' : '#ffffff')

/** Ce qu'il faut d'un rendez-vous pour l'écrire à quelqu'un. */
export type AppointmentView = {
  name: string
  serviceLabel: string
  start: Date | number
  duration: number
  location: string
  locale: string
  /** Acompte reçu, prêt à afficher (« 30,00 € ») ; vide : aucun. */
  paid?: string
}

const summaryRows = (a: AppointmentView, timeZone: string) => {
  const t = appointmentTexts(a.locale)
  return [
    [t.service, a.serviceLabel],
    [t.when, formatAppointment(a.start, timeZone, a.locale)],
    [t.duration, formatDuration(a.duration, a.locale)],
    ...(a.location ? [[t.where, a.location]] : []),
  ] as [string, string][]
}

/**
 * Les e-mails envoyés au visiteur : confirmation, rappel, annulation (par lui-même, ou par le professionnel avec un
 * mot d'explication). Le lien de gestion y figure aussi en clair, pour les messageries sans boutons.
 */
export function appointmentEmail(kind: 'confirmed' | 'reminder' | 'cancelled-by-visitor' | 'cancelled-by-staff', a: AppointmentView, input: { siteName: string; timeZone: string; manageUrl: string; icsUrl: string; cancelNoticeHours: number; color?: string; message?: string }) {
  const t = appointmentTexts(a.locale)
  const color = input.color ?? DEFAULT_THEME.primary
  const cancelled = kind === 'cancelled-by-visitor' || kind === 'cancelled-by-staff'
  const intro = kind === 'confirmed' ? t.confirmIntro(a.name) : kind === 'reminder' ? t.reminderIntro(a.name) : kind === 'cancelled-by-visitor' ? t.cancelIntroVisitor : t.cancelIntroStaff(input.siteName)
  const rows = summaryRows(a, input.timeZone).map(([label, value]) => `<tr><td style="padding:4px 16px 4px 0;color:#555;vertical-align:top">${escape(label)}</td><td style="padding:4px 0;font-weight:600${cancelled ? ';text-decoration:line-through' : ''}">${escape(value)}</td></tr>`).join('')
  const html = [
    `<p>${escape(intro)}</p>`,
    `<table style="border-collapse:collapse;margin:12px 0">${rows}</table>`,
    ...(input.message ? [`<p><strong>${escape(t.reason)} :</strong> ${escape(input.message)}</p>`] : []),
    ...(a.paid && !cancelled ? [`<p>${escape(t.paid(a.paid))}</p>`] : []),
    ...(cancelled
      ? []
      : [
          `<p><a href="${escape(input.manageUrl)}" style="display:inline-block;padding:12px 20px;border-radius:6px;background:${escape(color)};color:${textOn(color)};text-decoration:none;font-weight:600">${escape(t.manageButton)}</a></p>`,
          `<p><a href="${escape(input.icsUrl)}">${escape(t.calendarLink)}</a></p>`,
          `<p style="font-size:13px;color:#555">${escape(t.manageHint(input.cancelNoticeHours))} ${escape(input.manageUrl)}</p>`,
        ]),
  ].join('\n')
  const subject = kind === 'confirmed' ? t.confirmSubject(input.siteName) : kind === 'reminder' ? t.reminderSubject(input.siteName) : t.cancelSubject(input.siteName)
  return { subject, html }
}

export type AppointmentPage =
  | { kind: 'invalid' }
  | {
    kind: Exclude<AppointmentPageKind, 'invalid'>
    appointment: AppointmentView
    /** Adresse où le bouton envoie l'annulation ; absente : plus d'annulation en ligne. */
    cancelAction?: string
    /** Adresse où le bouton envoie la demande de paiement de l'acompte, et son montant. */
    payAction?: string
    deposit?: string
    icsUrl?: string
    cancelNoticeHours: number
  }

/**
 * Page affichée au visiteur qui suit le lien de son rendez-vous : un document HTML autonome, aux couleurs réglées
 * dans l'écran Apparence, sans le code du site. Annuler et payer passent par un bouton (une demande POST) : un
 * lecteur d'e-mails qui ouvre le lien pour l'examiner n'annule rien.
 */
export function appointmentPageHtml(page: AppointmentPage, input: { siteName: string; locale: string; timeZone: string; theme?: Partial<CmsTheme> | null; home: string }) {
  const t = appointmentTexts(input.locale)
  const theme = { ...DEFAULT_THEME, ...input.theme }
  const primary = `display:inline-block;padding:.75rem 1.25rem;border-radius:${theme.radius}rem;background:${theme.primary};color:${textOn(theme.primary)};font:inherit;font-weight:600;text-decoration:none;border:0;cursor:pointer`
  const quiet = `display:inline-block;padding:.75rem 1.25rem;border-radius:${theme.radius}rem;background:transparent;color:inherit;font:inherit;font-weight:600;text-decoration:underline;border:0;cursor:pointer`
  const parts: string[] = []
  if (page.kind !== 'invalid') {
    const a = page.appointment
    const struck = page.kind === 'cancelled' ? ';text-decoration:line-through;opacity:.7' : ''
    parts.push(`<dl style="margin:0 0 1.5rem;display:grid;grid-template-columns:auto 1fr;gap:.35rem 1rem;text-align:left${struck}">${summaryRows(a, input.timeZone).map(([label, value]) => `<dt style="opacity:.7">${escape(label)}</dt><dd style="margin:0;font-weight:600">${escape(value)}</dd>`).join('')}</dl>`)
    if (a.paid && page.kind !== 'pending') parts.push(`<p style="margin:0 0 1rem">${escape(t.paid(a.paid))}</p>`)
    if (page.payAction && page.deposit) parts.push(`<form method="post" action="${escape(page.payAction)}" style="margin:0 0 .75rem"><button type="submit" style="${primary}" data-cms-appointment-pay>${escape(t.payButton(page.deposit))}</button></form>`)
    if (page.kind === 'manage' && page.icsUrl) parts.push(`<p style="margin:0 0 .75rem"><a href="${escape(page.icsUrl)}" style="${primary}">${escape(t.calendarLink)}</a></p>`)
    if (page.cancelAction) parts.push(`<form method="post" action="${escape(page.cancelAction)}" style="margin:0 0 .75rem"><button type="submit" style="${quiet}" data-cms-appointment-cancel>${escape(t.cancelButton)}</button></form>`)
    else if (page.kind === 'manage') parts.push(`<p style="margin:0 0 .75rem;opacity:.8">${escape(t.tooLate(page.cancelNoticeHours))}</p>`)
  }
  if (page.kind !== 'manage' && page.kind !== 'pending') parts.push(`<a href="${escape(input.home)}" style="${primary}">${escape(t.back)}</a>`)
  const text = t.text[page.kind]
  return `<!doctype html>
<html lang="${escape(input.locale)}" data-cms-appointment="${page.kind}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escape(t.title[page.kind])} — ${escape(input.siteName)}</title>
</head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:${theme.base};color:${textOn(theme.base)};font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;line-height:1.5">
<main style="max-width:32rem;padding:2rem;text-align:center">
<p style="font-weight:600;color:${theme.primary};margin:0 0 1rem">${escape(input.siteName)}</p>
<h1 style="font-size:1.75rem;line-height:1.2;margin:0 0 .75rem">${escape(t.title[page.kind])}</h1>
${text ? `<p style="margin:0 0 1.5rem;opacity:.8">${escape(text)}</p>` : ''}
${parts.join('\n')}
</main>
</body>
</html>`
}

// ───────────────────────── Back-office ─────────────────────────

export type AppointmentRow = {
  serviceLabel: string; start: Date | number | string; duration: number; status: AppointmentStatus
  name: string; email: string; phone?: string | null; note?: string | null; createdAt: Date | number | string
  paid?: string; channel?: string
}

/** Les rendez-vous en CSV lisible par un tableur français (séparateur « ; », marque d'encodage en tête). */
export function appointmentsCsv(rows: AppointmentRow[], timeZone = 'Europe/Paris') {
  const when = (at: AppointmentRow['start']) => new Date(at).toLocaleString('fr-FR', { timeZone, dateStyle: 'short', timeStyle: 'short' })
  const lines = [
    ['Date', 'Prestation', 'Durée (min)', 'État', 'Nom', 'E-mail', 'Téléphone', 'Message', 'Acompte', 'Réservé le', 'Provenance'],
    ...rows.map(r => [when(r.start), r.serviceLabel, String(r.duration), APPOINTMENT_STATUS_LABELS[r.status], r.name, r.email, r.phone ?? '', r.note ?? '', r.paid ?? '', when(r.createdAt), r.channel ?? '']),
  ]
  return '\uFEFF' + lines.map(line => line.map(csvCell).join(';')).join('\r\n')
}
