import { and, asc, count, desc, eq, gt, gte, inArray, isNull, lt, lte } from 'drizzle-orm'
import type { H3Event } from 'h3'
import {
  APPOINTMENTS, type AppointmentPage, type AppointmentService, type AppointmentSettings, type AppointmentView, type BookingInput, type Busy,
  addDays, appointmentCells, appointmentEmail, appointmentPageHtml, buildIcs, canVisitorCancel, cleanAppointmentSettings, formatAppointment, formatDuration,
  readAppointmentSettings, slotProblem, slotsByDay, today,
} from '../../shared/appointments'
import { CHANNELS, type StoredOrigin, channelOfRow, originToMetadata } from '../../shared/attribution'
import { type CheckoutMetadata, checkoutParams, encodeForm, formatAmount, toMinorUnits } from '../../shared/stripe'
import type { CmsTheme } from '../../shared/theme'
import type { CmsModuleDefinition, ModuleWorkflowEvent } from '../utils/modules'
import { stripeOptions, stripeRequest } from './stripe'

/**
 * Prise de rendez-vous : réglages, réservation, annulation, e-mails, rappels, acompte par Stripe et agenda à
 * abonner. Les règles (créneaux, textes, fichier d'agenda) sont dans `shared/appointments.ts`.
 */

type Row = typeof schema.appointments.$inferSelect
type Actor = { id: string; name?: string | null; email?: string | null }
const MINUTE = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000
/** Un rendez-vous terminé est effacé au bout de treize mois : ce sont des données personnelles. */
const RETENTION_DAYS = 400
const SETTINGS_KEY = 'appointments'

const workflowVariables = [
  { key: 'appointment.service', label: 'Prestation' },
  { key: 'appointment.date', label: 'Date et heure du rendez-vous' },
  { key: 'appointment.duration', label: 'Durée' },
  { key: 'appointment.name', label: 'Nom de la personne' },
  { key: 'appointment.email', label: 'E-mail de la personne' },
  { key: 'appointment.phone', label: 'Téléphone de la personne' },
  { key: 'appointment.note', label: 'Message laissé à la réservation' },
  { key: 'appointment.location', label: 'Lieu du rendez-vous' },
  { key: 'appointment.deposit', label: 'Acompte reçu' },
  { key: 'appointment.cancelledBy', label: 'Annulé par (le visiteur, le site)' },
  { key: 'appointment.adminUrl', label: 'Adresse du rendez-vous dans le back-office' },
  { key: 'origin.channel', label: 'Provenance : canal (Google Ads, e-mail, moteur de recherche…)' },
  { key: 'origin.campaign', label: 'Provenance : nom de la campagne' },
]

const EVENT_LABELS = { 'appointment.booked': 'Un rendez-vous est pris', 'appointment.cancelled': 'Un rendez-vous est annulé' } as const

export const appointmentsModule: CmsModuleDefinition = {
  id: 'appointments',
  category: 'booking',
  label: 'Prise de rendez-vous',
  // Icône « calendrier coché » de Lucide.
  logo: { style: 'stroke', color: 'currentColor', paths: ['M8 2v4', 'M16 2v4', 'M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M3 10h18', 'm9 16 2 2 4-4'] },
  description: 'Les visiteurs choisissent une prestation et un créneau libre, et reçoivent une confirmation par e-mail avec un fichier d\'agenda. Horaires, prestations et fermetures se règlent dans « Rendez-vous » ; un acompte peut être demandé par Stripe.',
  adminPage: { to: '/admin/appointments', label: 'Rendez-vous' },

  async test(event) {
    const settings = await appointmentSettings(event)
    const mail = await mailStatus(event)
    const parts = [`${settings.services.length} prestation${settings.services.length > 1 ? 's' : ''} proposée${settings.services.length > 1 ? 's' : ''}.`]
    if (!mail.configured) throw new Error('Aucun envoi d\'e-mails n\'est réglé sur ce site (module Brevo ou Resend) : les rendez-vous sont enregistrés, mais ni la confirmation ni le rappel ne partent.')
    parts.push(`Les e-mails de confirmation partent par ${mail.module!.label}.`)
    if (settings.services.some(s => s.deposit > 0)) {
      const stripe = await depositProvider(event)
      if (!stripe) throw new Error('Un acompte est demandé, mais le module Stripe n\'est pas actif et réglé : les rendez-vous sont pris sans acompte.')
      parts.push('Les acomptes sont encaissés par Stripe.')
    }
    return parts.join(' ')
  },

  workflowEvents: (): ModuleWorkflowEvent[] => (Object.keys(EVENT_LABELS) as (keyof typeof EVENT_LABELS)[]).map(name => ({
    name,
    label: EVENT_LABELS[name],
    variables: workflowVariables,
    sample: () => ({
      summary: `${EVENT_LABELS[name]} : Jeanne Martin, mardi 1er décembre 2026 à 9 h 30`,
      context: {
        appointment: {
          service: 'Première consultation', date: 'mardi 1er décembre 2026 à 9 h 30', duration: '45 min', name: 'Jeanne Martin', email: 'jeanne@example.com', phone: '06 12 34 56 78',
          note: 'Première visite.', location: '12 rue des Lilas, Lyon', deposit: '', cancelledBy: name === 'appointment.cancelled' ? 'le visiteur' : '', adminUrl: 'https://exemple.fr/admin/appointments',
        },
        origin: { channel: CHANNELS['google-ads'], campaign: 'printemps' },
      },
    }),
  })),
}

// ───────────── Réglages ─────────────

export async function appointmentSettings(event: H3Event): Promise<AppointmentSettings> {
  return (event.context._cmsAppointmentSettings ??= useDb(event).select().from(schema.settings).where(eq(schema.settings.key, SETTINGS_KEY))
    .then(([row]) => readAppointmentSettings(row?.value))) as Promise<AppointmentSettings>
}

export async function saveAppointmentSettings(event: H3Event, user: Actor, body: unknown) {
  const cleaned = cleanAppointmentSettings(body)
  if ('errors' in cleaned) throw createError({ statusCode: 422, message: cleaned.errors.join(' '), data: { errors: cleaned.errors } })
  const now = new Date()
  await useDb(event).insert(schema.settings).values({ key: SETTINGS_KEY, value: cleaned.settings, updatedAt: now })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: cleaned.settings, updatedAt: now } })
  event.context._cmsAppointmentSettings = Promise.resolve(cleaned.settings)
  logActivity(event, { action: 'appointments.settings', category: 'settings', actor: user, target: { kind: 'appointments' }, phrase: 'a modifié les réglages des rendez-vous (prestations, horaires, fermetures)' })
  return cleaned.settings
}

/** Le module Stripe, s'il est actif et réglé : c'est lui qui encaisse les acomptes. */
async function depositProvider(event: H3Event) {
  if (!(await activeModule(event, 'stripe'))) return null
  const settings = await moduleSettings(event, 'stripe')
  return settings.secretKey && settings.webhookSecret ? { key: settings.secretKey, currency: stripeOptions().currency ?? 'eur' } : null
}

/** Acompte d'une prestation, en plus petite unité de la devise ; null s'il n'y en a pas (ou pas de Stripe pour l'encaisser). */
async function depositFor(event: H3Event, service: AppointmentService) {
  if (!(service.deposit > 0)) return null
  const stripe = await depositProvider(event)
  const amount = stripe ? toMinorUnits(service.deposit, stripe.currency) : null
  return stripe && amount ? { amount, currency: stripe.currency, key: stripe.key } : null
}

// ───────────── Liens signés ─────────────

const SCOPE = 'appointment'
const linkTo = async (event: H3Event, route: 'manage' | 'ics', row: Pick<Row, 'id'>) =>
  `${getRequestURL(event).origin}/api/appointments/${route}?id=${row.id}&t=${await signLink(event, SCOPE, row.id)}`

/** Le rendez-vous que désigne un lien reçu par e-mail, ou null si le lien est faux ou si le rendez-vous n'existe plus. */
export async function appointmentFromLink(event: H3Event) {
  const query = getQuery(event)
  const id = String(query.id ?? '')
  if (!/^[0-9a-f-]{36}$/.test(id) || !(await verifyLink(event, SCOPE, id, query.t))) return null
  const [row] = await useDb(event).select().from(schema.appointments).where(eq(schema.appointments.id, id))
  return row ?? null
}

/** Adresse de l'agenda à abonner (Google Agenda, Outlook, Apple) : tous les rendez-vous, protégée par sa signature. */
export const appointmentsFeedUrl = async (event: H3Event) => `${getRequestURL(event).origin}/api/appointments/feed.ics?t=${await signLink(event, 'appointments-feed', 'all')}`
export const isFeedLink = (event: H3Event) => verifyLink(event, 'appointments-feed', 'all', getQuery(event).t)

// ───────────── Lecture ─────────────

const durationOf = (row: Pick<Row, 'start' | 'end'>) => Math.round((row.end.getTime() - row.start.getTime()) / MINUTE)
const paidText = (row: Pick<Row, 'paidAt' | 'depositAmount' | 'currency'>) => (row.paidAt && row.depositAmount ? formatAmount(row.depositAmount, row.currency ?? 'eur') : '')
const viewOf = (row: Row): AppointmentView => ({ name: row.name, serviceLabel: row.serviceLabel, start: row.start, duration: durationOf(row), location: row.location ?? '', locale: row.locale, paid: paidText(row) })

/**
 * Rend leur créneau aux rendez-vous dont l'acompte n'a jamais été réglé. Appelé avant toute lecture des créneaux :
 * un créneau abandonné sur la page de paiement redevient libre sans attendre la tâche planifiée.
 */
export async function releaseExpiredHolds(event: H3Event, now = Date.now()) {
  const db = useDb(event)
  const { appointments: t, appointmentSlots } = schema
  // Deux minutes de marge : la page de paiement de Stripe vit une demi-heure, le paiement peut arriver à la dernière seconde.
  const limit = new Date(now - (APPOINTMENTS.holdMinutes + 2) * MINUTE)
  const expired = await db.update(t).set({ status: 'cancelled', cancelledAt: new Date(now), cancelledBy: 'expired', updatedAt: new Date(now) })
    .where(and(eq(t.status, 'pending'), lt(t.createdAt, limit))).returning({ id: t.id })
  if (expired.length) await db.delete(appointmentSlots).where(inArray(appointmentSlots.appointmentId, expired.map(e => e.id)))
  return expired.length
}

/** Rendez-vous en cours (confirmés ou en attente d'acompte) qui touchent une période. */
async function busyBetween(event: H3Event, from: number, to: number, except?: string): Promise<Busy[]> {
  const { appointments: t } = schema
  const rows = await useDb(event).select({ id: t.id, start: t.start, end: t.end }).from(t)
    .where(and(inArray(t.status, ['pending', 'confirmed']), lt(t.start, new Date(to)), gt(t.end, new Date(from))))
  return rows.filter(r => r.id !== except).map(r => ({ start: r.start.getTime(), end: r.end.getTime() }))
}

/** Ce que le site montre avant la réservation : les prestations, sans rien de privé. */
export async function publicAppointments(event: H3Event) {
  const settings = await appointmentSettings(event)
  const stripe = await depositProvider(event)
  return {
    services: settings.services.map((s) => {
      const amount = stripe && s.deposit > 0 ? toMinorUnits(s.deposit, stripe.currency) : null
      return { id: s.id, label: s.label, duration: s.duration, description: s.description, deposit: amount ? formatAmount(amount, stripe!.currency) : null }
    }),
    timeZone: siteTimeZone(),
    location: settings.location,
    maxAdvanceDays: settings.maxAdvanceDays,
    cancelNoticeHours: settings.cancelNoticeHours,
    today: today(siteTimeZone()),
  }
}

export async function publicSlots(event: H3Event, serviceId: string, from: string, days: number) {
  const settings = await appointmentSettings(event)
  const service = settings.services.find(s => s.id === serviceId)
  if (!service) throw createError({ statusCode: 404, message: 'Cette prestation n\'est pas proposée.' })
  await releaseExpiredHolds(event)
  const timeZone = siteTimeZone()
  const first = /^\d{4}-\d{2}-\d{2}$/.test(from) && from >= today(timeZone) ? from : today(timeZone)
  const start = Date.parse(`${first}T00:00:00Z`) - DAY
  const busy = await busyBetween(event, start, start + (days + 2) * DAY)
  return { service: service.id, timeZone, days: slotsByDay(settings, service, first, days, timeZone, busy) }
}

// ───────────── E-mails ─────────────

async function siteTheme(event: H3Event) {
  const [row] = await useDb(event).select().from(schema.settings).where(eq(schema.settings.key, 'theme'))
  return (row?.value as CmsTheme | undefined) ?? null
}

/** Écrit au visiteur. Sans envoi d'e-mails réglé, ou en cas de refus, rien ne part : le rendez-vous, lui, reste. */
async function notifyVisitor(event: H3Event, row: Row, kind: Parameters<typeof appointmentEmail>[0], message?: string) {
  try {
    if (!(await mailStatus(event)).configured) return false
    const [settings, theme] = await Promise.all([appointmentSettings(event), siteTheme(event)])
    const mail = appointmentEmail(kind, viewOf(row), {
      siteName: cmsConfig.site.name, timeZone: siteTimeZone(), manageUrl: await linkTo(event, 'manage', row), icsUrl: await linkTo(event, 'ics', row),
      cancelNoticeHours: settings.cancelNoticeHours, color: theme?.primary, message,
    })
    await sendEmail(event, { to: [row.email], ...mail })
    return true
  }
  catch (error) {
    console.error('[cms] rendez-vous : l\'e-mail au visiteur n\'est pas parti', error)
    return false
  }
}

const CANCELLED_BY = { visitor: 'le visiteur', staff: 'le site', expired: 'personne (acompte jamais réglé)' }

function appointmentEvent(event: H3Event, name: keyof typeof EVENT_LABELS, row: Row) {
  const when = formatAppointment(row.start, siteTimeZone())
  return {
    name, module: 'appointments', target: row.service,
    summary: `${EVENT_LABELS[name]} : ${row.name}, ${when}`,
    context: {
      appointment: {
        service: row.serviceLabel, date: when, duration: formatDuration(durationOf(row)), name: row.name, email: row.email, phone: row.phone ?? '', note: row.note ?? '',
        location: row.location ?? '', deposit: paidText(row), cancelledBy: row.cancelledBy ? CANCELLED_BY[row.cancelledBy] : '',
        adminUrl: `${getRequestURL(event).origin}/admin/appointments?rdv=${row.id}`,
      },
      origin: { channel: CHANNELS[channelOfRow(row.origin)], campaign: row.origin?.campaign ?? '' },
    },
  }
}

/** Le rendez-vous est confirmé (réservé sans acompte, ou acompte reçu) : e-mail au visiteur et workflows. */
function announceConfirmed(event: H3Event, row: Row) {
  event.waitUntil(notifyVisitor(event, row, 'confirmed'))
  emitCmsEvents(event, [appointmentEvent(event, 'appointment.booked', row)])
}

// ───────────── Réservation ─────────────

/** Inscrit le rendez-vous et ses cases en une seule fois : si une case est déjà prise, rien n'est écrit. */
async function insertWithCells(event: H3Event, row: Row, buffer: number) {
  const db = useDb(event)
  const cells = appointmentCells(row.start.getTime(), row.end.getTime(), buffer).map(at => ({ at, appointmentId: row.id }))
  // Une requête D1 porte cent valeurs au plus : les cases partent par paquets, dans la même transaction.
  const chunks: (typeof cells)[] = []
  for (let i = 0; i < cells.length; i += 40) chunks.push(cells.slice(i, i + 40))
  try {
    await db.batch([db.insert(schema.appointments).values(row), ...chunks.map(chunk => db.insert(schema.appointmentSlots).values(chunk))] as [any, ...any[]])
    return true
  }
  catch (error) {
    if (/unique|constraint|primary key/i.test(String((error as Error)?.message ?? error) + String((error as { cause?: { message?: string } })?.cause?.message ?? ''))) return false
    throw error
  }
}

export type BookRequest = {
  service: string
  /** Instant du début (ISO). */
  start: unknown
  values: BookingInput
  locale: string
  origin: StoredOrigin | null
  /** Rendez-vous saisi dans le back-office : hors des délais imposés aux visiteurs, sans acompte. */
  staff?: Actor
}

/**
 * Prend un rendez-vous. Le créneau est revérifié ici avec les mêmes règles que l'affichage, puis réservé de façon
 * que deux demandes simultanées ne puissent pas l'obtenir toutes les deux. Avec un acompte, le rendez-vous reste
 * « en attente » et la réponse donne l'adresse de la page de paiement.
 */
export async function bookAppointment(event: H3Event, request: BookRequest): Promise<{ appointment: Row; payUrl: string | null; manageUrl: string }> {
  const settings = await appointmentSettings(event)
  const service = settings.services.find(s => s.id === request.service)
  if (!service) throw createError({ statusCode: 404, message: 'Cette prestation n\'est pas proposée.' })
  const start = typeof request.start === 'string' ? Date.parse(request.start) : Number.NaN
  if (!Number.isFinite(start) || start % (APPOINTMENTS.grid * MINUTE)) throw createError({ statusCode: 422, message: 'Créneau illisible.' })
  const end = start + service.duration * MINUTE
  const now = Date.now()
  await releaseExpiredHolds(event, now)
  const busy = await busyBetween(event, start - DAY, end + DAY)
  if (request.staff) {
    // Le professionnel place un rendez-vous où il veut, tant que le moment est libre et pas déjà passé depuis longtemps.
    if (start < now - DAY) throw createError({ statusCode: 422, message: 'Ce moment est passé depuis plus d\'un jour.' })
    const gap = settings.buffer * MINUTE
    if (busy.some(b => start < b.end + gap && end + gap > b.start)) throw createError({ statusCode: 409, message: 'Un autre rendez-vous occupe déjà ce moment.' })
  }
  else {
    const problem = slotProblem(settings, service, start, siteTimeZone(), busy, now)
    if (problem) throw createError({ statusCode: /vient d'être pris/.test(problem) ? 409 : 422, message: problem })
  }
  const deposit = request.staff ? null : await depositFor(event, service)
  const at = new Date(now)
  const row: Row = {
    id: crypto.randomUUID(), service: service.id, serviceLabel: service.label, start: new Date(start), end: new Date(end),
    status: deposit ? 'pending' : 'confirmed',
    name: request.values.name, email: request.values.email, phone: request.values.phone || null, note: request.values.note || null,
    locale: request.locale, location: settings.location || null, origin: request.origin,
    depositAmount: deposit?.amount ?? 0, currency: deposit?.currency ?? null, paidAt: null,
    createdBy: request.staff?.id ?? null, cancelledAt: null, cancelledBy: null, reminderSentAt: null, createdAt: at, updatedAt: at,
  }
  if (!(await insertWithCells(event, row, settings.buffer))) throw createError({ statusCode: 409, message: 'Ce créneau vient d\'être pris. Choisissez-en un autre.' })

  const manageUrl = await linkTo(event, 'manage', row)
  if (!deposit) {
    announceConfirmed(event, row)
    if (request.staff) logActivity(event, { action: 'appointments.created', category: 'settings', actor: request.staff, target: { kind: 'appointments', id: row.id }, phrase: `a saisi un rendez-vous : ${row.serviceLabel}, ${formatAppointment(row.start, siteTimeZone())}` })
    return { appointment: row, payUrl: null, manageUrl }
  }
  try {
    return { appointment: row, payUrl: await depositCheckout(event, row, deposit.key), manageUrl }
  }
  catch (error) {
    // Sans page de paiement, le créneau n'est pas gardé pour rien.
    await useDb(event).delete(schema.appointments).where(eq(schema.appointments.id, row.id))
    console.error('[cms] rendez-vous : la page de paiement de l\'acompte n\'a pas pu être créée :', (error as Error).message)
    throw createError({ statusCode: 502, message: 'Le paiement de l\'acompte n\'a pas pu être préparé. Réessayez dans un instant.' })
  }
}

/**
 * Page de paiement de l'acompte (Stripe Checkout). Le paiement est rangé dans « Paiements » comme les autres, sous
 * le nom réservé `appointments` ; c'est l'événement signé de Stripe qui confirme le rendez-vous (`appointmentPaid`).
 */
export async function depositCheckout(event: H3Event, row: Row, key: string) {
  const title = `${row.locale.startsWith('fr') ? 'Acompte' : 'Deposit'} — ${row.serviceLabel}, ${formatAppointment(row.start, siteTimeZone(), row.locale)}`
  const metadata: CheckoutMetadata = {
    cms_collection: APPOINTMENTS.paymentCollection, cms_entry: row.id, cms_title: title.slice(0, 450), cms_quantity: '1', cms_unit_amount: String(row.depositAmount), cms_locale: row.locale,
    ...originToMetadata(row.origin),
  }
  const manage = await linkTo(event, 'manage', row)
  const params = checkoutParams({
    currency: row.currency ?? 'eur', unitAmount: row.depositAmount, quantity: 1, name: title, image: null,
    successUrl: `${manage}&paid=1`, cancelUrl: manage, locale: row.locale, metadata, shippingCountries: null,
  })
  // L'adresse de l'acheteur est connue : Stripe la préremplit. La page vit le temps pendant lequel le créneau est gardé.
  params.push(['customer_email', row.email], ['expires_at', String(Math.floor(row.createdAt.getTime() / 1000) + (APPOINTMENTS.holdMinutes + 1) * 60)])
  const session = await stripeRequest<{ id: string; url: string }>(event, key, '/v1/checkout/sessions', { method: 'POST', body: encodeForm(params) })
  if (!session.url) throw new Error('Stripe n\'a pas renvoyé d\'adresse de paiement.')
  return session.url
}

/** Le visiteur relance le paiement de son acompte depuis la page de son rendez-vous. */
export async function payAgain(event: H3Event, row: Row) {
  const stripe = await depositProvider(event)
  if (row.status !== 'pending' || !stripe) throw createError({ statusCode: 409, message: 'Ce rendez-vous n\'attend plus d\'acompte.' })
  // Le créneau n'est gardé qu'une demi-heure après la réservation : la page de paiement ne peut pas vivre plus longtemps.
  if (Date.now() - row.createdAt.getTime() > (APPOINTMENTS.holdMinutes - 1) * MINUTE) throw createError({ statusCode: 409, message: 'Le délai pour régler l\'acompte est passé : reprenez un rendez-vous sur le site.' })
  return depositCheckout(event, { ...row, createdAt: new Date() }, stripe.key)
}

/**
 * Acompte reçu (événement signé de Stripe, voir `applyStripeEvent`). Le rendez-vous en attente est confirmé. S'il
 * avait été rendu entre-temps (paiement à la dernière seconde), son créneau est repris s'il est encore libre ;
 * sinon il reste annulé, marqué payé : le back-office dit qu'il y a un acompte à rembourser.
 */
export async function appointmentPaid(event: H3Event, id: string) {
  const db = useDb(event)
  const { appointments: t } = schema
  const now = new Date()
  const [confirmed] = await db.update(t).set({ status: 'confirmed', paidAt: now, updatedAt: now }).where(and(eq(t.id, id), eq(t.status, 'pending'))).returning()
  if (confirmed) { announceConfirmed(event, confirmed); return 'confirmé' }
  const [row] = await db.select().from(t).where(eq(t.id, id))
  if (!row) return 'rendez-vous inconnu'
  if (row.paidAt) return 'déjà enregistré'
  if (row.status === 'cancelled' && row.cancelledBy === 'expired' && row.start.getTime() > now.getTime()) {
    const settings = await appointmentSettings(event)
    const cells = appointmentCells(row.start.getTime(), row.end.getTime(), settings.buffer).map(at => ({ at, appointmentId: row.id }))
    const retaken = await db.batch([
      db.update(t).set({ status: 'confirmed', paidAt: now, cancelledAt: null, cancelledBy: null, updatedAt: now }).where(eq(t.id, id)),
      ...Array.from({ length: Math.ceil(cells.length / 40) }, (_, i) => db.insert(schema.appointmentSlots).values(cells.slice(i * 40, i * 40 + 40))),
    ] as unknown as [any, ...any[]]).then(() => true, () => false)
    if (retaken) { announceConfirmed(event, { ...row, status: 'confirmed', paidAt: now, cancelledAt: null, cancelledBy: null }); return 'confirmé (créneau repris)' }
  }
  await db.update(t).set({ paidAt: now, updatedAt: now }).where(eq(t.id, id))
  return 'acompte reçu pour un rendez-vous annulé : à rembourser'
}

// ───────────── Annulation ─────────────

/** Annule un rendez-vous en cours, rend son créneau, prévient le visiteur et les workflows. Sans effet s'il est déjà annulé. */
export async function cancelAppointment(event: H3Event, row: Row, by: 'visitor' | 'staff', options: { message?: string; actor?: Actor } = {}) {
  const db = useDb(event)
  const { appointments: t } = schema
  const now = new Date()
  const [cancelled] = await db.update(t).set({ status: 'cancelled', cancelledAt: now, cancelledBy: by, updatedAt: now })
    .where(and(eq(t.id, row.id), inArray(t.status, ['pending', 'confirmed']))).returning()
  if (!cancelled) return null
  await db.delete(schema.appointmentSlots).where(eq(schema.appointmentSlots.appointmentId, row.id))
  // Un rendez-vous jamais confirmé (acompte en attente) n'a été annoncé à personne.
  if (row.status === 'confirmed') {
    event.waitUntil(notifyVisitor(event, cancelled, by === 'staff' ? 'cancelled-by-staff' : 'cancelled-by-visitor', options.message))
    emitCmsEvents(event, [appointmentEvent(event, 'appointment.cancelled', cancelled)])
  }
  if (options.actor) logActivity(event, { action: 'appointments.cancelled', category: 'settings', actor: options.actor, target: { kind: 'appointments', id: row.id }, phrase: `a annulé un rendez-vous : ${row.serviceLabel}, ${formatAppointment(row.start, siteTimeZone())}` })
  return cancelled
}

/** Efface un rendez-vous (demande d'effacement de ses données, ou ménage). S'il était en cours, son créneau est rendu, sans e-mail. */
export async function eraseAppointment(event: H3Event, row: Row, actor: Actor) {
  await useDb(event).delete(schema.appointments).where(eq(schema.appointments.id, row.id))
  logActivity(event, { action: 'appointments.erased', category: 'settings', actor, target: { kind: 'appointments', id: row.id }, phrase: `a effacé un rendez-vous (${row.serviceLabel}, ${formatAppointment(row.start, siteTimeZone())})` })
}

// ───────────── Pages et fichiers du visiteur ─────────────

/** La page du rendez-vous d'un visiteur, d'après son état. `justPaid` : il revient de la page de paiement. */
export async function sendAppointmentPage(event: H3Event, row: Row | null, options: { justPaid?: boolean } = {}) {
  const { site } = cmsConfig
  const locale = row?.locale ?? site.defaultLocale
  const prefix = locale === site.defaultLocale || !site.locales.includes(locale) ? '' : `/${locale}`
  setResponseHeaders(event, { 'cache-control': NO_CACHE, 'x-robots-tag': 'noindex', 'content-type': 'text/html; charset=utf-8' })
  const render = (page: AppointmentPage) => appointmentPageHtml(page, { siteName: site.name, locale, timeZone: siteTimeZone(), theme: null, home: prefix || '/' })
  if (!row) { setResponseStatus(event, 410); return render({ kind: 'invalid' }) }
  const [settings, theme] = await Promise.all([appointmentSettings(event), siteTheme(event)])
  const html = (page: AppointmentPage) => appointmentPageHtml(page, { siteName: site.name, locale, timeZone: siteTimeZone(), theme, home: prefix || '/' })
  const common = { appointment: viewOf(row), cancelNoticeHours: settings.cancelNoticeHours }
  const action = `/api/appointments/manage?id=${row.id}&t=${await signLink(event, SCOPE, row.id)}`
  if (row.status === 'cancelled') return html({ kind: 'cancelled', ...common })
  if (row.end.getTime() < Date.now()) return html({ kind: 'past', ...common })
  if (row.status === 'pending') {
    const page = html({ kind: 'pending', ...common, payAction: options.justPaid ? undefined : `${action}&do=pay`, deposit: formatAmount(row.depositAmount, row.currency ?? 'eur'), cancelAction: options.justPaid ? undefined : action })
    // Retour de la page de paiement : la confirmation de Stripe arrive en quelques secondes, la page se relit toute seule.
    return options.justPaid ? page.replace('<meta name="robots"', '<meta http-equiv="refresh" content="3">\n<meta name="robots"') : page
  }
  return html({ kind: 'manage', ...common, icsUrl: await linkTo(event, 'ics', row), cancelAction: canVisitorCancel(settings, row.start.getTime()) ? action : undefined })
}

const icsEvent = (row: Row, origin: string, detailed: boolean) => ({
  uid: row.id, start: row.start, end: row.end, updatedAt: row.updatedAt, cancelled: row.status === 'cancelled',
  summary: detailed ? `${row.serviceLabel} — ${row.name}${row.status === 'pending' ? ' (acompte en attente)' : ''}` : `${row.serviceLabel} — ${cmsConfig.site.name}`,
  description: detailed ? [row.email, row.phone, row.note].filter(Boolean).join('\n') : undefined,
  location: row.location ?? undefined,
  url: detailed ? `${origin}/admin/appointments?rdv=${row.id}` : undefined,
})

/** Le fichier d'agenda d'un rendez-vous, pour le visiteur. */
export function appointmentIcs(event: H3Event, row: Row) {
  const url = getRequestURL(event)
  return buildIcs([icsEvent(row, url.origin, false)], { name: cmsConfig.site.name, host: url.host })
}

/** Tous les rendez-vous en cours (et ceux du mois écoulé), pour l'agenda du professionnel. */
export async function appointmentsFeed(event: H3Event) {
  const { appointments: t } = schema
  const url = getRequestURL(event)
  const rows = await useDb(event).select().from(t).where(and(inArray(t.status, ['pending', 'confirmed']), gte(t.start, new Date(Date.now() - 30 * DAY)))).orderBy(asc(t.start)).limit(2000)
  return buildIcs(rows.map(row => icsEvent(row, url.origin, true)), { name: `Rendez-vous — ${cmsConfig.site.name}`, host: url.host })
}

// ───────────── Tâche planifiée : rappels et ménage ─────────────

/** Rappels à envoyer, créneaux abandonnés à rendre, vieux rendez-vous à effacer. Appelé toutes les cinq minutes. */
export async function runAppointmentTasks(event: H3Event, now = Date.now()) {
  if (!(await activeModule(event, 'appointments'))) return null
  const db = useDb(event)
  const { appointments: t } = schema
  const released = await releaseExpiredHolds(event, now)
  const settings = await appointmentSettings(event)
  let reminded = 0
  if (settings.reminderHours > 0) {
    const due = await db.select().from(t)
      .where(and(eq(t.status, 'confirmed'), isNull(t.reminderSentAt), gt(t.start, new Date(now)), lte(t.start, new Date(now + settings.reminderHours * HOUR)))).orderBy(asc(t.start)).limit(20)
    for (const row of due) {
      // Réservé à l'intérieur du délai de rappel : la confirmation vient de partir, un rappel n'apporterait rien.
      const wanted = row.start.getTime() - row.createdAt.getTime() > settings.reminderHours * HOUR
      const [mine] = await db.update(t).set({ reminderSentAt: new Date(now) }).where(and(eq(t.id, row.id), isNull(t.reminderSentAt))).returning({ id: t.id })
      if (mine && wanted && await notifyVisitor(event, row, 'reminder')) reminded++
    }
  }
  const erased = await db.delete(t).where(lt(t.end, new Date(now - RETENTION_DAYS * DAY))).returning({ id: t.id })
  return { released, reminded, erased: erased.length }
}

// ───────────── Back-office ─────────────

/** Les rendez-vous contiennent des noms et des coordonnées : seuls l'administrateur et l'éditeur les lisent. */
export async function requireAppointmentsAccess(event: H3Event) {
  await requireModule(event, 'appointments')
  const user = await requireUser(event)
  if (user.role !== 'admin' && user.role !== 'editor') throw createError({ statusCode: 403, message: 'Les rendez-vous sont réservés aux administrateurs et aux éditeurs.' })
  return user
}

export async function findAppointment(event: H3Event, id: string) {
  const [row] = await useDb(event).select().from(schema.appointments).where(eq(schema.appointments.id, id))
  if (!row) throw createError({ statusCode: 404, message: 'Rendez-vous introuvable.' })
  return row
}

const adminRow = (row: Row) => ({
  ...row, duration: durationOf(row), paid: paidText(row), channel: CHANNELS[channelOfRow(row.origin)],
  /** Acompte reçu pour un rendez-vous qui n'a pas lieu : il reste à rembourser dans Stripe. */
  refundDue: row.status === 'cancelled' && !!row.paidAt,
})

/** Rendez-vous en cours à venir : pour le tableau de bord et le menu. */
export async function upcomingAppointments(event: H3Event, until?: number) {
  const { appointments: t } = schema
  const [row] = await useDb(event).select({ n: count() }).from(t)
    .where(and(eq(t.status, 'confirmed'), gt(t.end, new Date()), ...(until ? [lt(t.start, new Date(until))] : [])))
  return row?.n ?? 0
}

/** Ce que l'écran « Rendez-vous » affiche. */
export async function describeAppointments(event: H3Event) {
  const db = useDb(event)
  const { appointments: t } = schema
  await releaseExpiredHolds(event)
  const now = new Date()
  const [upcoming, past, settings, mail, stripe, feedUrl] = await Promise.all([
    db.select().from(t).where(and(inArray(t.status, ['pending', 'confirmed']), gt(t.end, now))).orderBy(asc(t.start)).limit(APPOINTMENTS.listMax),
    // Passés ou annulés, du plus récent au plus ancien.
    db.select().from(t).where(and(lte(t.end, now))).orderBy(desc(t.start)).limit(APPOINTMENTS.listMax),
    appointmentSettings(event),
    mailStatus(event),
    depositProvider(event),
    appointmentsFeedUrl(event),
  ])
  const cancelled = await db.select().from(t).where(and(eq(t.status, 'cancelled'), gt(t.end, now))).orderBy(desc(t.cancelledAt)).limit(100)
  return {
    upcoming: upcoming.map(adminRow),
    past: [...cancelled, ...past].map(adminRow),
    settings,
    timeZone: siteTimeZone(),
    today: today(siteTimeZone()),
    /** Sans envoi d'e-mails réglé, ni confirmation ni rappel ne partent. */
    mail,
    /** Stripe est prêt à encaisser un acompte ; sinon les acomptes réglés sont ignorés. */
    deposit: { available: !!stripe, currency: stripe?.currency ?? null },
    feedUrl,
    max: APPOINTMENTS.listMax,
  }
}

/** Tous les rendez-vous, par paquets, pour l'export. */
export async function allAppointments(event: H3Event) {
  const { appointments: t } = schema
  const out: ReturnType<typeof adminRow>[] = []
  for (let offset = 0; ; offset += 1000) {
    const chunk = await useDb(event).select().from(t).orderBy(desc(t.start), t.id).limit(1000).offset(offset)
    out.push(...chunk.map(adminRow))
    if (chunk.length < 1000) break
  }
  return out
}

/** Créneaux libres vus par le professionnel pour saisir un rendez-vous : mêmes horaires, sans les délais des visiteurs. */
export async function staffSlots(event: H3Event, serviceId: string, date: string) {
  const settings = await appointmentSettings(event)
  const service = settings.services.find(s => s.id === serviceId)
  if (!service || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw createError({ statusCode: 422, message: 'Prestation ou date illisible.' })
  await releaseExpiredHolds(event)
  const start = Date.parse(`${date}T00:00:00Z`) - DAY
  const busy = await busyBetween(event, start, start + 3 * DAY)
  return slotsByDay({ ...settings, minNoticeHours: 0, maxAdvanceDays: 730, closed: [] }, service, date, 1, siteTimeZone(), busy)[0]!.slots
}

export { addDays }
