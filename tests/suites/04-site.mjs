// Site public : référencement, plan du site, aperçu du brouillon, redirections, ordre, publication par langue, thème.
import { api, check, clickText, jsonInit, login, parse, says } from '../lib/harness.mjs'

export const meta = { title: 'site public : référencement, aperçu, redirections, ordre, thème' }

// Adresse officielle du site, déclarée dans playground/cms.config.ts.
const S = 'https://cabinet-durand.fr'

export default async function (t) {
  const { B, step } = t
  const browser = await t.browser()
  const page = await t.newPage()
  const anon = await t.newPage({ context: await t.newContext() })
  const send = (url, body, method = 'POST') => api(page, url, { redirect: 'manual', ...jsonInit(method, body) })
  const head = p => p.evaluate(() => ({
    title: document.title,
    lang: document.documentElement.lang,
    meta: Object.fromEntries([...document.querySelectorAll('meta[name],meta[property]')].map(m => [m.getAttribute('name') ?? m.getAttribute('property'), m.content])),
    links: [...document.querySelectorAll('link[rel=canonical],link[rel=alternate]')].map(l => `${l.rel}${l.hreflang ? ':' + l.hreflang : ''} ${l.href}`),
  }))
  // Lecture du HTML rendu par le serveur, sans exécuter le navigateur.
  const html = async (url, cookie) => {
    const r = await fetch(B + url, { redirect: 'manual', headers: cookie ? { cookie } : {} })
    return { status: r.status, location: r.headers.get('location'), text: await r.text() }
  }
  const primary = (p, sel = 'html') => p.evaluate(sel => getComputedStyle(document.querySelector(sel)).getPropertyValue('--color-primary').trim(), sel)

  const ids = {}
  let cookie
  await step('préparation : connexion, image, trois services', async () => {
    await login(page, B)
    cookie = (await browser.defaultBrowserContext().cookies()).map(c => `${c.name}=${c.value}`).join('; ')
    await page.goto(B + '/admin/media', { waitUntil: 'networkidle0' })
    await (await page.$('input[type=file]')).uploadFile(t.fixture('Photo du Cabinet.png')); await says(page, 'Fichier importé')
    const [media] = parse(await api(page, '/api/cms/media'))
    for (const [key, title] of [['a', 'Droit des affaires'], ['b', 'Droit social'], ['c', 'Droit fiscal']]) {
      const body = { shared: { onQuote: true }, locales: { fr: { values: { title, excerpt: 'Résumé de ' + title } } }, publish: ['fr'] }
      if (key === 'a') {
        body.shared.seo = { image: media.id }
        body.locales.fr.values.seo = { description: 'Description pour Google.' }
        body.locales.en = { values: { title: 'Business law' } }
        body.publish.push('en')
      }
      const created = await send('/api/cms/entries/services', body)
      check(created.status === 200, `création de « ${title} » : ${created.status}`)
      ids[key] = parse(created).id
    }
    // Un singleton est créé vide à sa première lecture par le formulaire : on fait comme lui avant d'enregistrer.
    await api(page, '/api/cms/entries/home/home')
    const home = await send('/api/cms/entries/home/home', { locales: { fr: { values: { heroTitle: 'Un conseil clair' } } }, publish: ['fr'] }, 'PUT')
    check(home.status === 200, 'publication de l\'accueil : ' + home.status)
  })

  await step('référencement : balises de la page rendues par le serveur', async () => {
    await anon.goto(B + '/services/droit-des-affaires', { waitUntil: 'networkidle0' })
    const h = await head(anon)
    const want = { title: 'Droit des affaires — Cabinet Durand', lang: 'fr', description: 'Description pour Google.', 'og:url': S + '/services/droit-des-affaires', 'twitter:card': 'summary_large_image' }
    const got = { title: h.title, lang: h.lang, description: h.meta.description, 'og:url': h.meta['og:url'], 'twitter:card': h.meta['twitter:card'] }
    check(JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got))
    check(/^https:\/\/cabinet-durand\.fr\/media\/.+\/photo-du-cabinet\.png$/.test(h.meta['og:image'] ?? ''), 'og:image ' + h.meta['og:image'])
    check(!h.meta.robots, 'robots inattendu : ' + h.meta.robots)
    const links = h.links.join(' | ')
    check(links === `canonical ${S}/services/droit-des-affaires | alternate:fr ${S}/services/droit-des-affaires | alternate:en ${S}/en/services/business-law`, links)
    const raw = (await html('/services/droit-des-affaires')).text
    check(raw.includes('<title>Droit des affaires — Cabinet Durand</title>') && raw.includes('rel="canonical"'), 'balises absentes du HTML serveur')
  })

  await step('plan du site et robots', async () => {
    const map = (await html('/sitemap.xml')).text
    for (const s of [`<loc>${S}/</loc>`, `<loc>${S}/services/droit-social</loc>`, `<loc>${S}/en/services/business-law</loc>`, `hreflang="en" href="${S}/en/services/business-law"`]) check(map.includes(s), 'absent du plan : ' + s)
    await send(`/api/cms/entries/services/${ids.c}`, { shared: { onQuote: true, seo: { noindex: true } }, locales: { fr: { values: { title: 'Droit fiscal' } } }, publish: ['fr'] }, 'PUT')
    check(!(await html('/sitemap.xml')).text.includes('droit-fiscal'), 'une page masquée est dans le plan du site')
    await anon.goto(B + '/services/droit-fiscal', { waitUntil: 'networkidle0' }); check((await head(anon)).meta.robots === 'noindex, nofollow', 'robots de la page masquée')
    const robots = (await html('/robots.txt')).text; check(robots.includes('Disallow: /admin') && robots.includes(`Sitemap: ${S}/sitemap.xml`), robots)
  })

  await step('aperçu du brouillon : visible connecté, invisible sinon', async () => {
    await send(`/api/cms/entries/services/${ids.b}`, { shared: { onQuote: true }, locales: { fr: { values: { title: 'Droit social (brouillon)' } } } }, 'PUT')
    const draft = parse(await send('/api/cms/entries/services', { shared: { onQuote: true }, locales: { fr: { values: { title: 'Jamais publié' } } } }))
    const pub = await html('/services/droit-social'); check(!pub.text.includes('(brouillon)'), 'le brouillon est visible sans aperçu')
    const sneaky = await html('/services/droit-social?preview=1'); check(!sneaky.text.includes('(brouillon)'), 'le brouillon est visible sans connexion')
    check((await html('/services/jamais-publie?preview=1')).status === 404, 'un contenu non publié est accessible sans connexion')
    const mine = await html('/services/droit-social?preview=1', cookie); check(mine.text.includes('Droit social (brouillon)') && mine.text.includes('noindex'), 'aperçu connecté : brouillon ou noindex absent')
    check((await html('/services/jamais-publie?preview=1', cookie)).status === 200, 'aperçu d\'un contenu jamais publié')
    const r = await fetch(B + '/api/content/services?preview=1', { headers: { cookie } }); check(/no-store/.test(r.headers.get('cache-control') ?? ''), 'aperçu sans no-store')
    await api(page, `/api/cms/entries/services/${draft.id}`, { method: 'DELETE' })
  })

  await step('aperçu depuis le formulaire : nouvel onglet avec bandeau', async () => {
    await page.goto(`${B}/admin/services/${ids.b}`, { waitUntil: 'networkidle0' })
    const opened = new Promise(resolve => browser.once('targetcreated', resolve))
    await clickText(page, 'button', 'Aperçu du brouillon')
    const tab = t.track(await (await opened).page())
    await tab.waitForFunction(() => location.search === '?preview=1' && document.body.innerText.includes('Mode aperçu : vous voyez les brouillons'))
    check((await tab.evaluate(() => document.querySelector('h1').textContent)).includes('(brouillon)'), 'le nouvel onglet ne montre pas le brouillon')
    await t.shot(tab, 'apercu'); await tab.close()
  })

  await step('changement d\'adresse : l\'ancienne redirige (301)', async () => {
    await send(`/api/cms/entries/services/${ids.b}`, { shared: { onQuote: true }, locales: { fr: { slug: 'droit-du-travail', values: { title: 'Droit du travail' } } }, publish: ['fr'] }, 'PUT')
    const old = await html('/services/droit-social'); check(old.status === 301 && old.location === '/services/droit-du-travail', `${old.status} ${old.location}`)
    check((await html('/services/droit-du-travail')).status === 200, 'nouvelle adresse')
    await send(`/api/cms/entries/services/${ids.b}`, { shared: { onQuote: true }, locales: { fr: { slug: 'travail', values: { title: 'Droit du travail' } } }, publish: ['fr'] }, 'PUT')
    const chain = await Promise.all(['/services/droit-social', '/services/droit-du-travail'].map(u => html(u))); check(chain.every(r => r.location === '/services/travail'), 'chaîne : ' + chain.map(r => r.location).join())
    check((await html('/services/inconnu')).status === 404, 'une adresse inconnue devrait répondre 404')
  })

  await step('ordre : glisser-déposer dans la liste, appliqué au site', async () => {
    await page.goto(B + '/admin/services', { waitUntil: 'networkidle0' })
    const titles = () => page.$$eval('tbody tr .font-medium', els => els.map(e => e.textContent.trim()))
    check((await titles()).join() === 'Droit des affaires,Droit du travail,Droit fiscal', 'ordre initial : ' + await titles())
    // La troisième ligne est déposée sur la première.
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll('tbody tr')]; const dt = new DataTransfer()
      rows[2].dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
      rows[0].dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
      rows[0].dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }))
    })
    await says(page, 'Ordre enregistré')
    const site = parse(await api(anon, '/api/content/services')).map(s => s.title).join(); check(site === 'Droit fiscal,Droit des affaires,Droit du travail', 'ordre sur le site : ' + site)
    const bad = await send('/api/cms/entries/services/order', { ids: [ids.a] }, 'PUT'); check(bad.status === 409, 'liste incomplète acceptée : ' + bad.status)
  })

  await step('publication d\'une seule langue', async () => {
    await send(`/api/cms/entries/services/${ids.a}`, { shared: { onQuote: true }, locales: { fr: { values: { title: 'Droit des affaires (maj)' } }, en: { values: { title: 'Business law (draft)' } } } }, 'PUT')
    await page.goto(`${B}/admin/services/${ids.a}`, { waitUntil: 'networkidle0' })
    const row = await page.evaluateHandle(() => [...document.querySelectorAll('aside .card div')].find(d => d.querySelector(':scope > span')?.textContent.trim() === 'français'))
    await (await row.asElement().$('button')).evaluate(b => b.click()); await says(page, 'Version français publiée')
    const fr = parse(await api(anon, '/api/content/services')).find(s => s.id === ids.a).title, en = parse(await api(anon, '/api/content/services?locale=en'))[0].title
    check(fr === 'Droit des affaires (maj)' && en === 'Business law', `${fr} / ${en}`)
  })

  await step('apparence : aperçu en direct, puis thème appliqué au site', async () => {
    await anon.goto(B + '/', { waitUntil: 'networkidle0' }); const before = await primary(anon)
    await page.goto(B + '/admin/appearance', { waitUntil: 'networkidle0' })
    await page.click('button[title="#b91c1c"]')
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-cms-theme-preview]')).getPropertyValue('--color-primary').trim() === '#b91c1c').catch(() => { throw new Error('aperçu non mis à jour') })
    check(await primary(page) !== '#b91c1c', 'le thème déborde sur le back-office')
    await anon.reload({ waitUntil: 'networkidle0' }); check(await primary(anon) === before, 'le site a changé avant l\'enregistrement')
    await clickText(page, 'button', 'Enregistrer'); await says(page, 'Thème enregistré')
    await anon.reload({ waitUntil: 'networkidle0' }); check(await primary(anon) === '#b91c1c', `site ${await primary(anon)}, avant ${before}`)
    await page.goto(B + '/admin/services', { waitUntil: 'networkidle0' }); check(await primary(page) !== '#b91c1c', 'le thème du site s\'applique au back-office')
    await page.goto(B + '/admin/appearance', { waitUntil: 'networkidle0' })
    check((await html('/')).text.includes('--color-primary:#b91c1c'), 'thème absent du HTML serveur')
    await t.shot(anon, 'site-theme')
    const bad = await send('/api/cms/theme', { primary: 'red;}body{display:none', secondary: '#000000', accent: '#000000', neutral: '#000000', base: '#ffffff', radius: 1, border: 1 }, 'PUT'); check(bad.status === 400, 'couleur invalide acceptée')
    const noAuth = await api(anon, '/api/cms/theme', { method: 'DELETE' }); check(noAuth.status === 401, 'suppression du thème sans connexion : ' + noAuth.status)
  })
  await t.shot(page, 'apparence')

  await step('thème sombre puis retour à l\'origine', async () => {
    await page.click('button[title="#111827"]'); await says(page, 'Thème sombre'); await clickText(page, 'button', 'Enregistrer'); await says(page, 'Thème enregistré')
    await anon.reload({ waitUntil: 'networkidle0' }); const bg = await anon.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-base-100').trim()); check(bg === '#111827', 'fond : ' + bg)
    await clickText(page, 'button', 'Rétablir l\'origine'); await says(page, 'Apparence d\'origine rétablie')
    check(!(await html('/')).text.includes('--color-primary:#b91c1c'), 'le thème est encore appliqué')
  })

  await step('en-têtes de sécurité : sur toute réponse ; le back-office ne s\'affiche pas dans le cadre d\'un autre site', async () => {
    const visitor = t.http()
    const NAMES = ['x-content-type-options', 'referrer-policy', 'x-frame-options', 'content-security-policy', 'strict-transport-security']
    const read = async (url, headers) => { const r = await visitor.call(url, { headers }); return Object.fromEntries(NAMES.map(name => [name, r.headers.get(name)])) }
    for (const url of ['/', '/api/cms/setup', '/admin', '/admin/login']) {
      const h = await read(url)
      check(h['x-content-type-options'] === 'nosniff' && h['referrer-policy'] === 'strict-origin-when-cross-origin', `${url} : ${JSON.stringify(h)}`)
    }
    for (const url of ['/admin', '/admin/login']) {
      const h = await read(url)
      check(h['x-frame-options'] === 'SAMEORIGIN' && h['content-security-policy']?.includes('frame-ancestors \'self\''), `${url} : ${JSON.stringify(h)}`)
    }
    // Les pages du site restent affichables dans un cadre : le back-office les montre dans ses aperçus.
    const home = await read('/')
    check(!home['x-frame-options'] && !home['content-security-policy'], 'page du site : ' + JSON.stringify(home))
    // L'engagement HTTPS n'est pris que pour une demande arrivée en HTTPS (ce serveur de test répond en HTTP).
    check(!home['strict-transport-security'], 'engagement HTTPS pris en HTTP')
    check((await read('/', { 'x-forwarded-proto': 'https' }))['strict-transport-security'] === 'max-age=31536000', 'engagement HTTPS absent en HTTPS')
  })
}
