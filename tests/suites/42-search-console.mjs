// Module Google Search Console (lecture) : réglages, vérification de la connexion, refus traduits, rapport (totaux,
// recherches, pages regroupées par adresse du site), mémoire de cinq minutes, droits, écran « Recherche Google »,
// colonnes de « Pages et titres », chiffre du tableau de bord.
import { check, login, menuLabels, says, until } from '../lib/harness.mjs'
import { SC_DOWN, SC_EMPTY, SC_UNKNOWN, SC_UNVERIFIED, SECRET_UNKNOWN, TOKEN_REVOKED, TOKEN_WITHOUT_WEBMASTERS } from '../lib/mock-google.mjs'

export const meta = {
  title: 'Search Console : réglages, recherches, clics et position par page',
  mock: true,
  env: ({ mock }) => ({ NUXT_GOOGLE_SEARCH_CONSOLE_API_URL: `${mock}/google-sc/webmasters/v3`, NUXT_GOOGLE_OAUTH_TOKEN_URL: `${mock}/google/token` }),
}

const CLIENT = '1234-abcd.apps.googleusercontent.com'
const SECRET = 'GOCSPX-secret-du-client'
const TOKEN = 'jeton-recherche-1'
const PROPERTY = 'https://cabinet-durand.fr/'

export default async function (t) {
  const { B, step, calls } = t
  const page = await t.newPage()
  const claire = t.http(), marc = t.http(), lina = t.http(), visitor = t.http()
  const queries = () => calls().filter(c => c.url.endsWith('/searchAnalytics/query'))
  const save = (values, secrets) => claire.call('/api/cms/modules/search-console', { method: 'PUT', body: { values, ...(secrets ? { secrets } : {}) } })
  const verify = async () => (await claire.json('/api/cms/modules/search-console/test', { method: 'POST' }))
  const report = (days = 28, client = claire) => client.call(`/api/cms/search-console?days=${days}`)

  await step('module désactivé : ni menu ni chiffres ; une fois activé, il reste à régler', async () => {
    await login(page, B)
    check((await claire.signIn(t.admin.email, t.admin.password)).status === 200, 'connexion refusée')
    const listed = (await claire.json('/api/cms/modules')).find(m => m.id === 'search-console')
    check(listed && !listed.enabled && listed.category === 'seo' && listed.canEnable, JSON.stringify(listed))
    check((await report()).status === 404, 'chiffres servis alors que le module est désactivé')
    check(!(await menuLabels(page)).some(x => x.includes('Recherche Google')), 'menu affiché')
    check((await claire.json('/api/cms/dashboard')).searchConsole === false, 'chiffre annoncé sur l\'accueil')
    check((await claire.call('/api/cms/modules/search-console/enabled', { method: 'PUT', body: { enabled: true } })).status === 200, 'activation refusée')
    const empty = (await report()).json
    check(empty.state === 'unconfigured', JSON.stringify(empty))
    check(queries().length === 0, 'Google appelé sans réglages')
  })

  await step('réglages : propriété mal écrite refusée, secrets jamais renvoyés', async () => {
    for (const property of ['cabinet-durand.fr', 'sc-domain:cabinet', 'https://cabinet-durand.fr/?page=2']) {
      const bad = await save({ property, clientId: CLIENT })
      check(bad.status === 400 && /sc-domain:exemple\.fr/.test(bad.json.message), `${property} : ${bad.status} ${bad.text}`)
    }
    const badClient = await save({ property: PROPERTY, clientId: 'pas-un-client' })
    check(badClient.status === 400 && /apps\.googleusercontent\.com/.test(badClient.json.message), badClient.text)
    const saved = (await save({ property: 'https://cabinet-durand.fr', clientId: CLIENT }, { clientSecret: SECRET, refreshToken: TOKEN })).json
    check(saved.configured && saved.enabled, JSON.stringify(saved).slice(0, 300))
    const text = (await claire.get('/api/cms/modules/search-console')).text
    check(!text.includes(SECRET) && !text.includes(TOKEN), 'un secret est renvoyé par l\'API')
  })

  await step('vérifier la connexion : propriété nommée avec sa barre finale, niveau d\'accès', async () => {
    const r = await verify()
    check(r.ok && r.message === 'Connexion réussie à la propriété « https://cabinet-durand.fr/ » (accès complet).', JSON.stringify(r))
    const token = calls().find(c => c.url === '/google/token')
    check(token.body.client_id === CLIENT && token.body.client_secret === SECRET && token.body.refresh_token === TOKEN, JSON.stringify(token.body))
    const call = calls().filter(c => c.url.startsWith('/google-sc/')).pop()
    check(call.url === `/google-sc/webmasters/v3/sites/${encodeURIComponent(PROPERTY)}` && call.auth === `Bearer acces-${TOKEN}`, JSON.stringify(call))
  })

  await step('refus de Google traduits : propriété inconnue ou non validée, jeton sans l\'autorisation ou révoqué, secret inconnu, panne', async () => {
    await save({ property: SC_UNKNOWN })
    let r = await verify()
    check(!r.ok && /n'a pas accès à cette propriété/.test(r.message), JSON.stringify(r))
    const refused = (await report()).json
    check(refused.state === 'refused' && /barre finale/.test(refused.message), JSON.stringify(refused))
    await save({ property: SC_UNVERIFIED })
    r = await verify()
    check(!r.ok && /n'est pas validée/.test(r.message), JSON.stringify(r))
    await save({ property: PROPERTY }, { refreshToken: TOKEN_WITHOUT_WEBMASTERS })
    r = await verify()
    check(!r.ok && /webmasters\.readonly/.test(r.message), JSON.stringify(r))
    await save({}, { refreshToken: TOKEN_REVOKED })
    r = await verify()
    check(!r.ok && /expiré ou a été révoqué/.test(r.message), JSON.stringify(r))
    await save({}, { refreshToken: TOKEN, clientSecret: SECRET_UNKNOWN })
    r = await verify()
    check(!r.ok && /identifiant client OAuth ou son secret/.test(r.message), JSON.stringify(r))
    await save({ property: SC_DOWN }, { clientSecret: SECRET })
    r = await verify()
    check(!r.ok && /ne répond pas/.test(r.message), JSON.stringify(r))
    const down = (await report()).json
    check(down.state === 'unavailable', JSON.stringify(down))
    await save({ property: SC_EMPTY })
    const none = (await report()).json
    check(none.state === 'ok' && none.report.totals.impressions === 0 && none.report.queries.length === 0 && none.report.pages.length === 0 && none.report.days.length === 28, JSON.stringify(none).slice(0, 300))
    await save({ property: PROPERTY })
  })

  await step('rapport : totaux, recherches, pages regroupées par adresse du site, un point par jour', async () => {
    const before = queries().length
    const r = (await report(28)).json
    check(r.state === 'ok' && r.property === PROPERTY && r.days === 28, JSON.stringify(r).slice(0, 200))
    check(r.report.totals.clicks === 42 && r.report.totals.impressions === 900, JSON.stringify(r.report.totals))
    check(JSON.stringify(r.report.queries.map(q => `${q.key}:${q.clicks}`)) === JSON.stringify(['avocat droit des affaires lyon:30', 'cabinet durand:12', 'créer une sarl:0']), JSON.stringify(r.report.queries))
    // Les deux écritures de la même page (avec « www » et barre finale) n'en font qu'une : position pondérée par les affichages.
    // À clics égaux, la page la plus affichée passe devant.
    const service = r.report.pages.find(p => p.path === '/services/droit-des-affaires')
    check(JSON.stringify(r.report.pages.map(p => p.path)) === JSON.stringify(['/services/droit-des-affaires', '/', '/ancienne-page']), JSON.stringify(r.report.pages.map(p => p.path)))
    check(service.clicks === 20 && service.impressions === 500 && service.position === 5, JSON.stringify(service))
    check(r.report.days.length === 28 && r.report.days[0].date === r.from && r.report.days.at(-1).date === r.to && r.report.days[0].clicks === 10 && r.report.days[1].clicks === 0 && r.report.days.at(-1).clicks === 32, JSON.stringify(r.report.days.slice(0, 2)))
    // La période s'arrête avant-hier au plus tard : Google n'a pas encore les derniers jours.
    check(Date.now() - Date.parse(`${r.to}T00:00:00Z`) >= 2 * 86_400_000 - 43_200_000, `dernier jour : ${r.to}`)
    const sent = queries().slice(before)
    check(sent.length === 4 && sent.every(c => c.body.startDate === r.from && c.body.endDate === r.to && c.body.type === 'web'), JSON.stringify(sent.map(c => c.body)))
    check(JSON.stringify(sent.map(c => c.body.dimensions?.[0] ?? 'totaux').sort()) === JSON.stringify(['date', 'page', 'query', 'totaux']), JSON.stringify(sent.map(c => c.body.dimensions)))
  })

  await step('mémoire de cinq minutes : un second affichage ne rappelle pas Google ; une autre période, si', async () => {
    const before = queries().length
    const again = (await report(28)).json
    check(again.state === 'ok' && queries().length === before, `${queries().length - before} appels pour un rapport déjà lu`)
    const week = (await report(7)).json
    check(week.days === 7 && week.report.days.length === 7 && queries().length === before + 4, `${queries().length - before} appels`)
    check((await report('n\'importe quoi')).json.days === 28, 'période inconnue non ramenée à 28 jours')
  })

  await step('droits : l\'éditeur lit les chiffres, le rédacteur et le visiteur non', async () => {
    for (const [who, client] of [[{ name: 'Marc Petit', email: 'marc@example.com', role: 'editor' }, marc], [{ name: 'Lina Roux', email: 'lina@example.com', role: 'writer' }, lina]]) {
      const { link } = await claire.json('/api/cms/users', { method: 'POST', body: who })
      await visitor.post(link.replace(/^.*\/admin\/invite\//, '/api/cms/invite/'), { password: 'motdepasse-test-2' })
      check((await client.signIn(who.email, 'motdepasse-test-2')).status === 200, 'connexion refusée pour ' + who.name)
    }
    const codes = [(await report(28, marc)).status, (await report(28, lina)).status, (await report(28, visitor)).status]
    check(codes.join() === '200,403,401', codes.join())
    check((await marc.call('/api/cms/modules/search-console', { method: 'PUT', body: { values: { property: PROPERTY } } })).status === 403, 'l\'éditeur change les réglages')
    check((await marc.json('/api/cms/dashboard')).searchConsole === true && (await lina.json('/api/cms/dashboard')).searchConsole === false, 'chiffre de l\'accueil mal réservé')
  })

  await step('écran « Recherche Google » : totaux, recherches, pages ; la page connue mène à son onglet Référencement', async () => {
    const id = (await claire.json('/api/cms/entries/services', { method: 'POST', body: { shared: { onQuote: true }, locales: { fr: { values: { title: 'Droit des affaires' } } }, publish: ['fr'] } })).id
    await page.goto(B + '/admin/search-console', { waitUntil: 'networkidle0' })
    await page.waitForSelector('[data-sc-state="ok"]')
    check((await menuLabels(page)).some(x => x.includes('Recherche Google')), 'entrée du menu absente')
    const totals = await page.$$eval('[data-sc-total]', els => Object.fromEntries(els.map(e => [e.dataset.scTotal, e.textContent.trim()])))
    check(totals.clicks === '42' && totals.impressions === '900' && totals.ctr === '4,7 %' && totals.position === '6,5', JSON.stringify(totals))
    check((await page.$$('[data-sc-query]')).length === 3 && (await page.$$('[data-sc-days] span')).length === 28, 'recherches ou jours manquants')
    const known = () => page.$$eval('[data-sc-page] a[href^="/admin/"]', els => els.map(a => `${a.textContent.trim()}|${a.getAttribute('href')}`))
    await until(async () => (await known()).length === 2, 'liens vers l\'onglet Référencement')
    check((await known())[0] === `Droit des affaires|/admin/services/${id}?tab=seo` && (await known())[1].startsWith('Accueil|/admin/'), (await known()).join())
    const external = await page.$$eval('[data-sc-page] a[target="_blank"]', els => els.map(a => a.href))
    check(external.join() === 'https://cabinet-durand.fr/services/droit-des-affaires,https://cabinet-durand.fr/,https://cabinet-durand.fr/ancienne-page', external.join())
    await page.click('[data-sc-period="7"]')
    await page.waitForFunction(() => document.querySelectorAll('[data-sc-days] span').length === 7)
    // Largeur de téléphone : rien ne déborde.
    await page.setViewport({ width: 390, height: 800 })
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'l\'écran déborde sur téléphone')
    await page.setViewport({ width: 1280, height: 900 })
  })

  await step('« Pages et titres » : clics et position de chaque page, tri ; tableau de bord : clics depuis Google', async () => {
    await page.goto(B + '/admin/seo', { waitUntil: 'networkidle0' })
    await page.waitForSelector('[data-seo-cell="clicks"]')
    const rows = () => page.$$eval('[data-seo-row]', trs => trs.map(tr => `${tr.querySelector('a').textContent.trim()}:${tr.querySelector('[data-seo-cell="clicks"]').textContent.trim()}:${tr.querySelector('[data-seo-cell="position"]').textContent.trim()}`))
    const all = await rows()
    check(all.includes('Droit des affaires:20:5,0') && all.includes('Accueil:20:2,0'), all.join(' | '))
    await page.click('[data-seo-sort="position"]')
    check((await rows())[0] === 'Accueil:20:2,0', 'tri par position : ' + (await rows()).join(' | '))
    await page.goto(B + '/admin', { waitUntil: 'networkidle0' })
    await says(page, 'Clics depuis Google')
    await until(async () => (await page.$eval('[data-dashboard-figure="search-console"]', el => el.innerText)).includes('42'), 'chiffre de l\'accueil')
  })

  await step('rédactrice : « Pages et titres » sans les chiffres de Google, écran refusé', async () => {
    const context = await t.newContext()
    const other = await t.newPage({ context })
    await login(other, B, { email: 'lina@example.com', password: 'motdepasse-test-2' })
    const before = queries().length
    await other.goto(B + '/admin/seo', { waitUntil: 'networkidle0' })
    await other.waitForSelector('[data-seo-row]')
    check(!(await other.$('[data-seo-cell="clicks"]')), 'chiffres montrés à la rédactrice')
    check(!(await menuLabels(other)).some(x => x.includes('Recherche Google')), 'menu montré à la rédactrice')
    check(queries().length === before, 'Google appelé pour la rédactrice')
    await context.close()
  })
}
