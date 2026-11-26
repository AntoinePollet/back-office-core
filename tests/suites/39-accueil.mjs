// Accueil du back-office (tableau de bord) : ce qui attend la personne, ses contenus, l'état du site.
import { check, login, menuLabels } from '../lib/harness.mjs'

export const meta = { title: 'accueil du back-office : à faire, contenus récents, état du site' }

export default async function (t) {
  const { B, step } = t
  const admin = t.http(), visitor = t.http()
  const board = () => admin.json('/api/cms/dashboard')
  const keys = list => list.map(i => i.key)
  const ids = {}
  let page

  await step('site neuf : rien n\'attend, état du site, modules déclarés à régler', async () => {
    check((await admin.signIn(t.admin.email, t.admin.password)).status === 200, 'connexion refusée')
    const d = await board()
    check(d.recent.length === 0 && d.waiting.total === 0, JSON.stringify(d.recent))
    // Les modules déclarés dans cms.config.ts mais pas encore réglés ; les modules d'envoi d'e-mails ont leur propre ligne.
    check(JSON.stringify(keys(d.tasks)) === JSON.stringify(['module-analytics', 'module-turnstile', 'module-stripe']), JSON.stringify(keys(d.tasks)))
    check(d.tasks[0].level === 'warning' && d.tasks[0].to === '/admin/modules/analytics' && d.tasks[0].detail.startsWith('Il manque'), JSON.stringify(d.tasks[0]))
    const states = Object.fromEntries(d.states.map(s => [s.key, s]))
    check(states.availability.level === 'ok' && states.availability.value === 'En ligne', JSON.stringify(states.availability))
    check(states.backups.level === 'warning' && states.backups.to === '/admin/backups', JSON.stringify(states.backups))
    check(states.mail.level === 'warning' && states.mail.value.startsWith('Non réglé'), JSON.stringify(states.mail))
    check(JSON.stringify(d.create.map(c => c.type)) === JSON.stringify(['services', 'categories', 'testimonials', 'products', 'documents']) && d.create[0].label === 'service' && d.create[0].to === '/admin/services/new', JSON.stringify(d.create))
    check(d.audience === true && d.health === true, 'audience ou santé non proposées')
    check(JSON.stringify(keys(d.figures)) === JSON.stringify(['messages', 'payments']) && d.figures[0].value === '0', JSON.stringify(d.figures))
    check((await visitor.get('/api/cms/dashboard')).status === 401, 'accueil lisible sans connexion')
  })

  await step('contenus : brouillons et modifications en attente, modifié récemment', async () => {
    const create = async (type, body) => (await admin.json(`/api/cms/entries/${type}`, { method: 'POST', body })).id
    ids.online = await create('services', { shared: { onQuote: true }, locales: { fr: { values: { title: 'Droit des affaires' } } }, publish: ['fr'] })
    ids.draft = await create('services', { shared: { onQuote: true }, locales: { fr: { values: { title: 'Droit social' } } } })
    // Sans brouillons, enregistrer c'est publier : une catégorie n'attend jamais de publication.
    ids.category = await create('categories', { locales: { fr: { values: { name: 'Entreprises' } } } })
    let d = await board()
    check(JSON.stringify(d.waiting.items.map(e => e.title)) === JSON.stringify(['Droit social']) && d.waiting.total === 1 && d.waiting.items[0].status === 'draft', JSON.stringify(d.waiting))
    check(JSON.stringify(d.recent.map(e => e.title)) === JSON.stringify(['Entreprises', 'Droit social', 'Droit des affaires']), JSON.stringify(d.recent.map(e => e.title)))
    const [latest] = d.recent
    check(latest.typeLabel === 'Catégories' && latest.to === `/admin/categories/${ids.category}` && latest.mine === true && latest.by === 'Claire Durand', JSON.stringify(latest))
    // Une page en ligne modifiée sans être republiée attend aussi.
    await admin.json(`/api/cms/entries/services/${ids.online}`, { method: 'PUT', body: { locales: { fr: { values: { title: 'Droit des affaires et des sociétés' } } } } })
    d = await board()
    check(JSON.stringify(d.waiting.items.map(e => `${e.title}:${e.status}`)) === JSON.stringify(['Droit des affaires et des sociétés:changed', 'Droit social:draft']), JSON.stringify(d.waiting.items))
    await admin.json(`/api/cms/entries/services/${ids.draft}`, { method: 'PUT', body: { locales: { fr: { values: { title: 'Droit social' } } }, publish: ['fr'] } })
    check((await board()).waiting.total === 1, 'contenu publié encore en attente')
  })

  await step('à faire : message non lu, adresse introuvable, publication programmée, site fermé', async () => {
    const sent = await visitor.post('/api/forms/contact', { values: { name: 'Paul Martin', email: 'paul@example.com', subject: 'devis', message: 'Bonjour, je souhaite un devis.', consent: true } })
    check(sent.status === 200, `formulaire : ${sent.status} ${sent.text}`)
    await fetch(B + '/ancienne-page', { headers: { 'user-agent': 'Mozilla/5.0 (Macintosh) Safari/605.1.15' } })
    const at = new Date(Date.now() + 3 * 86_400_000)
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(at)
    const planned = await admin.put(`/api/cms/entries/services/${ids.online}/schedule`, { action: 'publish', locales: ['fr'], date: day, time: '09:00' })
    check(planned.status === 200, `programmation : ${planned.status} ${planned.text}`)
    await admin.json('/api/cms/availability', { method: 'PUT', body: { mode: 'construction' } })
    const d = await board()
    const task = key => d.tasks.find(t => t.key === key)
    check(task('messages')?.count === 1 && task('messages').label === '1 message reçu non lu' && task('messages').to === '/admin/forms' && task('messages').level === 'todo', JSON.stringify(task('messages')))
    check(task('not-found')?.count === 1 && task('not-found').detail.includes('/ancienne-page') && task('not-found').to === '/admin/redirections', JSON.stringify(task('not-found')))
    check(task('scheduled')?.count === 1 && task('scheduled').label === '1 publication programmée' && task('scheduled').detail.includes('à 09:00'), JSON.stringify(task('scheduled')))
    check(d.figures.find(f => f.key === 'messages').value === '1', 'chiffre des messages')
    const closed = d.states.find(s => s.key === 'availability')
    check(closed.level === 'warning' && closed.value === 'Fermé au public (en construction)', JSON.stringify(closed))
    await admin.json('/api/cms/availability', { method: 'PUT', body: { mode: 'online' } })
  })

  await step('écran : on y arrive après la connexion, entrée du menu, lignes cliquables', async () => {
    page = await t.newPage()
    await login(page, B)
    await page.waitForSelector('[data-dashboard]')
    check(new URL(page.url()).pathname === '/admin', page.url())
    check((await page.$eval('h1', el => el.innerText)) === 'Bonjour Claire', 'salutation')
    check((await menuLabels(page))[0] === 'Tableau de bord', 'première entrée du menu : ' + (await menuLabels(page))[0])
    const active = () => page.$$eval('aside .menu a.menu-active, aside .menu a[aria-current="page"]', links => links.map(a => a.textContent.trim()))
    check((await active()).join() === 'Tableau de bord', 'entrée active : ' + (await active()).join())
    const tasks = await page.$$eval('[data-dashboard-task]', items => items.map(li => li.dataset.dashboardTask))
    check(tasks.includes('messages') && tasks.includes('scheduled') && tasks.includes('module-stripe'), tasks.join())
    check((await page.$$eval('[data-dashboard-waiting] li', l => l.length)) === 1 && (await page.$$eval('[data-dashboard-recent] li', l => l.length)) === 3, 'listes de contenus')
    // La sauvegarde de repli se fait à la visite d'un administrateur : son état a pu passer de « jamais » à « à jour ».
    const states = await page.$$eval('[data-dashboard-state]', l => l.map(e => `${e.dataset.dashboardState}:${e.dataset.level}`))
    check(states[0] === 'availability:ok' && /^backups:(ok|warning)$/.test(states[1]) && states[2] === 'mail:warning' && states.length === 3, 'état du site : ' + states.join())
    // Santé du site et audience : lues après l'affichage.
    await page.waitForFunction(() => /corriger|Rien de certain/.test(document.querySelector('[data-dashboard-health]')?.innerText ?? ''))
    await page.waitForFunction(() => document.querySelector('[data-dashboard-figure="audience"]')?.innerText.includes('pas encore réglée'))
    await t.shot(page, 'accueil')
    // Une ligne mène à l'écran qui la détaille ; l'entrée du menu n'est active que sur l'accueil.
    await page.click('[data-dashboard-task="messages"] a')
    await page.waitForFunction(() => location.pathname === '/admin/forms')
    await page.waitForSelector('main h1')
    await page.waitForFunction(() => [...document.querySelectorAll('aside .menu a.menu-active')].map(a => a.textContent.trim().replace(/\d+$/, '')).join() === 'Messages reçus')
      .catch(async () => { throw new Error('entrées actives sur « Messages reçus » : ' + (await active()).join()) })
    await page.goto(B + '/admin', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-dashboard-create]')
    await page.click('[data-dashboard-create]')
    await page.click('[data-dashboard] .dropdown-content a[href="/admin/services/new"]')
    await page.waitForFunction(() => location.pathname === '/admin/services/new')
  })

  await step('téléphone : rien ne déborde', async () => {
    await page.setViewport({ width: 390, height: 800 })
    await page.goto(B + '/admin', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-dashboard-recent]')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check(overflow <= 0, `débordement horizontal de ${overflow}px`)
    await t.shot(page, 'accueil-telephone')
  })
}
