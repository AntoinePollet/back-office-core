// Module « Suivi des erreurs et surveillance » : erreurs du serveur et du navigateur regroupées, bruit écarté, rien
// de personnel, alerte à la première apparition, Sentry ; vérification du site, alerte au deuxième échec et au
// retour, service extérieur, site fermé exprès ; écran « Surveillance », tableau de bord, droits.
import { config } from '../lib/config.mjs'
import { check, login, menuLabels, says, until } from '../lib/harness.mjs'

export const meta = {
  title: 'suivi des erreurs et surveillance du site',
  mock: true,
  env: ({ mock }) => ({ NUXT_BREVO_API_URL: `${mock}/v3`, NUXT_SENTRY_URL: `${mock}/sentry` }),
}

const BREVO = 'xkeysib-cle-de-test-12345'
const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

export default async function (t) {
  const { B, M, step, calls } = t
  const page = await t.newPage()
  const claire = t.http(), marc = t.http(), visitor = t.http()
  const mails = () => calls().filter(c => c.url === '/v3/smtp/email')
  const board = () => claire.json('/api/cms/monitoring')
  const save = (values, secrets) => claire.call('/api/cms/modules/monitoring', { method: 'PUT', body: { values, ...(secrets ? { secrets } : {}) } })
  const verify = async () => (await claire.json('/api/cms/modules/monitoring/test', { method: 'POST' }))
  const tick = async () => (await claire.json('/_cms/dev-scheduled', { method: 'POST', body: { cron: '*/5 * * * *' } }))
  const watched = body => fetch(`${M}/surveille/_regler`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  let ip = 40
  const report = (body, { agent = CHROME, from = `203.0.113.${ip++}` } = {}) => visitor.call('/api/monitoring/error', { method: 'POST', headers: { 'user-agent': agent, 'content-type': 'text/plain', [config.ipHeader]: from }, body: typeof body === 'string' ? body : JSON.stringify(body) })
  const count = async () => (await board()).errors.length

  await step('module désactivé : rien n\'est relevé, ni signal dans les pages ; activé : alertes à régler', async () => {
    await login(page, B)
    check((await claire.signIn(t.admin.email, t.admin.password)).status === 200, 'connexion refusée')
    const listed = (await claire.json('/api/cms/modules')).find(m => m.id === 'monitoring')
    check(listed && !listed.enabled && listed.category === 'security', JSON.stringify(listed))
    check((await report({ message: 'x is not a function' })).status === 404 && (await claire.get('/api/cms/monitoring')).status === 404, 'module désactivé mais servi')
    check(!(await visitor.get('/exemple-erreur')).text.includes('cms-monitoring'), 'signal posé sans le module')
    check((await visitor.get('/api/exemple-panne')).status === 500, 'la route d\'exemple ne tombe pas en panne')
    check((await claire.call('/api/cms/modules/monitoring/enabled', { method: 'PUT', body: { enabled: true } })).status === 200, 'activation refusée')
    const d = await board()
    check(d.errors.length === 0 && d.uptime.day === null && d.settings.recipients.length === 0 && d.settings.mail === false && d.down === null, JSON.stringify(d).slice(0, 300))
    check(!(await menuLabels(page)).includes('Surveillance'), 'menu affiché avant rechargement')
  })

  await step('réglages : adresses contrôlées ; vérification : le site répond, les alertes demandent un envoi d\'e-mails', async () => {
    const bad = await save({ alertEmail: 'pas une adresse', checkUrl: 'http://exemple.fr' })
    check(bad.status === 400 && /une à cinq adresses/.test(bad.json.message) && /https/.test(bad.json.message), `${bad.status} ${bad.text}`)
    check((await save({ checkUrl: `${M}/surveille` }, { dsn: 'pas-un-dsn' })).status === 200, 'réglages refusés')
    let r = await verify()
    check(!r.ok && /DSN/.test(r.message), JSON.stringify(r))
    await save({ alertEmail: 'claire@example.com, astreinte@example.com' }, { dsn: null })
    r = await verify()
    check(!r.ok && /aucun envoi d'e-mails/.test(r.message), JSON.stringify(r))
    await claire.json('/api/cms/modules/brevo', { method: 'PUT', body: { values: { from: 'Cabinet Durand <contact@cabinet-durand.fr>' }, secrets: { apiKey: BREVO } } })
    r = await verify()
    check(r.ok && /Le site répond \(200, \d+ ms\)/.test(r.message) && r.message.includes('claire@example.com, astreinte@example.com'), JSON.stringify(r))
    const seen = calls().filter(c => c.url === '/surveille').length
    check(seen >= 1, 'page surveillée non demandée')
  })

  await step('erreur du serveur : relevée sans les paramètres de l\'adresse, regroupée malgré ce qui change, alerte une seule fois', async () => {
    await claire.json('/api/cms/workflows', { method: 'POST', body: { name: 'Erreur nouvelle', trigger: { event: 'error.new' }, actions: [{ kind: 'webhook', url: `${M}/erreur-nouvelle` }] } })
    const before = mails().length
    const failed = await visitor.get('/api/exemple-panne?numero=42&email=jeanne@example.com')
    check(failed.status === 500, `${failed.status}`)
    await until(async () => await count() === 1, 'erreur enregistrée')
    let [e] = (await board()).errors
    check(e.source === 'server' && e.type === 'Error' && e.message === 'Contenu 42 illisible dans la base d\'exemple' && e.path === '/api/exemple-panne' && e.method === 'GET' && e.status === 500 && e.count === 1 && e.stack.startsWith('Error: Contenu 42') && e.stack.includes('\n    at '), JSON.stringify(e))
    check(!JSON.stringify(e).includes('jeanne@example.com'), 'paramètre de l\'adresse gardé')
    // La même erreur pour un autre contenu : la même ligne, comptée deux fois.
    await visitor.get('/api/exemple-panne?numero=7')
    await until(async () => (await board()).errors[0].count === 2, 'erreur regroupée')
    e = (await board()).errors[0]
    check((await count()) === 1 && e.message === 'Contenu 7 illisible dans la base d\'exemple', JSON.stringify(e))
    const mail = await until(() => mails().slice(before).find(m => m.body.subject === 'Nouvelle erreur sur Cabinet Durand'), 'e-mail d\'alerte')
    check(mail.body.to.map(x => x.email).join() === 'claire@example.com,astreinte@example.com' && mail.body.htmlContent.includes('sur le serveur') && mail.body.htmlContent.includes('Contenu 42 illisible') && mail.body.htmlContent.includes('/admin/monitoring'), mail.body.htmlContent)
    const hook = await until(() => calls().find(c => c.url === '/erreur-nouvelle'), 'workflow « erreur nouvelle »')
    check(hook.body.error.type === 'Error' && hook.body.error.source === 'serveur' && hook.body.error.path === '/api/exemple-panne', JSON.stringify(hook.body))
    check(mails().slice(before).filter(m => m.body.subject.startsWith('Nouvelle erreur')).length === 1 && calls().filter(c => c.url === '/erreur-nouvelle').length === 1, 'alerte répétée pour la même erreur')
    // Une page introuvable ou un accès refusé ne sont pas des pannes.
    await visitor.get('/page-qui-n-existe-pas'); await visitor.get('/api/cms/monitoring')
    check((await count()) === 1, 'erreur 404 ou 401 relevée')
  })

  await step('erreur du navigateur : relevée depuis la page, avec la famille du navigateur ; bruit, robots et excès écartés', async () => {
    const site = await t.newPage({ context: await t.newContext() })
    await site.goto(B + '/exemple-erreur?campagne=printemps', { waitUntil: 'networkidle0' })
    check(await site.evaluate(() => !!document.querySelector('meta[name="cms-monitoring"]') && !document.documentElement.innerHTML.includes('__cmsMonitoring')), 'signal absent de la page')
    await site.click('[data-casser]')
    const e = await until(async () => (await board()).errors.find(x => x.source === 'browser'), 'erreur du navigateur enregistrée')
    check(e.type === 'TypeError' && /envoyer|undefined/.test(e.message) && e.path === '/exemple-erreur' && /^Chrome \(/.test(e.browser) && e.status === null && e.count === 1, JSON.stringify(e))
    // La même erreur, cliquée de nouveau sur la même page affichée, n'est pas renvoyée ; rechargée, elle est comptée.
    await site.click('[data-casser]')
    await site.reload({ waitUntil: 'networkidle0' })
    await site.click('[data-casser]')
    await until(async () => (await board()).errors.find(x => x.source === 'browser').count === 2, 'répétition comptée')
    await site.close()
    const before = await count()
    const ignored = [
      await report({ message: 'Script error.' }), await report({ message: 'Failed to fetch' }), await report({ message: 'x', stack: 'at f (chrome-extension://abc/x.js:1:1)' }),
      await report({ message: 'Erreur vue par un robot' }, { agent: 'Mozilla/5.0 (compatible; Googlebot/2.1)' }), await report('pas du json'), await report({ message: 42 }), await report({ message: 'x'.repeat(30_000) }),
    ]
    check(ignored.every(r => r.status === 204) && (await count()) === before, `${ignored.map(r => r.status).join()} ; ${await count()} erreurs`)
    // Trop long : tronqué, jamais refusé. Adresse : sans paramètres.
    await report({ type: 'RangeError', message: `Débordement ${'z'.repeat(900)}`, stack: 's'.repeat(9000), path: 'https://site.fr/contact?email=paul@example.com' })
    const long = (await board()).errors.find(x => x.type === 'RangeError')
    check(long.message.length === 500 && long.stack.length === 4000 && long.path === '/contact', `${long.message.length} ${long.stack.length} ${long.path}`)
    // Vingt erreurs par visiteur en dix minutes : la vingt et unième est ignorée, sans que le visiteur le sache.
    const statuses = []
    for (let i = 0; i < 21; i++) statuses.push((await report({ message: `Erreur de série ${String.fromCharCode(97 + i)}` }, { from: '203.0.113.250' })).status)
    const series = (await board()).errors.filter(x => x.message.startsWith('Erreur de série')).length
    check(statuses.every(s => s === 204) && series === 20, `${series} erreurs de la série enregistrées`)
  })

  await step('Sentry : chaque erreur lui est transmise, sans adresse IP ; adresse refusée expliquée', async () => {
    await save({}, { dsn: 'https://cle123@o42.ingest.sentry.io/4507' })
    const r = await verify()
    check(r.ok && /Sentry a bien reçu/.test(r.message), JSON.stringify(r))
    const before = calls().filter(c => c.url === '/sentry/api/4507/envelope/').length
    await visitor.call('/api/exemple-panne?numero=3', { headers: { [config.ipHeader]: '198.51.100.77' } })
    const sent = await until(() => calls().filter(c => c.url === '/sentry/api/4507/envelope/')[before], 'enveloppe reçue par Sentry')
    check(sent.sentryAuth.startsWith('Sentry sentry_version=7, sentry_key=cle123, sentry_client=backoffice-core/'), sent.sentryAuth)
    const [header, item, event] = String(sent.body).trim().split('\n').map(line => JSON.parse(line))
    check(header.dsn === 'https://cle123@o42.ingest.sentry.io/4507' && item.type === 'event' && event.platform === 'node' && event.exception.values[0].value === 'Contenu 3 illisible dans la base d\'exemple' && event.exception.values[0].stacktrace.frames.length > 0, JSON.stringify(event).slice(0, 400))
    check(event.user.ip_address === null && event.request.url.endsWith('/api/exemple-panne') && !String(sent.body).includes('198.51.100.77') && event.release.startsWith('backoffice-core@'), JSON.stringify(event.request))
    await save({}, { dsn: 'https://cle123@o42.ingest.sentry.io/999' })
    const refused = await verify()
    check(!refused.ok && /Sentry a refusé l'essai \(403\)/.test(refused.message), JSON.stringify(refused))
    await save({}, { dsn: null })
  })

  await step('erreur corrigée, rouverte si elle se reproduit, effacée ; réservé à l\'administrateur', async () => {
    const e = (await board()).errors.find(x => x.source === 'server')
    const open = (await board()).open
    check((await claire.call(`/api/cms/monitoring/errors/${e.id}`, { method: 'PATCH', body: { resolved: true } })).status === 200, 'correction refusée')
    let d = await board()
    check(d.open === open - 1 && d.errors.find(x => x.id === e.id).resolvedAt, 'erreur encore ouverte')
    await visitor.get('/api/exemple-panne?numero=11')
    await until(async () => !(await board()).errors.find(x => x.id === e.id).resolvedAt, 'erreur rouverte à sa réapparition')
    d = await board()
    check(d.open === open && d.errors.find(x => x.id === e.id).count === e.count + 1, 'compteur non repris')
    check((await claire.del(`/api/cms/monitoring/errors/${e.id}`)).status === 200 && !(await board()).errors.some(x => x.id === e.id), 'effacement refusé')
    check((await claire.del('/api/cms/monitoring/errors/inconnue')).status === 404, 'erreur inconnue effacée')
    const { link } = await claire.json('/api/cms/users', { method: 'POST', body: { name: 'Marc Petit', email: 'marc@example.com', role: 'editor' } })
    await visitor.post(link.replace(/^.*\/admin\/invite\//, '/api/cms/invite/'), { password: 'motdepasse-test-2' })
    check((await marc.signIn('marc@example.com', 'motdepasse-test-2')).status === 200, 'connexion refusée')
    const codes = [(await marc.get('/api/cms/monitoring')).status, (await marc.post('/api/cms/monitoring/check')).status, (await visitor.get('/api/cms/monitoring')).status]
    check(codes.join() === '403,403,401', codes.join())
  })

  await step('le site répond : vérification gardée, service extérieur prévenu ; il tombe : alerte au deuxième échec seulement', async () => {
    await claire.json('/api/cms/workflows', { method: 'POST', body: { name: 'Site en panne', trigger: { event: 'site.down' }, actions: [{ kind: 'webhook', url: `${M}/site-en-panne` }] } })
    await claire.json('/api/cms/workflows', { method: 'POST', body: { name: 'Site revenu', trigger: { event: 'site.up' }, actions: [{ kind: 'webhook', url: `${M}/site-revenu` }] } })
    await save({}, { heartbeatUrl: `${M}/battement/jeton-secret` })
    check(!(await claire.get('/api/cms/modules/monitoring')).text.includes('jeton-secret'), 'adresse de battement renvoyée par l\'API')
    const beats = () => calls().filter(c => c.url === '/battement/jeton-secret').length
    const before = mails().length
    let r = (await tick()).ok && await board()
    check(r.uptime.checks === 1 && r.uptime.day === '100 %' && r.uptime.last.ok && r.uptime.last.status === 200 && r.down === null && beats() === 1, JSON.stringify(r.uptime))
    // La page surveillée répond 500.
    await watched({ status: 500 })
    await tick()
    r = await board()
    check(r.down && r.down.alerted === false && r.down.detail === 'La page d\'accueil répond 500.' && r.uptime.last.ok === false, JSON.stringify(r.down))
    check(!mails().slice(before).some(m => /ne répond plus/.test(m.body.subject)) && beats() === 1, 'alerte partie au premier échec, ou service extérieur prévenu pendant la panne')
    await tick()
    const down = await until(() => mails().slice(before).find(m => m.body.subject === 'Cabinet Durand ne répond plus'), 'e-mail « ne répond plus »')
    check(down.body.htmlContent.includes('La page d&#39;accueil répond 500.') && down.body.htmlContent.includes(`${M}/surveille`) && down.body.to.length === 2, down.body.htmlContent)
    const hook = await until(() => calls().find(c => c.url === '/site-en-panne'), 'workflow « le site ne répond plus »')
    check(hook.body.monitor.detail === 'La page d\'accueil répond 500.' && hook.body.monitor.url === `${M}/surveille` && hook.body.site.name === 'Cabinet Durand', JSON.stringify(hook.body))
    check((await board()).down.alerted === true, 'panne non marquée comme annoncée')
    await tick()
    check(mails().slice(before).filter(m => /ne répond plus/.test(m.body.subject)).length === 1 && calls().filter(c => c.url === '/site-en-panne').length === 1, 'alerte répétée pendant la même panne')
  })

  await step('le site revient : un e-mail, la panne et sa durée dans l\'historique ; trop lent ou fermé exprès', async () => {
    const before = mails().length
    await watched({ status: 200 })
    await tick()
    const up = await until(() => mails().slice(before).find(m => m.body.subject === 'Cabinet Durand répond de nouveau'), 'e-mail « répond de nouveau »')
    check(/La panne a duré environ \d+ minute/.test(up.body.htmlContent), up.body.htmlContent)
    await until(() => calls().some(c => c.url === '/site-revenu'), 'workflow « le site répond de nouveau »')
    let r = await board()
    check(r.down === null && r.incidents.length === 1 && r.incidents[0].to && r.incidents[0].detail === 'La page d\'accueil répond 500.' && r.uptime.checks === 5 && r.uptime.day === '40,0 %', JSON.stringify({ incidents: r.incidents, uptime: r.uptime }))
    // Une page qui met plus de cinq secondes à répondre n'est pas en bonne santé.
    await watched({ status: 200, delay: 5300 })
    await tick()
    r = await board()
    check(r.down && /a mis 5,\d s à répondre/.test(r.down.detail), JSON.stringify(r.down))
    await watched({ status: 200, delay: 0 })
    await tick()
    // Un raté isolé : ni e-mail à l'aller, ni au retour.
    check(mails().slice(before).filter(m => /ne répond plus|répond de nouveau/.test(m.body.subject)).length === 1, 'e-mail pour un échec isolé')
    // Site fermé exprès : la page d'attente n'est pas une panne, rien n'est vérifié.
    await claire.json('/api/cms/availability', { method: 'PUT', body: { mode: 'maintenance' } })
    await watched({ status: 503 })
    const checks = (await board()).uptime.checks
    const skipped = await claire.json('/api/cms/monitoring/check', { method: 'POST' })
    check(skipped.skipped === 'site fermé au public' && (await board()).uptime.checks === checks, JSON.stringify(skipped))
    await claire.json('/api/cms/availability', { method: 'PUT', body: { mode: 'online' } })
    await watched({ status: 200 })
  })

  await step('écran « Surveillance » : erreurs, pile d\'appels, « Corrigée », disponibilité, pannes ; tableau de bord ; téléphone', async () => {
    await page.goto(B + '/admin/monitoring', { waitUntil: 'networkidle0' })
    await page.waitForSelector('[data-error]')
    check((await menuLabels(page)).includes('Surveillance'), 'entrée du menu absente')
    const d = await board()
    check((await page.$$('[data-error]')).length === d.open && await page.$eval('[data-uptime="day"]', el => el.textContent) === d.uptime.day, 'erreurs ou disponibilité')
    check((await page.$$('[data-monitoring-day] span')).length === d.uptime.checks && (await page.$$('[data-incident]')).length === d.incidents.length, 'graphique ou pannes')
    check(!(await page.$('[data-monitoring-noalert]')) && !(await page.$('[data-monitoring-down]')), 'avertissement affiché à tort')
    await page.click('[data-error] button[aria-expanded]')
    await page.waitForSelector('[data-error-stack]')
    await page.click('[data-error-resolve]')
    await says(page, 'Erreur marquée comme corrigée')
    await page.waitForFunction(n => document.querySelectorAll('[data-error]').length === n, {}, d.open - 1)
    await page.click('[data-errors-tab="resolved"]')
    await page.waitForFunction(() => document.querySelectorAll('[data-error]').length === 1)
    await page.click('[data-monitoring-check]')
    await says(page, 'Vérification faite')
    check((await board()).uptime.checks === d.uptime.checks + 1, 'vérification non faite')
    const state = (await claire.json('/api/cms/dashboard')).states.find(s => s.key === 'monitoring')
    check(state && state.level === 'warning' && /erreurs? à regarder/.test(state.value) && state.to === '/admin/monitoring', JSON.stringify(state))
    check(!(await marc.json('/api/cms/dashboard')).states.some(s => s.key === 'monitoring'), 'état montré à l\'éditeur')
    await page.setViewport({ width: 390, height: 800 })
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'l\'écran déborde sur téléphone')
    await page.setViewport({ width: 1280, height: 900 })
  })
}
