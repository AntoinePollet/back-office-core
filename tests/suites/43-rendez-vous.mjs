// Module « Prise de rendez-vous » : réglages, créneaux, réservation (y compris simultanée), e-mails, page du visiteur
// (annulation, fichier d'agenda), back-office (saisie, annulation, export, droits), rappels, acompte par Stripe.
import { execFileSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { config } from '../lib/config.mjs'
import { check, clickText, login, menuLabels, says, until } from '../lib/harness.mjs'

/** Fichier de la base locale du serveur de test, pour avancer le temps (sqlite3). */
function databaseFile() {
  if (config.target === 'node') return path.join(config.tmpDir, 'etat', 'cms.sqlite')
  const dir = path.join(config.tmpDir, 'etat', 'v3', 'd1', 'miniflare-D1DatabaseObject')
  return path.join(dir, fs.readdirSync(dir).find(f => f.endsWith('.sqlite') && f !== 'metadata.sqlite'))
}
const sql = query => execFileSync('sqlite3', [databaseFile(), query]).toString().trim()

export const meta = {
  title: 'prise de rendez-vous : créneaux, réservation, annulation, rappels, acompte',
  mock: true,
  env: ({ mock }) => ({ NUXT_BREVO_API_URL: `${mock}/v3`, NUXT_STRIPE_API_URL: `${mock}/stripe` }),
}

const BREVO = 'xkeysib-cle-de-test-12345'
const STRIPE = 'rk_test_cle-limitee-du-site-4242'
const WHSEC = 'whsec_secret-du-webhook-de-test'
const PARIS = 'Europe/Paris'
const DAY = 86_400_000

/** Jour du site (AAAA-MM-JJ) dans `days` jours. */
const parisDay = days => new Intl.DateTimeFormat('en-CA', { timeZone: PARIS }).format(Date.now() + days * DAY)
const OPEN = [['09:00', '12:00'], ['14:00', '18:00']]

export default async function (t) {
  const { B, M, step, calls } = t
  const page = await t.newPage()
  const claire = t.http(), marc = t.http(), lina = t.http(), visitor = t.http(), stripe = t.http()
  const mails = () => calls().filter(c => c.url === '/v3/smtp/email')
  const sessions = () => calls().filter(c => c.url === '/stripe/v1/checkout/sessions')
  const board = (client = claire) => client.json('/api/cms/appointments')
  const slots = async (service, from, days = 1) => (await visitor.json(`/api/appointments/slots?service=${service}&from=${from}&days=${days}`)).days
  let ip = 10
  /** Réserve depuis une adresse IP neuve (la limite d'envois par visiteur est vérifiée à part). */
  const book = (body, client = visitor) => client.call('/api/appointments', { method: 'POST', headers: { [config.ipHeader]: `203.0.113.${ip++}` }, body: { name: 'Jeanne Martin', email: 'jeanne@example.com', ...body } })
  const tick = () => claire.json('/_cms/dev-scheduled', { method: 'POST', body: { cron: '*/5 * * * *' } })
  const settings = {
    services: [{ label: 'Première consultation', duration: 45, deposit: 30, description: 'Pour faire le point sur votre situation.' }, { label: 'Suivi', duration: 30, deposit: 0, description: '' }],
    hours: { mon: OPEN, tue: OPEN, wed: OPEN, thu: OPEN, fri: OPEN, sat: OPEN, sun: OPEN },
    step: 30, buffer: 0, minNoticeHours: 12, maxAdvanceDays: 30, cancelNoticeHours: 24, reminderHours: 24,
    closed: [{ from: parisDay(5), to: parisDay(5), label: 'Formation' }], location: '12 rue des Lilas, 69003 Lyon',
  }
  const D2 = parisDay(2), D3 = parisDay(3)
  const at = async (service, date, time) => (await slots(service, date))[0].slots.find(s => s.time === time)?.at
  const ids = {}

  await step('module désactivé : rien de public, pas de menu ; activé : réglages par défaut, envoi d\'e-mails à régler', async () => {
    await login(page, B)
    check((await claire.signIn(t.admin.email, t.admin.password)).status === 200, 'connexion refusée')
    const listed = (await claire.json('/api/cms/modules')).find(m => m.id === 'appointments')
    check(listed && !listed.enabled && listed.category === 'booking' && listed.canEnable, JSON.stringify(listed))
    const codes = [(await visitor.get('/api/appointments')).status, (await visitor.get('/api/appointments/slots?service=x')).status, (await book({ service: 'x', start: new Date().toISOString() })).status, (await claire.get('/api/cms/appointments')).status]
    check(codes.join() === '404,404,404,404', codes.join())
    check(!(await menuLabels(page)).includes('Rendez-vous'), 'menu affiché')
    check((await claire.call('/api/cms/modules/appointments/enabled', { method: 'PUT', body: { enabled: true } })).status === 200, 'activation refusée')
    const info = await visitor.json('/api/appointments')
    check(info.services.length === 1 && info.services[0].id === 'rendez-vous' && info.services[0].duration === 30 && info.services[0].deposit === null && info.timeZone === PARIS && info.today === parisDay(0), JSON.stringify(info))
    const d = await board()
    check(d.upcoming.length === 0 && d.mail.configured === false && d.deposit.available === false && d.feedUrl.startsWith(`${B}/api/appointments/feed.ics?t=`), JSON.stringify(d).slice(0, 300))
    const verify = await claire.json('/api/cms/modules/appointments/test', { method: 'POST' })
    check(!verify.ok && /ni la confirmation ni le rappel/.test(verify.message), JSON.stringify(verify))
    await claire.json('/api/cms/modules/brevo', { method: 'PUT', body: { values: { from: 'Cabinet Durand <contact@cabinet-durand.fr>' }, secrets: { apiKey: BREVO } } })
  })

  await step('réglages : refusés avec une phrase par problème, enregistrés par l\'administrateur seulement', async () => {
    const put = (body, client = claire) => client.call('/api/cms/appointments/settings', { method: 'PUT', body })
    const bad = await put({ ...settings, services: [{ label: '', duration: 32 }], hours: { ...settings.hours, mon: [['12:00', '09:00']] }, step: 7 })
    check(bad.status === 422 && bad.json.data.errors.length >= 4 && bad.json.data.errors.some(e => /multiple de 5/.test(e)) && bad.json.data.errors.some(e => /se termine avant de commencer/.test(e)), bad.text)
    check((await board()).settings.services[0].id === 'rendez-vous', 'réglages refusés mais enregistrés')
    const saved = await put(settings)
    check(saved.status === 200 && saved.json.services.map(s => s.id).join() === 'premiere-consultation,suivi', saved.text)
    for (const [who, client] of [[{ name: 'Marc Petit', email: 'marc@example.com', role: 'editor' }, marc], [{ name: 'Lina Roux', email: 'lina@example.com', role: 'writer' }, lina]]) {
      const { link } = await claire.json('/api/cms/users', { method: 'POST', body: who })
      await visitor.post(link.replace(/^.*\/admin\/invite\//, '/api/cms/invite/'), { password: 'motdepasse-test-2' })
      check((await client.signIn(who.email, 'motdepasse-test-2')).status === 200, 'connexion refusée pour ' + who.name)
    }
    const rights = [(await put(settings, marc)).status, (await marc.get('/api/cms/appointments')).status, (await lina.get('/api/cms/appointments')).status, (await visitor.get('/api/cms/appointments')).status, (await lina.get('/api/cms/appointments/export')).status]
    check(rights.join() === '403,200,403,401,403', rights.join())
    const info = await visitor.json('/api/appointments')
    // Sans Stripe réglé, l'acompte n'est pas annoncé au visiteur.
    check(info.services[0].deposit === null && info.location === '12 rue des Lilas, 69003 Lyon' && info.cancelNoticeHours === 24, JSON.stringify(info))
  })

  await step('créneaux : heures du site, durée de la prestation, délai minimal, jour fermé, prestation inconnue', async () => {
    const [day] = await slots('suivi', D2)
    check(day.date === D2 && day.slots.length === 14 && day.slots[0].time === '09:00' && day.slots.at(-1).time === '17:30', JSON.stringify(day.slots.map(s => s.time)))
    // 9 h à Paris, dit en heure universelle.
    const nine = new Date(day.slots[0].at)
    check(new Intl.DateTimeFormat('fr-FR', { timeZone: PARIS, hour: '2-digit', minute: '2-digit' }).format(nine) === '09:00', day.slots[0].at)
    // 45 minutes : pas de créneau à 11 h 30 ni à 17 h 30.
    const long = (await slots('premiere-consultation', D2))[0].slots.map(s => s.time)
    check(long.length === 12 && !long.includes('11:30') && long.includes('11:00') && long.at(-1) === '17:00', long.join())
    check((await slots('suivi', parisDay(5)))[0].slots.length === 0, 'créneaux proposés un jour fermé')
    // Aujourd'hui : rien à moins de douze heures. Une date passée repart d'aujourd'hui.
    const today = await slots('suivi', parisDay(-3), 2)
    check(today[0].date === parisDay(0) && today[0].slots.every(s => Date.parse(s.at) >= Date.now() + 12 * 3_600_000 - 60_000), JSON.stringify(today[0]))
    check((await slots('suivi', parisDay(31)))[0].slots.length === 0, 'créneaux au-delà de trente jours')
    check((await visitor.get('/api/appointments/slots?service=inconnue')).status === 404, 'prestation inconnue acceptée')
    check((await slots('suivi', D2, 400)).length === 42, 'nombre de jours non plafonné')
  })

  await step('réservation : confirmée, e-mail avec la date à l\'heure du site et les liens, créneau retiré', async () => {
    const start = await at('suivi', D2, '09:00')
    const r = await book({ service: 'suivi', start, phone: '06 12 34 56 78', note: 'Première visite.', origin: { source: 'google', medium: 'cpc', campaign: 'printemps', landing: '/rendez-vous' } })
    check(r.status === 200 && r.json.status === 'confirmed' && r.json.payUrl === null && r.json.manageUrl.startsWith(`${B}/api/appointments/manage?id=`), `${r.status} ${r.text}`)
    ids.manage = r.json.manageUrl.replace(B, '')
    const mail = await until(() => mails().find(m => m.body.subject === 'Votre rendez-vous est confirmé — Cabinet Durand'), 'e-mail de confirmation')
    const when = new Intl.DateTimeFormat('fr-FR', { timeZone: PARIS, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(start)).replace(/ 1 /, ' 1er ')
    check(mail.key === BREVO && mail.body.to[0].email === 'jeanne@example.com' && mail.body.htmlContent.includes(`${when} à 9 h`) && mail.body.htmlContent.includes('Suivi') && mail.body.htmlContent.includes('30 min') && mail.body.htmlContent.includes('12 rue des Lilas'), mail.body.htmlContent)
    check(mail.body.htmlContent.includes('/api/appointments/manage?id=') && mail.body.htmlContent.includes('/api/appointments/ics?id=') && mail.body.htmlContent.includes('jusqu&#39;à 24 h avant'), 'liens absents de l\'e-mail')
    const left = (await slots('suivi', D2))[0].slots.map(s => s.time)
    check(left.length === 13 && !left.includes('09:00'), left.join())
    // La prestation de 45 minutes ne peut plus commencer à 9 h (le créneau de 9 h 30, lui, reste libre).
    const long = (await slots('premiere-consultation', D2))[0].slots.map(s => s.time)
    check(!long.includes('09:00') && long.includes('09:30'), long.join())
    const [row] = (await board()).upcoming
    check(row.name === 'Jeanne Martin' && row.phone === '06 12 34 56 78' && row.note === 'Première visite.' && row.status === 'confirmed' && row.duration === 30 && row.channel === 'Google Ads' && row.location === '12 rue des Lilas, 69003 Lyon', JSON.stringify(row))
    ids.first = row.id
  })

  await step('réservation refusée : créneau pris, heure non proposée, trop proche, champs à corriger ; champ piège ignoré', async () => {
    const before = (await board()).upcoming.length
    const taken = await book({ service: 'suivi', start: (await board()).upcoming[0].start })
    check(taken.status === 409 && /vient d'être pris/.test(taken.json.message), `${taken.status} ${taken.text}`)
    const free = await at('suivi', D2, '10:00')
    const off = await book({ service: 'suivi', start: new Date(Date.parse(free) + 10 * 60_000).toISOString() })
    check(off.status === 422 && /n'est pas proposé/.test(off.json.message), `${off.status} ${off.text}`)
    const soon = await book({ service: 'suivi', start: new Date(Math.ceil(Date.now() / 300_000) * 300_000 + 3_600_000).toISOString() })
    check(soon.status === 422 && /au moins 12 h/.test(soon.json.message), `${soon.status} ${soon.text}`)
    const odd = await book({ service: 'suivi', start: 'demain matin' })
    check(odd.status === 422 && /illisible/.test(odd.json.message), `${odd.status} ${odd.text}`)
    const fields = await book({ service: 'suivi', start: free, name: ' ', email: 'pas-une-adresse', phone: 'abc' })
    check(fields.status === 422 && fields.json.data.errors.name && fields.json.data.errors.email && fields.json.data.errors.phone, fields.text)
    const robot = await book({ service: 'suivi', start: free, website: 'https://spam.example' })
    check(robot.status === 200 && robot.json.ok, robot.text)
    check((await board()).upcoming.length === before, 'une demande refusée a été enregistrée')
  })

  await step('cinq demandes simultanées pour le même créneau : une seule réservation', async () => {
    const start = await at('suivi', D2, '14:00')
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => book({ service: 'suivi', start, name: `Simultané ${i}`, email: `simultane${i}@example.com` }, t.http())))
    const codes = results.map(r => r.status).sort().join()
    check(codes === '200,409,409,409,409', codes)
    check((await board()).upcoming.filter(a => a.start === start).length === 1, 'créneau réservé deux fois')
    check(Number(sql(`select count(*) from cms_appointment_slots where at = ${Date.parse(start)}`)) === 1, 'case en double')
  })

  await step('limite d\'envois : six réservations coup sur coup depuis la même adresse', async () => {
    const day = (await slots('suivi', D3))[0].slots
    const header = { [config.ipHeader]: '203.0.113.200' }
    const codes = []
    for (let i = 0; i < 6; i++) codes.push((await visitor.call('/api/appointments', { method: 'POST', headers: header, body: { service: 'suivi', start: day[i].at, name: `Série ${i}`, email: 'serie@example.com' } })).status)
    check(codes.join() === '200,200,200,200,200,429', codes.join())
  })

  await step('page du visiteur : son rendez-vous, fichier d\'agenda, faux lien refusé', async () => {
    const shown = await visitor.get(ids.manage)
    check(shown.status === 200 && shown.text.includes('data-cms-appointment="manage"') && shown.text.includes('Annuler ce rendez-vous') && shown.text.includes('Suivi') && shown.headers.get('x-robots-tag') === 'noindex' && shown.headers.get('cache-control') === 'private, no-store', shown.text.slice(0, 400))
    const forged = await visitor.get(ids.manage.replace(/t=.{4}/, 't=AAAA'))
    check(forged.status === 410 && forged.text.includes('data-cms-appointment="invalid"'), `${forged.status}`)
    check((await visitor.get('/api/appointments/manage?id=pas-un-identifiant&t=x')).status === 410, 'identifiant illisible accepté')
    const ics = await visitor.get(ids.manage.replace('/manage?', '/ics?'))
    const start = (await board()).upcoming.find(a => a.id === ids.first).start
    const stamp = new Date(start).toISOString().replace(/[-:]/g, '').replace('.000', '')
    check(ics.status === 200 && ics.headers.get('content-type').startsWith('text/calendar') && ics.text.includes(`DTSTART:${stamp}`) && ics.text.includes('SUMMARY:Suivi — Cabinet Durand') && ics.text.includes('LOCATION:12 rue des Lilas\\, 69003 Lyon') && !ics.text.includes('jeanne@example.com'), ics.text)
    check((await visitor.get(ids.manage.replace('/manage?', '/ics?').replace(/t=.{4}/, 't=AAAA'))).status === 404, 'fichier d\'agenda servi avec un faux lien')
  })

  await step('annulation par le visiteur : par le bouton seulement, créneau rendu, e-mail, une seule fois', async () => {
    const before = mails().length
    // Ouvrir le lien n'annule rien.
    await visitor.get(ids.manage)
    check((await board()).upcoming.some(a => a.id === ids.first), 'annulé par une simple lecture du lien')
    const done = await visitor.call(ids.manage, { method: 'POST' })
    check(done.status === 200 && done.text.includes('data-cms-appointment="cancelled"'), `${done.status} ${done.text.slice(0, 300)}`)
    check((await slots('suivi', D2))[0].slots.some(s => s.time === '09:00'), 'créneau non rendu')
    const mail = await until(() => mails().slice(before).find(m => m.body.subject === 'Votre rendez-vous est annulé — Cabinet Durand'), 'e-mail d\'annulation')
    check(mail.body.htmlContent.includes('Votre rendez-vous a bien été annulé.'), mail.body.htmlContent)
    const d = await board()
    const row = d.past.find(a => a.id === ids.first)
    check(row.status === 'cancelled' && row.cancelledBy === 'visitor' && !d.upcoming.some(a => a.id === ids.first), JSON.stringify(row))
    const count = mails().length
    const again = await visitor.call(ids.manage, { method: 'POST' })
    check(again.text.includes('data-cms-appointment="cancelled"') && mails().length === count, 'seconde annulation traitée')
  })

  await step('trop tard pour annuler en ligne : la page le dit, le bouton n\'existe plus, la demande est sans effet', async () => {
    const r = await book({ service: 'suivi', start: await at('suivi', D2, '09:00'), name: 'Paul Tardif', email: 'paul@example.com' })
    const manage = r.json.manageUrl.replace(B, '')
    const id = new URL(r.json.manageUrl).searchParams.get('id')
    // Le rendez-vous est dans trois heures : moins que les vingt-quatre heures réglées.
    const soon = Math.ceil(Date.now() / 300_000) * 300_000 + 3 * 3_600_000
    sql(`update cms_appointments set start = ${soon}, end = ${soon + 1_800_000} where id = '${id}'`)
    const shown = await visitor.get(manage)
    check(shown.text.includes('trop tard pour l&#39;annuler en ligne') && !shown.text.includes('data-cms-appointment-cancel'), shown.text.slice(0, 600))
    const tried = await visitor.call(manage, { method: 'POST' })
    check(tried.text.includes('data-cms-appointment="manage"') && (await board()).upcoming.some(a => a.id === id), 'annulé hors délai')
    ids.late = id
  })

  await step('workflow « un rendez-vous est pris » : variables transmises', async () => {
    await claire.json('/api/cms/workflows', { method: 'POST', body: { name: 'Prévenir à chaque rendez-vous', trigger: { event: 'appointment.booked' }, actions: [{ kind: 'webhook', url: `${M}/rendez-vous-pris` }] } })
    await claire.json('/api/cms/workflows', { method: 'POST', body: { name: 'Prévenir à chaque annulation', trigger: { event: 'appointment.cancelled' }, actions: [{ kind: 'webhook', url: `${M}/rendez-vous-annule` }] } })
    const r = await book({ service: 'suivi', start: await at('suivi', D2, '10:00'), name: 'Lucie Bernard', email: 'lucie@example.com', phone: '+33 6 11 22 33 44' })
    check(r.status === 200, r.text)
    ids.lucie = new URL(r.json.manageUrl).searchParams.get('id')
    const sent = await until(() => calls().find(c => c.url === '/rendez-vous-pris'), 'appel du workflow')
    const a = sent.body.appointment
    check(a.service === 'Suivi' && a.name === 'Lucie Bernard' && a.email === 'lucie@example.com' && a.phone === '+33 6 11 22 33 44' && a.duration === '30 min' && / à 10 h$/.test(a.date) && a.adminUrl === `${B}/admin/appointments?rdv=${ids.lucie}`, JSON.stringify(a))
    const events = (await claire.json('/api/cms/workflows')).events ?? []
    check(!events.length || events.some(e => e.name === 'appointment.booked'), 'déclencheur non proposé')
  })

  await step('back-office : saisie d\'un rendez-vous hors délai, moment occupé refusé, annulation avec un mot, export, effacement', async () => {
    // Le professionnel voit aussi les moments d'aujourd'hui et du jour fermé.
    const closed = (await claire.json(`/api/cms/appointments/slots?service=suivi&date=${parisDay(5)}`)).slots
    check(closed.length === 14, `jour fermé : ${closed.length} moments`)
    const free = (await claire.json(`/api/cms/appointments/slots?service=suivi&date=${D2}`)).slots
    check(!free.some(s => s.time === '10:00') && free.some(s => s.time === '10:30'), free.map(s => s.time).join())
    const before = mails().length
    const made = await claire.call('/api/cms/appointments', { method: 'POST', body: { service: 'premiere-consultation', start: closed[0].at, name: 'Henri Lambert', email: 'henri@example.com', phone: '04 72 00 00 00' } })
    check(made.status === 200 && made.json.id, made.text)
    ids.henri = made.json.id
    const busy = await claire.call('/api/cms/appointments', { method: 'POST', body: { service: 'suivi', start: closed[1].at, name: 'Autre', email: 'autre@example.com' } })
    check(busy.status === 409 && /occupe déjà ce moment/.test(busy.json.message), `${busy.status} ${busy.text}`)
    check((await claire.call('/api/cms/appointments', { method: 'POST', body: { service: 'suivi', start: closed[3].at, name: '', email: 'x' } })).status === 422, 'saisie sans nom acceptée')
    check((await lina.call('/api/cms/appointments', { method: 'POST', body: { service: 'suivi', start: closed[3].at, name: 'Lina', email: 'lina@example.com' } })).status === 403, 'rédactrice autorisée')
    const henri = (await board()).upcoming.find(a => a.id === ids.henri)
    // Saisi dans le back-office : confirmé sans acompte, même pour une prestation qui en demande un.
    check(henri.status === 'confirmed' && henri.createdBy && henri.paid === '' && henri.duration === 45, JSON.stringify(henri))
    await until(() => mails().slice(before).some(m => m.body.to[0].email === 'henri@example.com' && m.body.subject.startsWith('Votre rendez-vous est confirmé')), 'confirmation du rendez-vous saisi')

    const count = mails().length
    const cancelled = await marc.call(`/api/cms/appointments/${ids.henri}/cancel`, { method: 'POST', body: { message: 'Empêchement de dernière minute.' } })
    check(cancelled.status === 200, cancelled.text)
    const mail = await until(() => mails().slice(count).find(m => m.body.to[0].email === 'henri@example.com'), 'e-mail d\'annulation par le site')
    check(mail.body.htmlContent.includes('a dû annuler votre rendez-vous') && mail.body.htmlContent.includes('Empêchement de dernière minute.'), mail.body.htmlContent)
    check((await marc.call(`/api/cms/appointments/${ids.henri}/cancel`, { method: 'POST', body: {} })).status === 409, 'annulé deux fois')
    const hook = await until(() => calls().find(c => c.url === '/rendez-vous-annule'), 'workflow d\'annulation')
    check(hook.body.appointment.name === 'Henri Lambert' && hook.body.appointment.cancelledBy === 'le site', JSON.stringify(hook.body.appointment))

    const csv = await claire.get('/api/cms/appointments/export')
    check(csv.status === 200 && csv.headers.get('content-type').startsWith('text/csv') && csv.text.includes('"Lucie Bernard"') && csv.text.includes('"Annulé"') && csv.text.includes('"Google Ads"'), csv.text.slice(0, 400))
    check((await claire.del(`/api/cms/appointments/${ids.lucie}`)).status === 409, 'rendez-vous en cours effacé sans annulation')
    check((await claire.del(`/api/cms/appointments/${ids.henri}`)).status === 200 && !(await board()).past.some(a => a.id === ids.henri), 'effacement refusé')
    const log = JSON.stringify(await claire.json('/api/cms/activity'))
    for (const phrase of ['a modifié les réglages des rendez-vous', 'a saisi un rendez-vous : Première consultation', 'a annulé un rendez-vous', 'a exporté les rendez-vous', 'a effacé un rendez-vous'])
      check(log.includes(phrase), `journal sans « ${phrase} »`)
    check(!log.includes('henri@example.com'), 'adresse d\'une personne dans le journal')
  })

  await step('rappel par e-mail vingt-quatre heures avant, une seule fois ; rendez-vous de plus de treize mois effacé', async () => {
    const before = mails().length
    await tick()
    check(!mails().slice(before).some(m => m.body.subject.startsWith('Rappel')), 'rappel parti trop tôt')
    // Le rendez-vous de Lucie est dans vingt heures, pris il y a trois jours.
    const soon = Math.ceil(Date.now() / 300_000) * 300_000 + 20 * 3_600_000
    sql(`update cms_appointments set start = ${soon}, end = ${soon + 1_800_000}, created_at = ${Date.now() - 3 * DAY} where id = '${ids.lucie}'`)
    const result = await tick()
    const mail = await until(() => mails().slice(before).find(m => m.body.subject === 'Rappel de votre rendez-vous — Cabinet Durand'), 'e-mail de rappel')
    check(mail.body.to[0].email === 'lucie@example.com' && mail.body.htmlContent.includes('nous vous rappelons votre rendez-vous'), mail.body.htmlContent)
    check(result.ok, JSON.stringify(result))
    const count = mails().length
    await tick()
    check(mails().length === count, 'rappel envoyé deux fois')
    // Celui de Paul, pris il y a une heure pour dans trois heures : la confirmation vient de partir, pas de rappel.
    check(!mails().some(m => m.body.subject.startsWith('Rappel') && m.body.to[0].email === 'paul@example.com'), 'rappel pour un rendez-vous tout juste pris')
    sql(`update cms_appointments set start = ${Date.now() - 401 * DAY}, end = ${Date.now() - 401 * DAY + 1_800_000} where id = '${ids.first}'`)
    await tick()
    check(!(await board()).past.some(a => a.id === ids.first), 'vieux rendez-vous gardé')
  })

  // ───── Acompte par Stripe ─────
  const signed = (event) => {
    const body = JSON.stringify(event), now = Math.floor(Date.now() / 1000)
    return stripe.call('/api/stripe/webhook', { method: 'POST', body, headers: { 'content-type': 'application/json', 'stripe-signature': `t=${now},v1=${createHmac('sha256', WHSEC).update(`${now}.${body}`).digest('hex')}` } })
  }
  /** La session terminée telle que Stripe l'annonce, d'après la demande réellement faite par le site. */
  const paid = (n) => {
    const sent = sessions()[n - 1].body
    const metadata = Object.fromEntries(Object.entries(sent).filter(([k]) => k.startsWith('metadata[')).map(([k, v]) => [k.slice(9, -1), v]))
    return signed({ id: `evt_${n}`, object: 'event', type: 'checkout.session.completed', livemode: false, data: { object: {
      id: `cs_test_session000${n}`, object: 'checkout.session', mode: 'payment', livemode: false, currency: 'eur', status: 'complete', payment_status: 'paid',
      amount_total: Number(sent['line_items[0][price_data][unit_amount]']), payment_intent: `pi_test_${n}`, customer_details: { email: sent.customer_email, name: 'Client' }, metadata,
    } } })
  }

  await step('acompte : annoncé au visiteur, créneau gardé, page de paiement, rien de confirmé avant Stripe', async () => {
    await claire.json('/api/cms/modules/stripe', { method: 'PUT', body: { secrets: { secretKey: STRIPE, webhookSecret: WHSEC } } })
    const info = await visitor.json('/api/appointments')
    check(info.services[0].deposit.replace(/\s/g, ' ') === '30,00 €' && info.services[1].deposit === null, JSON.stringify(info.services))
    check((await board()).deposit.available === true, 'acompte non disponible')
    const before = mails().length
    const start = await at('premiere-consultation', D3, '14:00')
    const r = await book({ service: 'premiere-consultation', start, name: 'Nadia Morel', email: 'nadia@example.com' })
    check(r.status === 200 && r.json.status === 'pending' && r.json.payUrl === `${M}/stripe/checkout/cs_test_session0001`, `${r.status} ${r.text}`)
    ids.nadiaManage = r.json.manageUrl.replace(B, '')
    ids.nadia = new URL(r.json.manageUrl).searchParams.get('id')
    const sent = sessions()[0]
    check(sent.key === STRIPE && sent.body['line_items[0][price_data][unit_amount]'] === '3000' && sent.body['line_items[0][quantity]'] === '1' && sent.body['metadata[cms_collection]'] === 'appointments' && sent.body['metadata[cms_entry]'] === ids.nadia && sent.body.customer_email === 'nadia@example.com', JSON.stringify(sent.body))
    check(sent.body['line_items[0][price_data][product_data][name]'].startsWith('Acompte — Première consultation, ') && sent.body.success_url === `${r.json.manageUrl}&paid=1` && sent.body.cancel_url === r.json.manageUrl, JSON.stringify(sent.body))
    const life = Number(sent.body.expires_at) - Math.floor(Date.now() / 1000)
    check(life > 30 * 60 && life <= 31 * 60, `durée de vie de la page de paiement : ${life} s`)
    check(!(await slots('premiere-consultation', D3))[0].slots.some(s => s.at === start), 'créneau non gardé')
    const row = (await board()).upcoming.find(a => a.id === ids.nadia)
    check(row.status === 'pending' && row.paid === '', JSON.stringify(row))
    const page1 = await visitor.get(ids.nadiaManage)
    check(page1.text.includes('data-cms-appointment="pending"') && page1.text.includes('Régler l&#39;acompte de 30,00') && page1.text.includes('do=pay'), page1.text.slice(0, 700))
    // Le bouton de la page relance le paiement : une nouvelle page de paiement chez Stripe.
    const again = await visitor.call(`${ids.nadiaManage}&do=pay`, { method: 'POST' })
    check(again.status === 303 && again.headers.get('location') === `${M}/stripe/checkout/cs_test_session0002`, `${again.status} ${again.headers.get('location')}`)
    check(!mails().slice(before).some(m => m.body.to[0].email === 'nadia@example.com'), 'confirmation envoyée avant le paiement')
    check(!calls().some(c => c.url === '/rendez-vous-pris' && c.body.appointment.name === 'Nadia Morel'), 'workflow déclenché avant le paiement')
  })

  await step('acompte reçu (événement signé) : rendez-vous confirmé, e-mail, paiement rangé dans « Paiements »', async () => {
    const before = mails().length
    const waiting = await visitor.get(`${ids.nadiaManage}&paid=1`)
    check(waiting.text.includes('http-equiv="refresh"') && !waiting.text.includes('do=pay'), 'page de retour du paiement')
    const r = await paid(2)
    check(r.status === 200 && r.json.result === 'enregistré (paid) ; rendez-vous : confirmé', `${r.status} ${r.text}`)
    const row = (await board()).upcoming.find(a => a.id === ids.nadia)
    check(row.status === 'confirmed' && row.paid.replace(/\s/g, ' ') === '30,00 €', JSON.stringify(row))
    const mail = await until(() => mails().slice(before).find(m => m.body.to[0].email === 'nadia@example.com'), 'confirmation après paiement')
    check(mail.body.subject.startsWith('Votre rendez-vous est confirmé') && mail.body.htmlContent.replace(/\s/g, ' ').includes('Acompte reçu : 30,00 €'), mail.body.htmlContent)
    await until(() => calls().some(c => c.url === '/rendez-vous-pris' && c.body.appointment.name === 'Nadia Morel'), 'workflow après paiement')
    const [payment] = (await claire.json('/api/cms/payments')).payments
    check(payment.collection === 'appointments' && payment.entryId === ids.nadia && payment.amount === 3000 && payment.title.startsWith('Acompte — Première consultation'), JSON.stringify(payment))
    // Le même événement reçu deux fois ne confirme ni n'écrit rien de plus.
    const count = mails().length
    check((await paid(2)).json.result === 'déjà enregistré' && mails().length === count, 'événement rejoué traité')
    check((await visitor.get(ids.nadiaManage)).text.includes('data-cms-appointment="manage"'), 'page du rendez-vous non confirmée')
  })

  await step('acompte jamais réglé : créneau rendu après une demi-heure ; paiement tardif : créneau repris s\'il est libre, sinon à rembourser', async () => {
    const start = await at('premiere-consultation', D3, '15:00')
    const first = await book({ service: 'premiere-consultation', start, name: 'Omar Petit', email: 'omar@example.com' })
    const omar = new URL(first.json.manageUrl).searchParams.get('id')
    check(first.json.payUrl.endsWith('cs_test_session0003'), first.text)
    sql(`update cms_appointments set created_at = ${Date.now() - 40 * 60_000} where id = '${omar}'`)
    // La simple lecture des créneaux rend celui-ci.
    check((await slots('premiere-consultation', D3))[0].slots.some(s => s.at === start), 'créneau non rendu')
    let d = await board()
    const expired = d.past.find(a => a.id === omar)
    check(expired.status === 'cancelled' && expired.cancelledBy === 'expired' && !expired.refundDue, JSON.stringify(expired))
    check((await visitor.call(`${first.json.manageUrl.replace(B, '')}&do=pay`, { method: 'POST' })).status === 409, 'paiement relancé après le délai')
    // Paiement arrivé malgré tout, le créneau étant toujours libre : le rendez-vous est repris.
    const late = await paid(3)
    check(late.json.result === 'enregistré (paid) ; rendez-vous : confirmé (créneau repris)', late.text)
    check((await board()).upcoming.find(a => a.id === omar)?.status === 'confirmed' && !(await slots('premiere-consultation', D3))[0].slots.some(s => s.at === start), 'créneau non repris')

    // Même scénario, mais quelqu'un d'autre a pris le créneau entre-temps.
    const other = await at('premiere-consultation', D3, '16:00')
    const second = await book({ service: 'premiere-consultation', start: other, name: 'Rémi Faure', email: 'remi@example.com' })
    const remi = new URL(second.json.manageUrl).searchParams.get('id')
    sql(`update cms_appointments set created_at = ${Date.now() - 40 * 60_000} where id = '${remi}'`)
    await slots('premiere-consultation', D3)
    check((await claire.call('/api/cms/appointments', { method: 'POST', body: { service: 'suivi', start: other, name: 'Sophie Blanc', email: 'sophie@example.com' } })).status === 200, 'créneau rendu non réservable')
    const lost = await paid(4)
    check(/à rembourser/.test(lost.json.result), lost.text)
    d = await board()
    const row = d.past.find(a => a.id === remi)
    check(row.status === 'cancelled' && row.refundDue === true && row.paid.replace(/\s/g, ' ') === '30,00 €', JSON.stringify(row))
  })

  await step('agenda à abonner : tous les rendez-vous en cours, avec les coordonnées ; fermé sans sa signature', async () => {
    const { feedUrl } = await board()
    const feed = await visitor.get(feedUrl.replace(B, ''))
    check(feed.status === 200 && feed.headers.get('content-type').startsWith('text/calendar') && feed.text.includes('X-WR-CALNAME:Rendez-vous — Cabinet Durand'), feed.text.slice(0, 300))
    check(feed.text.includes('SUMMARY:Première consultation — Nadia Morel') && feed.text.includes('nadia@example.com') && !feed.text.includes('Henri Lambert') && !feed.text.includes('Rémi Faure'), 'contenu de l\'agenda')
    check((await visitor.get('/api/appointments/feed.ics')).status === 404 && (await visitor.get('/api/appointments/feed.ics?t=faux')).status === 404, 'agenda servi sans signature')
  })

  await step('agenda à abonner : renouveler l\'adresse ferme l\'ancienne ; administrateur seulement', async () => {
    const { feedUrl } = await board()
    const refused = [(await marc.call('/api/cms/appointments/feed', { method: 'POST' })).status, (await visitor.call('/api/cms/appointments/feed', { method: 'POST' })).status]
    check(refused.join() === '403,401', 'renouvellement sans en avoir le droit : ' + refused.join())
    check((await visitor.get(feedUrl.replace(B, ''))).status === 200, 'un refus a fermé l\'adresse')
    const renewed = await claire.json('/api/cms/appointments/feed', { method: 'POST' })
    check(renewed.feedUrl !== feedUrl && renewed.feedUrl.startsWith(`${B}/api/appointments/feed.ics?t=`), JSON.stringify(renewed))
    check((await visitor.get(feedUrl.replace(B, ''))).status === 404, 'l\'ancienne adresse répond encore')
    const feed = await visitor.get(renewed.feedUrl.replace(B, ''))
    check(feed.status === 200 && feed.text.includes('SUMMARY:Première consultation — Nadia Morel'), 'la nouvelle adresse ne sert pas l\'agenda')
    check((await board()).feedUrl === renewed.feedUrl, 'l\'écran montre encore l\'ancienne adresse')
  })

  await step('site : choisir une prestation et un créneau, réserver ; le créneau pris entre-temps est signalé', async () => {
    const site = await t.newPage({ context: await t.newContext() })
    await site.goto(B + '/rendez-vous', { waitUntil: 'networkidle0' })
    await site.waitForSelector('[data-booking-service="suivi"]')
    await site.click('[data-booking-service="suivi"]')
    await site.waitForSelector('[data-booking-slot]')
    // Semaine suivante, puis retour : les jours changent.
    const firstDay = await site.$eval('[data-booking-day]', el => el.dataset.bookingDay)
    await site.click('[data-booking-next]')
    await site.waitForFunction(d => document.querySelector('[data-booking-day]')?.dataset.bookingDay !== d, {}, firstDay)
    await site.click('[data-booking-previous]')
    await site.waitForFunction(d => document.querySelector('[data-booking-day]')?.dataset.bookingDay === d, {}, firstDay)
    const target = await at('suivi', D2, '17:00')
    await site.click(`[data-booking-slot="${target}"]`)
    await site.waitForSelector('[data-booking-form]')
    // Quelqu'un prend ce créneau pendant que le visiteur remplit le formulaire.
    check((await book({ service: 'suivi', start: target, name: 'Plus rapide', email: 'rapide@example.com' })).status === 200, 'réservation concurrente refusée')
    await site.type('input[name="name"]', 'Zoé Garnier')
    await site.type('input[name="email"]', 'zoe@example.com')
    await clickText(site, 'button', 'Réserver ce créneau')
    await site.waitForFunction(() => document.querySelector('[data-booking-error]')?.textContent.includes('vient d\'être pris'))
    await site.waitForFunction(at => !document.querySelector(`[data-booking-slot="${at}"]`), {}, target)
    const other = await at('suivi', D2, '17:30')
    await site.click(`[data-booking-slot="${other}"]`)
    await site.waitForSelector('[data-booking-form]')
    await clickText(site, 'button', 'Réserver ce créneau')
    await site.waitForSelector('[data-booking-done]')
    check((await site.$eval('[data-booking-done]', el => el.innerText)).includes('à 17:30'), 'créneau non rappelé')
    check((await board()).upcoming.some(a => a.name === 'Zoé Garnier' && a.start === other), 'rendez-vous non enregistré')
    // Le lien « Voir mon rendez-vous » mène à la page du rendez-vous, où le bouton annule.
    await Promise.all([site.waitForNavigation(), site.click('[data-booking-manage]')])
    await site.waitForSelector('html[data-cms-appointment="manage"]')
    await Promise.all([site.waitForNavigation(), site.click('[data-cms-appointment-cancel]')])
    await site.waitForSelector('html[data-cms-appointment="cancelled"]')
    check(!(await board()).upcoming.some(a => a.name === 'Zoé Garnier'), 'annulation depuis la page sans effet')
    await site.close()
  })

  await step('écran « Rendez-vous » : agenda par jour, annulation avec un mot, saisie, réglages, tableau de bord, téléphone', async () => {
    await page.goto(B + '/admin/appointments', { waitUntil: 'networkidle0' })
    check((await menuLabels(page)).includes('Rendez-vous'), 'entrée du menu absente')
    await page.waitForSelector('[data-appointment]')
    const shown = await page.$$eval('[data-appointments-day] [data-appointment]', els => els.length)
    check(shown === (await board()).upcoming.length, `${shown} rendez-vous affichés`)
    await says(page, 'Acompte reçu')
    // Annuler celui de Nadia, avec un mot.
    const row = await page.evaluateHandle(() => [...document.querySelectorAll('[data-appointment]')].find(li => li.textContent.includes('Nadia Morel')))
    await (await row.$('[data-appointment-cancel]')).evaluate(b => b.click())
    await page.waitForSelector('[data-appointments-cancel-dialog][open]')
    await says(page, 'se rembourse dans Stripe')
    await page.type('[data-appointments-cancel-dialog] textarea', 'Le cabinet sera fermé ce jour-là.')
    const before = mails().length
    await page.click('[data-appointments-cancel-confirm]')
    await says(page, 'Rendez-vous annulé')
    await until(() => mails().slice(before).some(m => m.body.to[0].email === 'nadia@example.com' && m.body.htmlContent.includes('Le cabinet sera fermé ce jour-là.')), 'e-mail d\'annulation depuis l\'écran')
    await page.click('[data-appointments-tab="past"]')
    await page.waitForSelector('[data-appointment-refund]')

    // Saisir un rendez-vous. Le jour proposé est aujourd'hui, où il ne reste plus de moment libre en fin de journée :
    // la saisie se fait pour demain, qui en a à toute heure. Le moment est désigné par son instant, pas par son heure :
    // tant que la liste de demain n'est pas affichée, celle d'aujourd'hui montre les mêmes heures.
    await page.click('[data-appointments-add]')
    await page.waitForSelector('[data-appointments-add-dialog][open]')
    const tomorrow = parisDay(1)
    const service = (await board()).settings.services[0].id
    const [free] = (await claire.json(`/api/cms/appointments/slots?service=${service}&date=${tomorrow}`)).slots
    check(free, 'aucun moment libre demain')
    await page.$eval('[data-appointments-add-dialog] input[name="date"]', (input, day) => { input.value = day; input.dispatchEvent(new Event('input', { bubbles: true })) }, tomorrow)
    const slot = `[data-appointments-add-dialog][open] [data-add-slots] button[data-slot="${free.at}"]`
    await page.waitForSelector(slot)
    await page.click(slot)
    await page.type('[data-appointments-add-dialog] input[name="name"]', 'Tom Leroy')
    await page.type('[data-appointments-add-dialog] input[name="email"]', 'tom@example.com')
    await page.click('[data-add-save]')
    await says(page, 'Rendez-vous enregistré')
    const tom = (await board()).upcoming.find(a => a.name === 'Tom Leroy')
    check(tom && Date.parse(tom.start) === Date.parse(free.at), 'rendez-vous saisi non enregistré au moment choisi : ' + JSON.stringify(tom))

    // Réglages : une valeur refusée est expliquée, une bonne est enregistrée.
    await page.click('[data-appointments-tab="settings"]')
    await page.waitForSelector('[data-settings-service]')
    check((await page.$$('[data-settings-service]')).length === 2 && (await page.$$('[data-settings-closure]')).length === 1, 'prestations ou fermetures non affichées')
    const step = await page.$('[data-settings-step]')
    // Un champ numérique ne se sélectionne pas au triple clic : son contenu est sélectionné, puis remplacé.
    const replace = async (el, text) => { await el.focus(); await el.evaluate(e => e.select()); await el.type(text) }
    await replace(step, '7')
    await page.click('[data-settings-save]')
    await page.waitForSelector('[data-settings-errors]')
    await says(page, 'Écart entre deux créneaux')
    await replace(step, '60')
    await page.click('[data-settings-save]')
    await says(page, 'Réglages enregistrés')
    check((await board()).settings.step === 60 && (await slots('suivi', parisDay(8)))[0].slots.length === 7, 'pas des créneaux non appliqué')
    check((await page.$eval('[data-appointments-feed]', el => el.value)).includes('/api/appointments/feed.ics?t='), 'adresse de l\'agenda absente')

    const figure = (await claire.json('/api/cms/dashboard')).figures.find(f => f.key === 'appointments')
    check(figure && Number(figure.value) === (await board()).upcoming.filter(a => a.status === 'confirmed').length && figure.to === '/admin/appointments', JSON.stringify(figure))
    check(!(await lina.json('/api/cms/dashboard')).figures.some(f => f.key === 'appointments'), 'chiffre montré à la rédactrice')

    // L'éditeur n'a pas l'onglet des réglages.
    const context = await t.newContext()
    const other = await t.newPage({ context })
    await login(other, B, { email: 'marc@example.com', password: 'motdepasse-test-2' })
    await other.goto(B + '/admin/appointments', { waitUntil: 'networkidle0' })
    await other.waitForSelector('[data-appointments-tab="upcoming"]')
    check(!(await other.$('[data-appointments-tab="settings"]')), 'réglages montrés à l\'éditeur')
    await other.setViewport({ width: 390, height: 800 })
    check(await other.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'l\'écran déborde sur téléphone')
    await context.close()
  })
}
