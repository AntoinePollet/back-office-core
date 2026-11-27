// Module « Lettre d'information » : inscription confirmée par e-mail, liste Brevo, désinscription, écran.
import fs from 'node:fs'
import path from 'node:path'
import { config } from '../lib/config.mjs'
import { check, clickText, login, menuLabels, says, until } from '../lib/harness.mjs'
import { runSql } from '../lib/sqlite.mjs'

/** Fichier de la base locale du serveur de test, pour avancer le temps (sqlite3). */
function databaseFile() {
  if (config.target === 'node') return path.join(config.tmpDir, 'etat', 'cms.sqlite')
  const dir = path.join(config.tmpDir, 'etat', 'v3', 'd1', 'miniflare-D1DatabaseObject')
  return path.join(dir, fs.readdirSync(dir).find(f => f.endsWith('.sqlite') && f !== 'metadata.sqlite'))
}
const sql = query => runSql(databaseFile(), query)

export const meta = {
  title: 'lettre d\'information : double confirmation, liste Brevo, désinscription, export',
  mock: true,
  env: ({ mock }) => ({ NUXT_BREVO_API_URL: `${mock}/v3` }),
}

const KEY = 'xkeysib-cle-de-test-12345'

export default async function (t) {
  const { B, step, calls } = t
  const admin = t.http(), visitor = t.http()
  const mails = () => calls().filter(c => c.url === '/v3/smtp/email')
  const added = () => calls().filter(c => c.url === '/v3/contacts')
  const removed = () => calls().filter(c => c.url === '/v3/contacts/lists/12/contacts/remove')
  const subscribe = body => visitor.post('/api/newsletter/subscribe', body)
  const list = () => admin.json('/api/cms/newsletter')
  const row = async email => (await list()).subscribers.find(s => s.email === email)
  /** Lien de confirmation lu dans l'e-mail envoyé à cette adresse (le dernier). */
  const confirmLink = (email) => {
    const mail = mails().filter(m => m.body.to[0].email === email).pop()
    return mail.body.htmlContent.match(/href="([^"]+\/api\/newsletter\/confirm[^"]+)"/)[1].replace(/&amp;/g, '&')
  }
  const page = async (url, init) => { const r = await fetch(url, { redirect: 'manual', ...init }); return { status: r.status, html: await r.text(), headers: r.headers } }
  const kind = html => html.match(/data-cms-newsletter="([^"]+)"/)?.[1] ?? null

  await step('module désactivé : aucune route ; activé sans envoi d\'e-mails : inscription refusée', async () => {
    check((await admin.signIn(t.admin.email, t.admin.password)).status === 200, 'connexion refusée')
    check((await subscribe({ email: 'lea@example.com' })).status === 404, 'inscription acceptée sans le module')
    check((await admin.get('/api/cms/newsletter')).status === 404, 'écran servi sans le module')
    const state = await admin.json('/api/cms/modules/newsletter/enabled', { method: 'PUT', body: { enabled: true } })
    check(state.enabled && state.configured && state.category === 'forms' && state.adminPage.to === '/admin/newsletter', JSON.stringify(state))
    const refused = await subscribe({ email: 'lea@example.com' })
    check(refused.status === 503 && refused.json.message === 'L\'inscription n\'est pas disponible pour l\'instant.', `${refused.status} ${refused.text}`)
    const test = await admin.json('/api/cms/modules/newsletter/test', { method: 'POST', body: {} })
    check(!test.ok && test.message.includes('Aucun envoi d\'e-mails'), test.message)
    check((await list()).mail.configured === false, 'envoi dit réglé')
    await admin.json('/api/cms/modules/brevo', { method: 'PUT', body: { values: { from: 'Cabinet Durand <contact@cabinet-durand.fr>' }, secrets: { apiKey: KEY } } })
  })

  await step('demande d\'inscription : adresse vérifiée, champ piège, e-mail de confirmation, rien d\'inscrit avant le clic', async () => {
    const bad = await subscribe({ email: 'pas une adresse' })
    check(bad.status === 422 && bad.json.data.errors.email === 'Adresse e-mail invalide.', `${bad.status} ${bad.text}`)
    const trapped = await subscribe({ email: 'robot@example.com', website: 'http://spam.example' })
    check(trapped.status === 200 && !mails().length, 'piège : e-mail envoyé')
    const r = await subscribe({ email: '  Lea@Example.com ', source: '/lettre', origin: { source: 'google', medium: 'cpc', campaign: 'printemps', click: 'gclid', clickId: 'GCLID-TEST-0001', landing: '/lettre' } })
    check(r.status === 200 && r.json.ok === true, `${r.status} ${r.text}`)
    const [mail] = await until(() => (mails().length ? mails() : null), 'e-mail de confirmation')
    check(mail.key === KEY && mail.body.to[0].email === 'lea@example.com', JSON.stringify(mail.body.to))
    check(mail.body.subject === 'Confirmez votre inscription à la lettre d\'information de Cabinet Durand' && mail.body.htmlContent.includes('Confirmer mon inscription'), mail.body.subject)
    const data = await list()
    check(data.counts.pending === 1 && data.counts.confirmed === 0, JSON.stringify(data.counts))
    const lea = data.subscribers[0]
    check(lea.email === 'lea@example.com' && lea.status === 'pending' && lea.locale === 'fr' && lea.source === '/lettre' && !lea.confirmedAt, JSON.stringify(lea))
    // Même adresse, aussitôt : même réponse, mais pas un second e-mail.
    check((await subscribe({ email: 'lea@example.com' })).status === 200 && mails().length === 1, 'second e-mail envoyé coup sur coup')
  })

  await step('lien de confirmation : faux lien refusé, bon lien une seule fois, page aux couleurs du site', async () => {
    const link = confirmLink('lea@example.com')
    check(link.startsWith(B + '/api/newsletter/confirm?id='), link)
    const forged = await page(link.slice(0, -4) + 'AAAA')
    check(forged.status === 410 && kind(forged.html) === 'invalid', `faux lien : ${forged.status} ${kind(forged.html)}`)
    check((await row('lea@example.com')).status === 'pending', 'faux lien : inscription confirmée')
    const ok = await page(link)
    check(ok.status === 200 && kind(ok.html) === 'confirmed' && ok.html.includes('Inscription confirmée') && ok.headers.get('x-robots-tag') === 'noindex' && ok.headers.get('cache-control').includes('no-store'), `${ok.status} ${kind(ok.html)}`)
    const lea = await row('lea@example.com')
    check(lea.status === 'confirmed' && lea.confirmedAt, JSON.stringify(lea))
    check(kind((await page(link)).html) === 'already', 'second clic : pas la page « déjà confirmée »')
    // Déjà inscrite : même réponse, aucun e-mail (on ne peut pas s'en servir pour savoir qui est inscrit).
    const before = mails().length
    check((await subscribe({ email: 'lea@example.com' })).status === 200 && mails().length === before, 'e-mail envoyé à une adresse déjà inscrite')
    // Aucune liste désignée : rien n'est reporté chez Brevo.
    check(!added().length && (await list()).list.set === false, 'report sans liste désignée')
  })

  await step('liste Brevo : vérifiée, inscrits déjà là reportés d\'un clic, nouveaux inscrits reportés tout seuls', async () => {
    const save = list => admin.json('/api/cms/modules/newsletter', { method: 'PUT', body: { values: { list } } })
    const test = async () => admin.json('/api/cms/modules/newsletter/test', { method: 'POST', body: {} })
    await save('99')
    let r = await test(); check(!r.ok && r.message.includes('ne connaît pas la liste nº 99'), r.message)
    await save('douze')
    r = await test(); check(!r.ok && r.message.includes('désignée par son numéro'), r.message)
    await save('12')
    r = await test(); check(r.ok && r.message.includes('« Lettre du cabinet »') && r.message.includes('Brevo'), r.message)
    const data = await list()
    check(data.list.set && data.list.provider === 'Brevo' && data.list.unsynced === 1, JSON.stringify(data.list))
    const sync = await admin.json('/api/cms/newsletter/sync', { method: 'POST', body: {} })
    check(sync.done === 1 && sync.failed === 0 && sync.remaining === 0, JSON.stringify(sync))
    const [call] = added()
    check(call.key === KEY && call.body.email === 'lea@example.com' && JSON.stringify(call.body.listIds) === '[12]' && call.body.updateEnabled === true, JSON.stringify(call.body))
    check((await row('lea@example.com')).sync.ok === true && (await list()).list.unsynced === 0, 'report non noté')
    // Une inscription en anglais : e-mail en anglais, puis report automatique à la confirmation.
    check((await subscribe({ email: 'zoe@example.com', locale: 'en' })).status === 200, 'inscription refusée')
    await until(() => mails().some(m => m.body.to[0].email === 'zoe@example.com'), 'e-mail en anglais')
    check(mails().pop().body.subject === 'Confirm your subscription to the Cabinet Durand newsletter', mails().pop().body.subject)
    const confirmed = await page(confirmLink('zoe@example.com'))
    check(kind(confirmed.html) === 'confirmed' && confirmed.html.includes('Subscription confirmed') && confirmed.html.includes('href="/en"'), kind(confirmed.html))
    await until(() => added().some(c => c.body.email === 'zoe@example.com'), 'report automatique dans la liste')
    await until(async () => (await row('zoe@example.com')).sync?.ok, 'report noté')
  })

  await step('page du site : formulaire d\'inscription, message de confirmation', async () => {
    const context = await t.newContext()
    const site = await t.newPage({ context })
    await site.goto(B + '/lettre', { waitUntil: 'networkidle0' })
    await site.type('input[name=email]', 'marc@example.com')
    await clickText(site, 'button', 'S\'inscrire')
    await site.waitForSelector('[data-newsletter-sent]')
    await until(() => mails().some(m => m.body.to[0].email === 'marc@example.com'), 'e-mail après inscription depuis la page')
    const marc = await row('marc@example.com')
    check(marc.status === 'pending' && marc.source === '/lettre', JSON.stringify(marc))
    await site.close()
  })

  await step('export et désinscription : lien propre à chaque inscrit, question posée avant de désinscrire, retrait de la liste, limite d\'envois', async () => {
    const csv = await fetch(B + '/api/cms/newsletter/export', { headers: { cookie: admin.cookie() } }).then(r => r.text())
    const lines = csv.replace('﻿', '').split('\r\n')
    check(lines.length === 3 && lines[0].startsWith('"E-mail";"État"') && csv.includes('"lea@example.com";"Inscrit";"fr"') && csv.includes('"zoe@example.com"') && !csv.includes('marc@example.com'), csv.slice(0, 400))
    check(lines.find(l => l.includes('lea@'))?.includes('"Google Ads";"printemps"'), 'provenance absente de l\'export')
    check((await fetch(B + '/api/cms/newsletter/export?status=all', { headers: { cookie: admin.cookie() } }).then(r => r.text())).includes('"marc@example.com";"En attente de confirmation"'), 'export complet')
    const link = lines.find(l => l.includes('lea@')).match(/"(http[^"]+\/api\/newsletter\/unsubscribe[^"]+)"/)[1]
    // Ouvrir le lien ne désinscrit pas : les messageries ouvrent les liens avant la personne.
    const ask = await page(link)
    check(ask.status === 200 && kind(ask.html) === 'leave' && ask.html.includes('lea@example.com') && ask.html.includes('<form method="post"'), `${ask.status} ${kind(ask.html)}`)
    check((await row('lea@example.com')).status === 'confirmed', 'désinscrite à l\'ouverture du lien')
    const left = await page(link, { method: 'POST' })
    check(left.status === 200 && kind(left.html) === 'left', `${left.status} ${kind(left.html)}`)
    const lea = await row('lea@example.com')
    check(lea.status === 'unsubscribed' && lea.unsubscribedAt, JSON.stringify(lea))
    const gone = await until(() => removed()[0], 'retrait de la liste Brevo')
    check(JSON.stringify(gone.body.emails) === '["lea@example.com"]', JSON.stringify(gone.body))
    check(kind((await page(link)).html) === 'left', 'lien rouvert après désinscription')
    // Cinq demandes en dix minutes pour ce visiteur (Léa trois fois, Zoé, Marc) : la sixième est refusée.
    const limited = await subscribe({ email: 'lea@example.com' })
    check(limited.status === 429 && limited.json.message.startsWith('Trop de demandes d\'inscription'), `${limited.status} ${limited.text}`)
    // Plus tard (compteur remis à zéro), elle peut se réinscrire : nouvel e-mail, et l'ancien lien de confirmation ne vaut plus.
    sql('delete from cms_rate_limits')
    const old = confirmLink('lea@example.com')
    check((await subscribe({ email: 'lea@example.com' })).status === 200, 'réinscription refusée')
    await until(() => mails().filter(m => m.body.to[0].email === 'lea@example.com').length === 2, 'nouvel e-mail de confirmation')
    check((await row('lea@example.com')).status === 'pending' && kind((await page(old)).html) === 'invalid', 'ancien lien encore valable')
  })

  await step('demande jamais confirmée effacée au bout de sept jours, déclencheurs de workflow', async () => {
    // Le temps passe (compteur remis à zéro, demande de Marc vieillie de huit jours) : son lien ne vaut plus, sa ligne disparaît.
    const link = confirmLink('marc@example.com')
    sql(`delete from cms_rate_limits; update cms_newsletter_subscribers set created_at = ${Date.now() - 8 * 86_400_000} where email = 'marc@example.com'`)
    check((await subscribe({ email: 'cinq@example.com' })).status === 200, 'demande refusée après la fenêtre')
    check(!(await row('marc@example.com')), 'demande de plus de sept jours gardée')
    const dead = await page(link)
    check(dead.status === 410 && kind(dead.html) === 'invalid', `lien périmé : ${dead.status}`)
    const catalog = JSON.stringify(await admin.json('/api/cms/workflows'))
    check(catalog.includes('newsletter.subscribed') && catalog.includes('subscriber.unsubscribeUrl'), 'déclencheur absent des workflows')
  })

  await step('écran : compteurs, onglets, désinscrire et effacer, droits', async () => {
    const screen = await t.newPage()
    await login(screen, B)
    check((await menuLabels(screen)).includes('Lettre d\'information'), 'entrée du menu absente')
    await screen.goto(B + '/admin/newsletter', { waitUntil: 'networkidle0' })
    const count = name => screen.$eval(`[data-newsletter-count="${name}"]`, el => el.innerText)
    check(await count('confirmed') === '1' && await count('pending') === '2', `${await count('confirmed')} / ${await count('pending')}`)
    check((await screen.$eval('[data-newsletter-list]', el => el.innerText)).includes('Tous les inscrits sont dans la liste Brevo'), 'état de la liste')
    check((await screen.$$eval('[data-newsletter-row]', rows => rows.map(r => r.querySelector('td').firstChild.textContent.trim()))).join() === 'zoe@example.com', 'onglet Inscrits')
    await screen.click('[data-newsletter-tab="pending"]')
    await screen.waitForFunction(() => document.querySelectorAll('[data-newsletter-row]').length === 2)
    // Désinscrire depuis le back-office (demande reçue par téléphone) : retirée de la liste Brevo.
    await screen.click('[data-newsletter-tab="confirmed"]')
    await screen.waitForFunction(() => document.querySelectorAll('[data-newsletter-row]').length === 1)
    await screen.click('[data-newsletter-row] button[title="Désinscrire"]')
    await says(screen, 'Personne désinscrite')
    await until(() => removed().some(c => c.body.emails[0] === 'zoe@example.com'), 'retrait de Zoé de la liste')
    check((await row('zoe@example.com')).status === 'unsubscribed', 'non désinscrite')
    await screen.click('[data-newsletter-tab="unsubscribed"]')
    await screen.waitForFunction(() => document.querySelectorAll('[data-newsletter-row]').length === 1)
    await screen.click('[data-newsletter-row] button[title="Effacer"]')
    await says(screen, 'Inscrit effacé')
    check(!(await row('zoe@example.com')), 'ligne encore présente')
    await t.shot(screen, 'lettre')
    // La liste contient des adresses e-mail : pas sans connexion.
    for (const url of ['/api/cms/newsletter', '/api/cms/newsletter/export']) check((await visitor.get(url)).status === 401, `${url} lisible sans connexion`)
    check((await visitor.post('/api/cms/newsletter/sync', {})).status === 401, 'report possible sans connexion')
    // Le journal d'activité ne garde pas l'adresse effacée.
    const log = JSON.stringify(await admin.json('/api/cms/activity'))
    check(log.includes('a effacé un inscrit') && !log.includes('zoe@example.com'), 'journal : adresse gardée, ou action absente')
  })
}
