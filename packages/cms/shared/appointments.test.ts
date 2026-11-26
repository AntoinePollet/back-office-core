import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_APPOINTMENT_SETTINGS, type AppointmentSettings, appointmentCells, appointmentEmail, appointmentPageHtml, appointmentsCsv, buildIcs, canVisitorCancel,
  cleanAppointmentSettings, cleanBooking, daySlots, formatAppointment, formatDuration, minutesOf, readAppointmentSettings, slotProblem, slotsByDay, timeOf,
} from './appointments.ts'

const PARIS = 'Europe/Paris'
const base = (): AppointmentSettings => structuredClone(DEFAULT_APPOINTMENT_SETTINGS)
const at = (iso: string) => Date.parse(iso)
/** Lundi 30 novembre 2026, 8 h à Paris (7 h UTC) : l'instant « maintenant » des tests. */
const NOW = at('2026-11-30T07:00:00Z')
const times = (slots: number[]) => slots.map(s => new Date(s).toISOString().slice(11, 16))

test('heures : « 09:30 » en minutes et retour', () => {
  assert.equal(minutesOf('09:30'), 570)
  assert.equal(minutesOf('24:00'), 1440)
  assert.ok(Number.isNaN(minutesOf('9h30')) && Number.isNaN(minutesOf('25:00')))
  assert.equal(timeOf(570), '09:30')
})

test('réglages : mis en forme, identifiants gardés ou déduits, plages triées', () => {
  const r = cleanAppointmentSettings({
    ...base(),
    services: [{ label: ' Première consultation ', duration: 45, deposit: 30 }, { id: 'suivi', label: 'Suivi', duration: 30 }, { label: 'Suivi', duration: 15 }],
    hours: { ...base().hours, sat: [['14:00', '16:00'], ['09:00', '12:00']] },
    closed: [{ from: '2026-12-24', to: '2026-12-26', label: 'Noël' }, { from: '2026-05-01' }],
  })
  assert.ok('settings' in r)
  assert.deepEqual(r.settings.services.map(s => [s.id, s.label, s.duration, s.deposit]), [['premiere-consultation', 'Première consultation', 45, 30], ['suivi', 'Suivi', 30, 0], ['suivi-2', 'Suivi', 15, 0]])
  assert.deepEqual(r.settings.hours.sat, [['09:00', '12:00'], ['14:00', '16:00']])
  assert.deepEqual(r.settings.closed, [{ from: '2026-05-01', to: '2026-05-01', label: '' }, { from: '2026-12-24', to: '2026-12-26', label: 'Noël' }])
})

test('réglages refusés : chaque problème a sa phrase, rien n\'est corrigé en silence', () => {
  const errors = (patch: Record<string, unknown>) => { const r = cleanAppointmentSettings({ ...base(), ...patch }); return 'errors' in r ? r.errors.join(' | ') : '' }
  assert.match(errors({ services: [] }), /au moins une prestation/)
  assert.match(errors({ services: [{ label: 'Bilan', duration: 32 }] }), /multiple de 5/)
  assert.match(errors({ services: [{ label: '', duration: 30 }] }), /a un nom/)
  assert.match(errors({ services: [{ label: 'Bilan', duration: 30, deposit: 10.999 }] }), /acompte/)
  assert.match(errors({ hours: { ...base().hours, mon: [['9h', '12:00']] } }), /« 09:00 »/)
  assert.match(errors({ hours: { ...base().hours, mon: [['09:02', '12:00']] } }), /multiple de 5 minutes/)
  assert.match(errors({ hours: { ...base().hours, mon: [['12:00', '09:00']] } }), /se termine avant de commencer/)
  assert.match(errors({ hours: { ...base().hours, mon: [['09:00', '12:00'], ['11:00', '14:00']] } }), /se chevauchent/)
  assert.match(errors({ hours: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] } }), /Aucun jour n'est ouvert/)
  assert.match(errors({ step: 7 }), /Écart entre deux créneaux/)
  assert.match(errors({ closed: [{ from: '2026-02-30', to: '2026-03-01' }] }), /date de début/)
  assert.match(errors({ closed: [{ from: '2026-03-02', to: '2026-03-01' }] }), /se termine avant/)
  // Rien d'enregistré, ou des réglages devenus illisibles : ceux par défaut.
  assert.deepEqual(readAppointmentSettings(null), base())
  assert.deepEqual(readAppointmentSettings({ services: 'non' }), base())
})

test('créneaux d\'un jour : plages d\'ouverture, durée, délai minimal, rendez-vous pris et battement', () => {
  const settings = base()
  const [service] = settings.services
  // Mardi 1er décembre, heure d'hiver (UTC+1) : 9 h à Paris = 8 h UTC. Matin 9–12, après-midi 14–18, toutes les 30 min.
  const all = daySlots(settings, service!, '2026-12-01', PARIS, [], NOW)
  assert.deepEqual(times(all).slice(0, 3), ['08:00', '08:30', '09:00'])
  assert.equal(all.length, 6 + 8)
  assert.equal(times(all).at(-1), '16:30')
  // Une prestation d'une heure ne commence pas à 11 h 30 ni à 17 h 30.
  assert.equal(daySlots(settings, { ...service!, duration: 60 }, '2026-12-01', PARIS, [], NOW).length, 5 + 7)
  // Le lundi même, à 8 h : rien avant 20 h (12 h de délai), donc rien du tout.
  assert.deepEqual(daySlots(settings, service!, '2026-11-30', PARIS, [], NOW), [])
  assert.equal(daySlots({ ...settings, minNoticeHours: 2 }, service!, '2026-11-30', PARIS, [], NOW).length, 4 + 8)
  // Rendez-vous pris de 9 h 30 à 10 h : ce créneau disparaît ; avec 15 min de battement, celui de 10 h aussi (et 9 h, qui finirait trop près).
  const busy = [{ start: at('2026-12-01T08:30:00Z'), end: at('2026-12-01T09:00:00Z') }]
  assert.deepEqual(times(daySlots(settings, service!, '2026-12-01', PARIS, busy, NOW)).slice(0, 3), ['08:00', '09:00', '09:30'])
  assert.deepEqual(times(daySlots({ ...settings, buffer: 15 }, service!, '2026-12-01', PARIS, busy, NOW)).slice(0, 2), ['09:30', '10:00'])
  // Samedi fermé, jour de fermeture, date qui n'existe pas, au-delà de la période ouverte.
  assert.deepEqual(daySlots(settings, service!, '2026-12-05', PARIS, [], NOW), [])
  assert.deepEqual(daySlots({ ...settings, closed: [{ from: '2026-12-01', to: '2026-12-02', label: '' }] }, service!, '2026-12-02', PARIS, [], NOW), [])
  assert.deepEqual(daySlots(settings, service!, '2026-02-30', PARIS, [], NOW), [])
  assert.deepEqual(daySlots({ ...settings, maxAdvanceDays: 7 }, service!, '2026-12-08', PARIS, [], NOW), [])
})

test('créneaux : l\'heure est celle du site, été comme hiver ; l\'heure qui n\'existe pas n\'est pas proposée', () => {
  const settings = { ...base(), minNoticeHours: 0, maxAdvanceDays: 365 }
  const [service] = settings.services
  // En juillet (UTC+2), 9 h à Paris = 7 h UTC.
  assert.equal(times(daySlots(settings, service!, '2027-07-06', PARIS, [], NOW))[0], '07:00')
  // Nuit du 28 mars 2027 : 2 h 30 n'existe pas à Paris.
  const night = { ...settings, hours: { ...settings.hours, sun: [['01:00', '04:00']] as [string, string][] } }
  assert.deepEqual(slotsByDay(night, service!, '2027-03-28', 1, PARIS, [], NOW)[0]!.slots.map(s => s.time), ['01:00', '01:30', '03:00', '03:30'])
  const days = slotsByDay(settings, service!, '2026-12-04', 3, PARIS, [], NOW)
  assert.deepEqual(days.map(d => [d.date, d.slots.length]), [['2026-12-04', 14], ['2026-12-05', 0], ['2026-12-06', 0]])
  assert.deepEqual(days[0]!.slots[0], { at: '2026-12-04T08:00:00.000Z', time: '09:00' })
})

test('créneau demandé : accepté s\'il aurait été proposé, sinon la raison', () => {
  const settings = base()
  const [service] = settings.services
  const nine = at('2026-12-01T08:00:00Z')
  assert.equal(slotProblem(settings, service!, nine, PARIS, [], NOW), null)
  assert.match(slotProblem(settings, service!, nine, PARIS, [{ start: nine, end: nine + 1_800_000 }], NOW)!, /vient d'être pris/)
  assert.match(slotProblem(settings, service!, at('2026-12-01T08:10:00Z'), PARIS, [], NOW)!, /n'est pas proposé/)
  assert.match(slotProblem(settings, service!, at('2026-11-30T09:00:00Z'), PARIS, [], NOW)!, /au moins 12 h/)
  assert.match(slotProblem({ ...settings, minNoticeHours: 0 }, service!, NOW - 1000, PARIS, [], NOW)!, /passé/)
  assert.match(slotProblem(settings, service!, at('2027-06-01T08:00:00Z'), PARIS, [], NOW)!, /60 jours/)
  assert.match(slotProblem({ ...settings, closed: [{ from: '2026-12-01', to: '2026-12-01', label: '' }] }, service!, nine, PARIS, [], NOW)!, /fermé/)
  assert.match(slotProblem(settings, service!, Number.NaN, PARIS, [], NOW)!, /illisible/)
})

test('cases de cinq minutes : celles du rendez-vous et de son battement ; annulation par le visiteur', () => {
  const start = at('2026-12-01T08:00:00Z')
  assert.equal(appointmentCells(start, start + 30 * 60_000, 0).length, 6)
  assert.equal(appointmentCells(start, start + 30 * 60_000, 15).length, 9)
  assert.equal(appointmentCells(start, start + 30 * 60_000, 0)[0], start)
  // Deux rendez-vous qui se suivent sans battement n'ont aucune case commune.
  const next = appointmentCells(start + 30 * 60_000, start + 60 * 60_000, 0)
  assert.equal(appointmentCells(start, start + 30 * 60_000, 0).filter(c => next.includes(c)).length, 0)
  assert.equal(canVisitorCancel(base(), start, NOW), true)
  assert.equal(canVisitorCancel(base(), NOW + 23 * 3_600_000, NOW), false)
  assert.equal(canVisitorCancel({ ...base(), cancelNoticeHours: 0 }, NOW - 1, NOW), false)
})

test('saisie du visiteur : nettoyée, erreurs par champ', () => {
  const good = cleanBooking({ name: ' Jeanne Martin ', email: 'Jeanne@Example.com', phone: '06 12 34 56 78', note: ' Première visite ' })
  assert.deepEqual(good, { values: { name: 'Jeanne Martin', email: 'jeanne@example.com', phone: '06 12 34 56 78', note: 'Première visite' }, errors: {} })
  assert.deepEqual(Object.keys(cleanBooking({ name: '', email: 'x', phone: 'abc', note: 'x'.repeat(1001) }).errors).sort(), ['email', 'name', 'note', 'phone'])
  assert.deepEqual(cleanBooking(null).errors, { name: 'Indiquez votre nom.', email: 'Adresse e-mail invalide.' })
})

test('dates lisibles, en français et en anglais, à l\'heure du site', () => {
  assert.equal(formatAppointment('2026-12-01T08:30:00Z', PARIS), 'mardi 1er décembre 2026 à 9 h 30')
  assert.equal(formatAppointment('2026-12-03T13:00:00Z', PARIS), 'jeudi 3 décembre 2026 à 14 h')
  assert.equal(formatAppointment('2026-12-03T13:00:00Z', PARIS, 'en'), 'Thursday, December 3, 2026 at 2:00 PM')
  assert.deepEqual([formatDuration(30), formatDuration(90), formatDuration(60), formatDuration(90, 'en')], ['30 min', '1 h 30', '1 h', '1 h 30 min'])
})

test('fichier d\'agenda : instants en UTC, texte échappé, lignes pliées, annulation', () => {
  const ics = buildIcs([{
    uid: 'abc', start: at('2026-12-01T08:00:00Z'), end: at('2026-12-01T08:30:00Z'), summary: 'Rendez-vous ; Cabinet, Durand',
    description: `Ligne 1\nLigne 2 ${'très longue '.repeat(12)}`, location: '12 rue des Lilas, Lyon', url: 'https://site.fr/x',
  }], { name: 'Cabinet Durand', host: 'site.fr', stamp: at('2026-11-30T07:00:00Z') })
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n') && ics.endsWith('END:VCALENDAR\r\n'))
  for (const line of ['UID:abc@site.fr', 'DTSTAMP:20261130T070000Z', 'DTSTART:20261201T080000Z', 'DTEND:20261201T083000Z', 'SUMMARY:Rendez-vous \\; Cabinet\\, Durand', 'LOCATION:12 rue des Lilas\\, Lyon', 'STATUS:CONFIRMED', 'SEQUENCE:0'])
    assert.ok(ics.includes(`\r\n${line}\r\n`), line)
  assert.ok(ics.includes('DESCRIPTION:Ligne 1\\nLigne 2'))
  assert.ok(ics.split('\r\n').every(line => new TextEncoder().encode(line).length <= 75), 'ligne de plus de 75 octets')
  assert.ok(ics.split('\r\n').some(line => line.startsWith(' ')), 'aucune ligne pliée')
  const cancelled = buildIcs([{ uid: 'abc', start: 0, end: 1, summary: 'x', cancelled: true }], { name: 'n', host: 'h' })
  assert.ok(cancelled.includes('STATUS:CANCELLED') && cancelled.includes('SEQUENCE:1'))
})

test('e-mails : confirmation, rappel, annulation ; texte échappé, lien en clair', () => {
  const a = { name: 'Jeanne <Martin>', serviceLabel: 'Bilan & conseil', start: at('2026-12-01T08:30:00Z'), duration: 45, location: '12 rue des Lilas', locale: 'fr', paid: '30,00 €' }
  const input = { siteName: 'Cabinet Durand', timeZone: PARIS, manageUrl: 'https://site.fr/api/appointments/manage?id=1&t=abc', icsUrl: 'https://site.fr/api/appointments/ics?id=1&t=abc', cancelNoticeHours: 24, color: '#112233' }
  const mail = appointmentEmail('confirmed', a, input)
  assert.equal(mail.subject, 'Votre rendez-vous est confirmé — Cabinet Durand')
  assert.ok(mail.html.includes('Jeanne &lt;Martin&gt;') && !mail.html.includes('<Martin>') && mail.html.includes('Bilan &amp; conseil'))
  assert.ok(mail.html.includes('mardi 1er décembre 2026 à 9 h 30') && mail.html.includes('45 min') && mail.html.includes('12 rue des Lilas'))
  assert.ok(mail.html.includes('Acompte reçu : 30,00 €') && mail.html.includes('jusqu&#39;à 24 h avant') && mail.html.includes('background:#112233;color:#ffffff'))
  assert.equal(mail.html.split('https://site.fr/api/appointments/manage?id=1&amp;t=abc').length, 3)
  assert.ok(appointmentEmail('reminder', a, input).subject.startsWith('Rappel de votre rendez-vous'))
  const staff = appointmentEmail('cancelled-by-staff', a, { ...input, message: 'Empêchement de dernière minute.' })
  assert.ok(staff.html.includes('a dû annuler votre rendez-vous') && staff.html.includes('Empêchement de dernière minute.') && staff.html.includes('line-through') && !staff.html.includes('manage?id'))
  assert.ok(appointmentEmail('cancelled-by-visitor', { ...a, locale: 'en' }, input).html.includes('Your appointment has been cancelled.'))
})

test('page du visiteur : autonome, jamais indexée, annuler et payer par un bouton', () => {
  const appointment = { name: 'Jeanne', serviceLabel: 'Bilan <complet>', start: at('2026-12-01T08:30:00Z'), duration: 30, location: '', locale: 'fr' }
  const input = { siteName: 'Cabinet Durand', locale: 'fr', timeZone: PARIS, theme: { primary: '#aa0000' }, home: '/' }
  const manage = appointmentPageHtml({ kind: 'manage', appointment, cancelAction: '/api/appointments/manage?id=1&t="x', icsUrl: '/api/appointments/ics?id=1', cancelNoticeHours: 24 }, input)
  assert.ok(manage.includes('data-cms-appointment="manage"') && manage.includes('name="robots" content="noindex"') && manage.includes('#aa0000'))
  assert.ok(manage.includes('<form method="post" action="/api/appointments/manage?id=1&amp;t=&quot;x"') && manage.includes('Annuler ce rendez-vous') && manage.includes('Bilan &lt;complet&gt;'))
  const late = appointmentPageHtml({ kind: 'manage', appointment, cancelNoticeHours: 24 }, input)
  assert.ok(!late.includes('<form') && late.includes('trop tard pour l&#39;annuler en ligne'))
  const pending = appointmentPageHtml({ kind: 'pending', appointment, payAction: '/payer', deposit: '30,00 €', cancelAction: '/annuler', cancelNoticeHours: 24 }, input)
  assert.ok(pending.includes('Régler l&#39;acompte de 30,00 €') && pending.includes('action="/payer"') && pending.includes('gardé une demi-heure'))
  assert.ok(appointmentPageHtml({ kind: 'cancelled', appointment, cancelNoticeHours: 24 }, input).includes('line-through'))
  assert.ok(appointmentPageHtml({ kind: 'invalid' }, { ...input, locale: 'en', home: '/en' }).includes('This link is no longer valid'))
})

test('export : une ligne par rendez-vous, formules neutralisées', () => {
  const csv = appointmentsCsv([{ serviceLabel: 'Bilan', start: at('2026-12-01T08:30:00Z'), duration: 30, status: 'confirmed', name: '=CMD()', email: 'a@b.fr', phone: '0612345678', note: 'Bonjour ; merci', createdAt: at('2026-11-30T07:00:00Z'), channel: 'Google Ads' }])
  const [head, line] = csv.replace('﻿', '').split('\r\n')
  assert.ok(head!.startsWith('"Date";"Prestation";"Durée (min)";"État";"Nom";"E-mail"'))
  assert.ok(line!.startsWith('"01/12/2026 09:30";"Bilan";"30";"Confirmé";') && line!.includes('"\'=CMD()"') && line!.includes('"Bonjour ; merci"') && line!.endsWith('"Google Ads"'))
})
