// Mesure d'audience (Cloudflare Web Analytics) et anti-robots (Cloudflare Turnstile), joués par le faux service.
import { check, clickText, json, login, menuLabels, says, until } from '../lib/harness.mjs'
import { DUMMY_TOKEN, SECRET_REFUSED, SITE_DOWN, SITE_EMPTY, TOKEN_REFUSED } from '../lib/mock-cloudflare.mjs'

export const meta = {
  title: 'mesure d\'audience et anti-robots',
  mock: true,
  env: ({ mock }) => ({
    NUXT_CLOUDFLARE_API_URL: `${mock}/client/v4`,
    NUXT_TURNSTILE_API_URL: `${mock}/turnstile/v0`,
    NUXT_PUBLIC_TURNSTILE_SCRIPT_URL: `${mock}/turnstile/v0/api.js`,
    // En local il n'y a pas de cache à vider : chaque purge est déclarée échouée, ce qui prouve qu'elle est tentée.
    CMS_DEV_SIMULATE_PURGE_FAILURE: '1',
  }),
}

const SITE_TOKEN = '0123456789abcdef0123456789abcdef'
const SITE_TAG = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
const ACCOUNT = 'f1e2d3c4b5a697887766554433221100'
const API_TOKEN = 'jeton-api-cloudflare-lecture-9876'
const BEACON = `data-cf-beacon='{"token":"${SITE_TOKEN}"}'`
const VISITOR = { name: 'Jeanne Martin', email: 'jeanne@example.com', subject: 'devis', message: 'Bonjour, je voudrais un devis.', consent: true }

// Sommes des données d'exemple du faux service (jour i : 10 + i pages vues, 4 + i % 3 visites).
const sum = (n, f) => Array.from({ length: n }, (_, i) => f(i)).reduce((a, b) => a + b, 0)
const VIEWS_7 = sum(7, i => 10 + i), VISITS_7 = sum(7, i => 4 + (i % 3))
const VIEWS_30 = sum(30, i => 10 + i), VISITS_30 = sum(30, i => 4 + (i % 3))
const fr = n => n.toLocaleString('fr-FR')

export default async function (t) {
  const { B, step, calls } = t
  const page = await t.newPage()
  const claire = t.http(), marc = t.http(), lina = t.http(), visitor = t.http()
  const graphql = () => calls().filter(c => c.url === '/client/v4/graphql')
  const verifications = () => calls().filter(c => c.url === '/turnstile/v0/siteverify')
  const scripts = () => calls().filter(c => c.url === '/turnstile/v0/api.js')
  // Chaque envoi direct vient d'une adresse différente : la limite d'envois par visiteur ne gêne pas la suite.
  let ip = 10
  const sendForm = (body, address = `203.0.113.${ip++}`) => visitor.call('/api/forms/contact', { method: 'POST', body, headers: { 'cf-connecting-ip': address } })
  const putModule = (id, body) => claire.call(`/api/cms/modules/${id}`, { method: 'PUT', body })

  // ───────────────────────── Mesure d'audience ─────────────────────────

  await step('modules : mesure d\'audience et anti-robots à régler, avec leurs logos ; menu « Audience »', async () => {
    await login(page, B)
    check((await claire.signIn(t.admin.email, t.admin.password)).status === 200, 'connexion refusée')
    check((await menuLabels(page)).includes('Audience'), 'menu : ' + (await menuLabels(page)).join(', '))
    await clickText(page, 'aside a', 'Modules'); await says(page, 'Les fonctions ajoutées à ce site')
    const cards = await page.$$eval('main a.card', els => els.map(e => e.innerText.replace(/\s+/g, ' ')))
    check(cards.some(c => c.startsWith('Mesure d\'audience À régler')) && cards.some(c => c.startsWith('Anti-robots À régler')), cards.join(' | '))
    const logos = await page.$$eval('main a.card > span[aria-hidden] svg', els => els.map(s => s.getAttribute('fill') + '/' + s.getAttribute('stroke')))
    check(logos.includes('#F38020/none') && logos.includes('none/#F38020'), 'logos : ' + logos.join())
  })

  await step('audience non réglée : l\'écran l\'explique et mène au réglage', async () => {
    await page.goto(B + '/admin/audience', { waitUntil: 'networkidle0' })
    await says(page, 'La mesure d\'audience n\'est pas encore réglée.')
    await clickText(page, 'main a', 'Régler la mesure d\'audience')
    await says(page, 'À régler pour que le module fonctionne : Jeton de la balise, Identifiant du site, Identifiant du compte, Jeton d\'API')
    check(graphql().length === 0, 'Cloudflare appelé sans réglage')
  })
  await t.shot(page, 'audience-reglages')

  await step('site : pas de balise tant que rien n\'est réglé ; pages mises en cache', async () => {
    const r = await visitor.get('/')
    check(r.status === 200 && !r.text.includes('cloudflareinsights'), 'balise présente trop tôt')
    check(/s-maxage=\d+/.test(r.headers.get('cache-control') ?? ''), 'page d\'accueil non mise en cache : ' + r.headers.get('cache-control'))
  })

  await step('réglages invalides refusés : un jeton ne peut pas glisser de HTML dans les pages', async () => {
    const r = await putModule('analytics', { values: { siteToken: `${SITE_TOKEN}"}'><script>alert(1)</script>`, siteTag: SITE_TAG, accountId: 'pas-un-compte' } })
    check(r.status === 400 && /Jeton de la balise : uniquement des lettres/.test(r.json?.message) && /Identifiant du compte/.test(r.json?.message), `${r.status} ${r.text.slice(0, 300)}`)
    check(!(await claire.json('/api/cms/modules/analytics')).settings.find(s => s.key === 'siteToken').value, 'jeton invalide enregistré')
  })

  await step('jeton d\'API refusé par Cloudflare : message clair à la vérification', async () => {
    await page.type('input[aria-label="Jeton de la balise"]', SITE_TOKEN)
    await page.type('input[aria-label="Identifiant du site"]', SITE_TAG)
    await page.type('input[aria-label="Identifiant du compte"]', ACCOUNT)
    await page.type('input[aria-label="Jeton d\'API (lecture des statistiques)"]', TOKEN_REFUSED)
    await clickText(page, 'button', 'Vérifier la connexion')
    await says(page, 'Cloudflare refuse ce jeton d\'API ou cet identifiant de compte.')
    check(graphql().at(-1).auth === `Bearer ${TOKEN_REFUSED}`, 'jeton envoyé : ' + graphql().at(-1)?.auth)
  })

  await step('écran Audience : jeton refusé expliqué, avec le chemin du réglage', async () => {
    await page.goto(B + '/admin/audience', { waitUntil: 'networkidle0' })
    await says(page, 'Cloudflare refuse l\'accès aux statistiques.')
    await says(page, 'Vérifier les réglages')
  })

  await step('bon jeton : vérification réussie, jeton jamais renvoyé ; requête au bon compte, au bon site', async () => {
    await page.goto(B + '/admin/modules/analytics', { waitUntil: 'networkidle0' })
    await clickText(page, 'button', 'Remplacer')
    await page.type('input[aria-label="Jeton d\'API (lecture des statistiques)"]', API_TOKEN)
    await clickText(page, 'button', 'Vérifier la connexion')
    await says(page, `Connexion réussie : ${VIEWS_7} pages vues ces 7 derniers jours.`)
    const call = graphql().at(-1)
    check(call.auth === `Bearer ${API_TOKEN}`, 'jeton : ' + call.auth)
    const v = call.body.variables
    check(v.accountTag === ACCOUNT && v.siteTag === SITE_TAG && /T00:00:00Z$/.test(v.start) && call.body.query.includes('rumPageloadEventsAdaptiveGroups'), JSON.stringify(v))
    const state = await page.evaluate(() => fetch('/api/cms/modules/analytics').then(r => r.text()))
    check(!state.includes(API_TOKEN) && JSON.parse(state).configured, 'le jeton ressort par l\'API, ou module non réglé')
  })
  await t.shot(page, 'audience-verifie')

  await step('balise : sur le site dès le réglage (cache purgé), jamais dans le back-office ni dans l\'aperçu', async () => {
    // Enregistrer les réglages d'un module qui touche au site déclenche la purge du cache (ici simulée en échec).
    const saved = await putModule('analytics', { values: { siteToken: SITE_TOKEN } })
    check(saved.status === 200 && saved.json.purgeFailed === true, 'purge non tentée : ' + saved.text.slice(0, 200))
    const brevo = await putModule('brevo', { values: {} })
    check(brevo.status === 200 && !('purgeFailed' in brevo.json), 'Brevo ne touche pas au site : pas de purge')
    for (const path of ['/', '/contact']) {
      const r = await visitor.get(path)
      check(r.text.split('static.cloudflareinsights.com/beacon.min.js').length === 2 && r.text.includes(BEACON), `${path} : balise absente ou en double`)
    }
    check(!(await visitor.get('/admin')).text.includes('cloudflareinsights'), 'balise dans le back-office')
    check(!(await visitor.get('/admin/login')).text.includes('cloudflareinsights'), 'balise sur la page de connexion')
    check(!(await claire.get('/?preview=1')).text.includes('cloudflareinsights'), 'balise dans l\'aperçu')
  })

  await step('le module affiche l\'avertissement quand le cache du site n\'a pas pu être vidé', async () => {
    await page.goto(B + '/admin/modules/analytics', { waitUntil: 'networkidle0' })
    const tag = await page.$('input[aria-label="Identifiant du site"]')
    await tag.click({ clickCount: 3 }); await tag.type(SITE_TAG.toUpperCase())
    await clickText(page, 'button', 'Enregistrer')
    await says(page, 'le site peut mettre jusqu\'à une heure à en tenir compte')
    await putModule('analytics', { values: { siteTag: SITE_TAG } })
  })

  await step('écran Audience : visites, pages vues, courbe, pages les plus vues, sites d\'origine', async () => {
    await page.goto(B + '/admin/audience', { waitUntil: 'networkidle0' })
    await page.waitForSelector('[data-total="visits"]')
    const totals = await page.$$eval('[data-total]', els => els.map(e => e.textContent.trim()))
    check(totals.join() === [fr(VISITS_7), fr(VIEWS_7)].join(), 'totaux : ' + totals.join())
    const labels = await page.$$eval('main svg[role=img] text', els => els.map(e => e.textContent))
    check(labels.filter(l => /^[a-z]{3}\. \d+$/.test(l)).length === 7, 'libellés des jours : ' + labels.join(' | '))
    const pages = await page.$eval('[data-list=pages]', e => e.innerText)
    check(pages.indexOf('/services/conseil') > pages.indexOf('/') && pages.includes('64'), pages)
    const referrers = await page.$eval('[data-list=referrers]', e => e.innerText)
    check(referrers.startsWith('Accès direct') && referrers.includes('www.google.com') && !referrers.includes('cabinet-durand.fr'), referrers)
    // Survol d'un jour : la bulle donne les deux chiffres.
    const svg = await page.$('main svg[role=img]'); const box = await svg.boundingBox()
    await page.mouse.move(box.x + box.width - 14, box.y + box.height / 2)
    await page.waitForFunction(() => [...document.querySelectorAll('main div.absolute')].some(e => e.textContent.replace(/\s+/g, '').includes('Pagesvues16')))
  })
  await t.shot(page, 'audience-7-jours')

  await step('30 jours, puis statistiques gardées quelques minutes : pas de nouvel appel à Cloudflare', async () => {
    await clickText(page, 'main button', '30 jours')
    await page.waitForFunction(v => document.querySelector('[data-total="pageViews"]')?.textContent.trim() === v, {}, fr(VIEWS_30))
    check(await page.$eval('[data-total="visits"]', e => e.textContent.trim()) === fr(VISITS_30), 'visites sur 30 jours')
    const before = graphql().length
    await page.reload({ waitUntil: 'networkidle0' }); await page.waitForSelector('[data-total="visits"]')
    await clickText(page, 'main button', '30 jours'); await page.waitForFunction(v => document.querySelector('[data-total="pageViews"]')?.textContent.trim() === v, {}, fr(VIEWS_30))
    check(graphql().length === before, `${graphql().length - before} appel(s) de plus à Cloudflare`)
  })
  await t.shot(page, 'audience-30-jours')
  await step('écran Audience sur un téléphone : lisible, sans défilement horizontal', async () => {
    const phone = await t.newPage({ context: page.browserContext(), width: 390, height: 844 })
    await phone.goto(B + '/admin/audience', { waitUntil: 'networkidle0' }); await phone.waitForSelector('main svg[role=img]')
    const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    check(overflow <= 0, `défilement horizontal de ${overflow} px`)
    await t.shot(phone, 'audience-telephone')
    await phone.close()
  })

  await step('pas encore de données, puis panne de Cloudflare : expliqués simplement', async () => {
    await putModule('analytics', { values: { siteTag: SITE_EMPTY } })
    await page.goto(B + '/admin/audience', { waitUntil: 'networkidle0' })
    await says(page, 'Pas encore de visite enregistrée sur ces 7 jours.')
    await putModule('analytics', { values: { siteTag: SITE_DOWN } })
    await page.goto(B + '/admin/audience', { waitUntil: 'networkidle0' })
    await says(page, 'Les statistiques ne sont pas disponibles pour le moment.')
    await says(page, 'Réessayer')
    await putModule('analytics', { values: { siteTag: SITE_TAG } })
  })

  await step('droits : l\'éditeur voit l\'audience, le rédacteur et le visiteur non ; réglages aux administrateurs', async () => {
    for (const [who, client] of [[{ name: 'Marc Petit', email: 'marc@example.com', role: 'editor' }, marc], [{ name: 'Lina Roux', email: 'lina@example.com', role: 'writer' }, lina]]) {
      const { link } = await claire.json('/api/cms/users', { method: 'POST', body: who })
      await visitor.post(link.replace(/^.*\/admin\/invite\//, '/api/cms/invite/'), { password: 'motdepasse-test-2' })
      check((await client.signIn(who.email, 'motdepasse-test-2')).status === 200, 'connexion refusée pour ' + who.name)
    }
    const codes = async client => (await Promise.all(['/api/cms/audience', '/api/cms/modules/analytics', '/api/cms/modules/turnstile'].map(u => client.get(u)))).map(r => r.status).join()
    check(await codes(marc) === '200,403,403', 'éditeur : ' + await codes(marc))
    check(await codes(lina) === '403,403,403', 'rédacteur : ' + await codes(lina))
    check(await codes(visitor) === '401,401,401', 'visiteur : ' + await codes(visitor))
    check((await marc.json('/api/cms/audience?period=30')).stats.totals.pageViews === VIEWS_30, 'chiffres de l\'éditeur')
    check((await marc.call('/api/cms/modules/analytics', { method: 'PUT', body: { values: { siteToken: SITE_TOKEN } } })).status === 403, 'l\'éditeur change un réglage')

    const editor = await t.newPage({ context: await t.newContext() })
    await login(editor, B, { email: 'marc@example.com', password: 'motdepasse-test-2' })
    check((await menuLabels(editor)).includes('Audience'), 'menu de l\'éditeur')
    await clickText(editor, 'aside a', 'Audience'); await editor.waitForSelector('[data-total="visits"]')
    const writer = await t.newPage({ context: await t.newContext() })
    await login(writer, B, { email: 'lina@example.com', password: 'motdepasse-test-2' })
    check(!(await menuLabels(writer)).includes('Audience'), 'menu du rédacteur')
    await writer.goto(B + '/admin/audience', { waitUntil: 'networkidle0' })
    await writer.waitForFunction(() => !location.pathname.endsWith('/admin/audience')).catch(() => { throw new Error('écran Audience ouvert au rédacteur') })
  })

  // ───────────────────────── Anti-robots ─────────────────────────

  await step('anti-robots pas réglé : le formulaire marche comme avant, sans script de Cloudflare', async () => {
    check((await visitor.json('/api/turnstile')).siteKey === null, 'clé publiée trop tôt')
    const r = await sendForm({ values: VISITOR })
    check(r.status === 200, `${r.status} ${r.text.slice(0, 200)}`)
    const site = await t.newPage({ context: await t.newContext() })
    await site.goto(B + '/contact', { waitUntil: 'networkidle0' })
    check(!(await site.$('.cms-turnstile')) && scripts().length === 0, 'anti-robots affiché sans réglage')
    await site.close()
  })

  await step('clé secrète refusée par Cloudflare, puis clés de test officielles reconnues', async () => {
    await page.goto(B + '/admin/modules/turnstile', { waitUntil: 'networkidle0' })
    await page.type('input[aria-label="Clé du site"]', '1x00000000000000000000AA')
    await page.type('input[aria-label="Clé secrète"]', SECRET_REFUSED)
    await clickText(page, 'button', 'Vérifier la connexion'); await says(page, 'Cloudflare ne reconnaît pas cette clé secrète.')
    await clickText(page, 'button', 'Remplacer')
    await page.type('input[aria-label="Clé secrète"]', '1x0000000000000000000000000000000AA')
    await clickText(page, 'button', 'Vérifier la connexion'); await says(page, 'Clés de test de Cloudflare reconnues.')
    check(verifications().at(-1).body.secret === '1x0000000000000000000000000000000AA', 'clé secrète utilisée')
    const bad = await putModule('turnstile', { values: { siteKey: '0x4AAA"><script>' } })
    check(bad.status === 400 && /Clé du site/.test(bad.json?.message), 'clé du site invalide acceptée')
  })
  await t.shot(page, 'antirobots-reglages')

  await step('serveur : refusé sans jeton ou avec un jeton refusé ; accepté avec un jeton valide et l\'adresse du visiteur', async () => {
    check((await visitor.json('/api/turnstile')).siteKey === '1x00000000000000000000AA', 'clé publique non publiée')
    const before = (await claire.json('/api/cms/forms')).submissions.length
    const missing = await sendForm({ values: VISITOR })
    check(missing.status === 400 && missing.json.message === 'La vérification anti-robots n\'est pas terminée. Patientez une seconde, puis renvoyez le formulaire.', `${missing.status} ${missing.text.slice(0, 200)}`)
    const refused = await sendForm({ values: VISITOR, turnstile: 'jeton-invente' })
    check(refused.status === 400 && /a échoué/.test(refused.json.message), `${refused.status} ${refused.text.slice(0, 200)}`)
    // Champs invalides : refusés avant la vérification, le jeton n'est pas consommé.
    const n = verifications().length
    check((await sendForm({ values: { ...VISITOR, email: 'x' }, turnstile: DUMMY_TOKEN })).status === 422 && verifications().length === n, 'jeton vérifié malgré des champs invalides')
    const ok = await sendForm({ values: VISITOR, turnstile: DUMMY_TOKEN }, '203.0.113.77')
    check(ok.status === 200, `${ok.status} ${ok.text.slice(0, 200)}`)
    check(verifications().at(-1).body.remoteip === '203.0.113.77' && verifications().at(-1).body.response === DUMMY_TOKEN, JSON.stringify(verifications().at(-1).body))
    // Le champ piège garde son effet : réponse normale, rien d'enregistré.
    check((await sendForm({ values: VISITOR, website: 'http://spam.example' })).status === 200, 'piège')
    check((await claire.json('/api/cms/forms')).submissions.length === before + 1, 'un seul message devait être enregistré')
  })

  await step('page de contact : la case s\'affiche, le script n\'est chargé que là, l\'envoi passe', async () => {
    const context = await t.newContext(); const site = await t.newPage({ context })
    await site.goto(B + '/', { waitUntil: 'networkidle0' })
    check(scripts().length === 0, 'script Turnstile chargé sur l\'accueil')
    await site.goto(B + '/contact', { waitUntil: 'networkidle0' })
    await says(site, 'Vous êtes un humain')
    check(scripts().length === 1, 'script chargé ' + scripts().length + ' fois')
    await site.type('input[name=name]', VISITOR.name)
    await site.type('input[name=email]', VISITOR.email)
    await site.type('textarea[name=message]', VISITOR.message)
    await site.click('input[name=consent]')
    await t.shot(site, 'contact-antirobots')
    const n = verifications().length
    await clickText(site, 'button', 'Envoyer'); await says(site, 'Merci, votre message est bien parti.')
    check(verifications().length === n + 1 && verifications().at(-1).body.response === DUMMY_TOKEN, 'jeton non vérifié')
    await context.close()
  })

  await step('jeton expiré : redemandé tout seul ; jeton refusé : message et case relancée', async () => {
    const context = await t.newContext(); const site = await t.newPage({ context, width: 390, height: 844 })
    await site.goto(B + '/contact', { waitUntil: 'networkidle0' }); await says(site, 'Vous êtes un humain')
    await site.type('input[name=name]', VISITOR.name)
    await site.type('input[name=email]', 'jeanne.expiree@example.com')
    await site.type('textarea[name=message]', VISITOR.message)
    await site.click('input[name=consent]')
    // Expiration : la case en redemande un ; l'envoi passe ensuite.
    await site.evaluate(() => window.turnstile.__expire())
    await says(site, 'Vous êtes un humain')
    await t.shot(site, 'contact-antirobots-telephone')
    // Puis Cloudflare se met à tout refuser (clé secrète de test « échoue toujours ») : message, et case relancée.
    await putModule('turnstile', { secrets: { secretKey: '2x0000000000000000000000000000000AA' } })
    await clickText(site, 'button', 'Envoyer'); await says(site, 'La vérification anti-robots a échoué.')
    await until(() => site.evaluate(() => window.__turnstileResets >= 1), 'case relancée')
    await putModule('turnstile', { secrets: { secretKey: '1x0000000000000000000000000000000AA' } })
    await says(site, 'Vous êtes un humain')
    await clickText(site, 'button', 'Envoyer'); await says(site, 'Merci, votre message est bien parti.')
    await context.close()
  })

  await step('clé du site refusée dans la page : message au visiteur, envoi bloqué côté navigateur', async () => {
    await putModule('turnstile', { values: { siteKey: '2x00000000000000000000AB' } })
    const context = await t.newContext(); const site = await t.newPage({ context })
    await site.goto(B + '/contact', { waitUntil: 'networkidle0' })
    await says(site, 'La vérification anti-robots n\'a pas pu s\'afficher.')
    const n = calls().length
    await clickText(site, 'button', 'Envoyer'); await says(site, 'La vérification anti-robots n\'est pas terminée.')
    check(!calls().slice(n).some(c => c.url.includes('siteverify')), 'envoi parti sans jeton')
    await context.close()
  })

  await step('clé secrète retirée : l\'anti-robots s\'efface et le formulaire marche comme avant', async () => {
    const r = await putModule('turnstile', { values: { siteKey: '1x00000000000000000000AA' }, secrets: { secretKey: null } })
    check(r.status === 200 && r.json.configured === false && r.json.purgeFailed === true, r.text.slice(0, 200))
    check((await visitor.json('/api/turnstile')).siteKey === null, 'clé encore publiée')
    check((await sendForm({ values: VISITOR })).status === 200, 'formulaire bloqué sans anti-robots')
  })

  await step('mesure d\'audience retirée : plus de balise sur le site', async () => {
    await putModule('analytics', { values: { siteToken: '' } })
    check(!(await visitor.get('/')).text.includes('cloudflareinsights'), 'balise toujours présente')
  })
}
