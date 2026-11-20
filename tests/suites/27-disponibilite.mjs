// Disponibilité du site : en construction, en maintenance, retour en ligne. Pages d'attente, aperçu, robots, écran du back-office.
import { check, clickText, login, menuLabels, says, until } from '../lib/harness.mjs'

export const meta = {
  title: 'disponibilité du site : construction, maintenance, pages d\'attente',
  // En local il n'y a pas de cache à vider : chaque purge est déclarée échouée, ce qui prouve qu'elle est tentée.
  env: () => ({ CMS_DEV_SIMULATE_PURGE_FAILURE: '1' }),
}

const A = '/api/cms/availability'
const MARC = { name: 'Marc Petit', email: 'marc@example.com', password: 'mot-de-passe-de-marc', role: 'editor' }

export default async function (t) {
  const { B, step } = t
  const claire = t.http(), marc = t.http(), anon = t.http()

  /** Une page du site vue par un visiteur. */
  const visit = async (url, client = anon, method = 'GET') => {
    const r = await client.call(url, { method })
    return { status: r.status, text: r.text, closed: r.text.match(/data-cms-closed="(\w+)"/)?.[1] ?? null, h: name => r.headers.get(name) ?? '' }
  }
  const setting = (mode, pages = {}) => ({ mode, pages })
  const journal = async () => (await claire.json('/api/cms/activity?limit=20&category=settings')).items

  await step('préparation : administratrice, éditeur', async () => {
    check((await claire.signIn(t.admin.email, t.admin.password)).status === 200, 'connexion de l\'administratrice refusée')
    const { link } = await claire.json('/api/cms/users', { method: 'POST', body: { name: MARC.name, email: MARC.email, role: MARC.role } })
    check((await anon.post(`/api/cms/invite/${link.replace(/^.*\/admin\/invite\//, '')}`, { password: MARC.password })).status === 200, 'invitation')
    check((await marc.signIn(MARC.email, MARC.password)).status === 200, 'connexion de l\'éditeur refusée')
  })

  await step('par défaut, le site est en ligne', async () => {
    check((await claire.json(A)).mode === 'online', 'état initial')
    const home = await visit('/')
    check(home.status === 200 && !home.closed, `accueil : ${home.status} ${home.closed}`)
  })

  await step('droits : lecture de l\'état pour tous les comptes, réglage réservé à l\'administrateur', async () => {
    check(JSON.stringify(await marc.json(A)) === '{"mode":"online"}', 'l\'éditeur reçoit le réglage complet : ' + JSON.stringify(await marc.json(A)))
    check((await anon.get(A)).status === 401, 'lecture sans connexion')
    check((await marc.put(A, setting('maintenance'))).status === 403, 'un éditeur a fermé le site')
    check((await anon.put(A, setting('maintenance'))).status === 401, 'un visiteur a fermé le site')
    check((await claire.put(A, setting('ferme'))).status === 400, 'état inconnu accepté')
    check((await claire.put(A, setting('maintenance', { maintenance: { template: 'video' } }))).status === 400, 'modèle inconnu accepté')
    check((await claire.json(A)).mode === 'online', 'un refus a changé l\'état')
  })

  await step('maintenance : page d\'attente en 503, textes saisis, le reste du site servi', async () => {
    const r = await claire.put(A, setting('maintenance', {
      maintenance: { template: 'color', imageId: null, contact: 'contact@cabinet-durand.fr', texts: { fr: { title: 'Petite pause <technique>', message: 'Nous revenons vite.' } } },
    }))
    check(r.status === 200 && r.json.purgeFailed === true, 'enregistrement ou purge non tentée : ' + r.text.slice(0, 200))
    const home = await visit('/')
    check(home.status === 503 && home.closed === 'maintenance', `accueil : ${home.status} ${home.closed}`)
    check(home.h('retry-after') === '3600' && home.h('cache-control') === 'private, no-store', `en-têtes : ${home.h('retry-after')} / ${home.h('cache-control')}`)
    check(home.text.includes('Petite pause &lt;technique&gt;') && home.text.includes('Nous revenons vite.') && home.text.includes('href="mailto:contact@cabinet-durand.fr"'), 'textes absents')
    check(home.text.includes('data-template="color"') && !home.text.includes('noindex'), 'modèle ou robots')
    const page = await visit('/services')
    check(page.status === 503 && page.closed === 'maintenance', 'autre page servie : ' + page.status)
    // Anglais sans texte saisi : le titre français, champ par champ.
    const en = await visit('/en')
    check(en.closed === 'maintenance' && en.text.includes('lang="en"') && en.text.includes('Petite pause'), 'page anglaise')
    check((await visit('/', anon, 'HEAD')).status === 503, 'HEAD')
    // Ce qui n'est pas une page du site reste servi.
    for (const url of ['/admin/login', '/api/content/home', '/api/cms/theme', '/robots.txt', '/sitemap.xml'])
      check((await visit(url)).status === 200 && !(await visit(url)).closed, url + ' : ' + (await visit(url)).status)
    check((await visit('/robots.txt')).text.includes('Allow: /'), 'une maintenance ne doit pas interdire l\'exploration')
  })

  await step('aperçu : la personne connectée et le lien partagé voient le vrai site, pas un visiteur', async () => {
    check((await visit('/?preview=1')).closed === 'maintenance', 'aperçu sans connexion')
    check((await visit('/?preview=nimportequoi-mais-assez-long')).closed === 'maintenance', 'jeton inventé accepté')
    const own = await visit('/?preview=1', claire)
    check(own.status === 200 && !own.closed, 'administratrice en aperçu : ' + own.status)
    check((await visit('/', claire)).closed === 'maintenance', 'sans aperçu, l\'administratrice voit la page d\'attente comme tout le monde')
    const shared = await claire.json('/api/cms/preview-links', { method: 'POST', body: { label: 'Client', days: 1 } })
    const viaLink = await visit(new URL(shared.url).pathname + new URL(shared.url).search)
    check(viaLink.status === 200 && !viaLink.closed, 'lien partagé : ' + viaLink.status)
  })

  await step('construction : 200, noindex, robots.txt interdit l\'exploration', async () => {
    check((await claire.put(A, setting('construction'))).status === 200, 'enregistrement')
    const home = await visit('/')
    check(home.status === 200 && home.closed === 'construction', `accueil : ${home.status} ${home.closed}`)
    check(home.h('x-robots-tag') === 'noindex' && home.text.includes('<meta name="robots" content="noindex">'), 'noindex absent')
    check(home.text.includes('Site en construction') && home.text.includes('data-template="simple"'), 'texte proposé ou modèle')
    check((await visit('/en/services')).text.includes('Website under construction'), 'texte anglais proposé')
    const robots = await visit('/robots.txt')
    check(robots.text.includes('Disallow: /\n') && !robots.text.includes('Allow: /'), 'robots.txt : ' + robots.text)
  })

  await step('journal d\'activité : changements d\'état et pages modifiées', async () => {
    const lines = await journal()
    const summaries = lines.map(l => l.summary).join(' | ')
    check(lines.some(l => l.action === 'availability.changed' && l.summary.includes('« Maintenance »')), summaries)
    check(lines.some(l => l.action === 'availability.changed' && l.summary.includes('« En construction »')), summaries)
    check(lines.some(l => l.action === 'availability.pages_updated'), summaries)
    check(lines.filter(l => l.action.startsWith('availability')).every(l => l.link === '/admin/availability'), 'lien du journal')
  })

  const page = await t.newPage()
  await step('back-office : menu, bandeau « Site fermé », aperçu en direct', async () => {
    await login(page, B)
    check((await menuLabels(page)).includes('Disponibilité'), 'entrée de menu absente')
    await page.goto(B + '/admin/availability', { waitUntil: 'networkidle0' })
    await page.waitForSelector('[data-cms-site-closed]')
    const viewSite = await page.$$eval('header a', links => links.find(a => a.textContent.includes('Voir le site'))?.getAttribute('href'))
    check(viewSite === '/?preview=1', '« Voir le site » : ' + viewSite)
    const frame = () => page.$eval('[data-cms-closed-preview]', f => f.getAttribute('srcdoc'))
    check((await frame()).includes('Site en construction'), 'aperçu initial')
    await t.shot(page, 'construction')
    // Onglet de la page de maintenance : le titre enregistré.
    await clickText(page, 'button[role=tab]', 'Maintenance')
    await until(async () => (await frame()).includes('Petite pause'), 'aperçu de la maintenance')
    const title = await page.$('input[maxlength="120"]')
    await title.evaluate(e => { e.focus(); e.select() }); await title.type('On revient lundi')
    await until(async () => (await frame()).includes('On revient lundi'), 'aperçu mis à jour pendant la saisie')
    await clickText(page, 'label', 'Sobre')
    await until(async () => (await frame()).includes('data-template="simple"'), 'modèle dans l\'aperçu')
  })

  await step('back-office : passer en maintenance depuis l\'écran, puis remettre en ligne', async () => {
    await clickText(page, '[data-cms-mode]', 'Maintenance')
    page.once('dialog', d => d.accept())
    await clickText(page, 'button', 'Enregistrer')
    await says(page, 'Le site est maintenant « Maintenance »')
    const home = await visit('/')
    check(home.status === 503 && home.text.includes('On revient lundi') && home.text.includes('data-template="simple"'), 'page servie : ' + home.status)
    await t.shot(page, 'maintenance')
    await clickText(page, '[data-cms-mode]', 'En ligne')
    await clickText(page, 'button', 'Enregistrer')
    await says(page, 'Site remis en ligne')
    await page.waitForFunction(() => !document.querySelector('[data-cms-site-closed]'))
    const back = await visit('/')
    check(back.status === 200 && !back.closed, 'site toujours fermé : ' + back.status)
    // Les pages d'attente sont gardées pour la prochaine fois.
    const kept = await claire.json(A); check(kept.pages.maintenance.texts.fr?.title === 'On revient lundi', 'texte perdu à la réouverture : ' + JSON.stringify(kept))
  })

  await step('téléphone : l\'écran ne déborde pas', async () => {
    const phone = await t.newPage({ width: 390, height: 844 })
    await phone.goto(B + '/admin/availability', { waitUntil: 'networkidle0' })
    const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    check(overflow <= 0, `débordement horizontal : ${overflow} px`)
    await t.shot(phone, 'telephone')
  })
}
