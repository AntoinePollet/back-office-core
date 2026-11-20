// Aperçu en direct : la page du site à côté du formulaire, mise à jour pendant la saisie, sans rien enregistrer.
import { check, clickText, field, fieldset, find, login, until, wait } from '../lib/harness.mjs'

export const meta = { title: 'aperçu en direct à côté du formulaire (saisie, image, galerie, champ masqué, relation, langue, largeurs, droits, cache, origine)' }

const LINA = { name: 'Lina Roux', email: 'lina@example.com', password: 'mot-de-passe-de-lina', role: 'writer' }
const SAVED = 'Droit social', TYPED = 'Droit social et paie'

export default async function (t) {
  const { step, admin, B } = t
  const claire = t.http(), lina = t.http(), visitor = t.http()
  const page = await t.newPage({ width: 1500, height: 1000 })
  const ids = {}, media = {}
  const E = '/api/cms/entries'

  // ───── Outils propres à la suite ─────
  /** Envoi d'une image par la session du navigateur. */
  const upload = name => page.evaluate(async (name) => {
    const canvas = document.createElement('canvas'); canvas.width = 60; canvas.height = 40
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#' + [...name].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 0xffffff, 7).toString(16).padStart(6, '0'); ctx.fillRect(0, 0, 60, 40)
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
    const form = new FormData(); form.append('file', blob, name)
    return (await fetch('/api/cms/media', { method: 'POST', body: form })).json()
  }, name)
  /** Remplace le contenu d'une zone de saisie, comme le ferait une personne : tout sélectionner, puis taper. */
  const retype = async (el, text, options) => {
    await el.focus()
    await el.evaluate(e => e.select())
    await el.type(text, options)
  }
  /** Le cadre de l'aperçu (la page du site). */
  const frame = async (of = page) => (await of.waitForSelector('iframe[data-cms-live-frame]')).contentFrame()
  /** Attend que la page du cadre vérifie une condition. Le cadre peut être rechargé entre-temps : on le retrouve à chaque essai. */
  const inFrame = (fn, what, ...args) => inFrameOf(page, fn, what, ...args)
  const inFrameOf = async (of, fn, what, ...args) => {
    const end = Date.now() + 10_000
    let last
    while (Date.now() < end) {
      try {
        last = await (await frame(of)).evaluate(fn, ...args)
        if (last) return last
      }
      catch { /* page du cadre en cours de chargement */ }
      await wait(100)
    }
    throw new Error('aperçu : attendu en vain : ' + what)
  }
  const frameSays = text => inFrame(text => document.body.innerText.includes(text), `« ${text} » dans la page`, text)
  const frameH1 = text => inFrame(text => document.querySelector('h1')?.textContent.trim() === text, `titre « ${text} »`, text)
  const openLive = async () => {
    await page.waitForSelector('[data-cms-live-toggle]')
    if (!await page.$('[data-cms-live-panel]')) await page.$eval('[data-cms-live-toggle]', b => b.click())
    await page.waitForSelector('[data-cms-live-panel]')
  }
  const goForm = async (path) => {
    await page.goto(B + path, { waitUntil: 'networkidle0' })
    await page.waitForSelector('[data-cms-live-toggle]')
  }
  /** Appels de préparation partis du formulaire, et chargements de page du cadre. */
  const prepared = [], frameLoads = []
  page.on('request', (r) => { if (r.url().includes('/live-preview')) prepared.push(r.url()) })
  page.on('response', (r) => {
    if (r.request().resourceType() === 'document' && r.url().includes('preview=1')) frameLoads.push({ url: r.url(), cache: r.headers()['cache-control'], robots: r.headers()['x-robots-tag'] })
    if (r.url().includes('/live-preview') && r.status() === 200) prepared.cache = r.headers()['cache-control'] ?? JSON.stringify(r.headers())
  })
  const publicService = async () => (await visitor.json('/api/content/services/droit-social'))
  const draftOf = async (type, id) => claire.json(`${E}/${type}/${id}`)

  await step('préparation : catégories, images, deux services publiés (dont un en deux langues), accueil publié', async () => {
    await login(page, B)
    check((await claire.signIn(admin.email, admin.password)).status === 200, 'connexion refusée')
    for (const name of ['bureau.png', 'salle.png', 'equipe.png']) media[name] = await upload(name)
    ids.companies = (await claire.json(`${E}/categories`, { method: 'POST', body: { values: { name: 'Entreprises' } } })).id
    ids.people = (await claire.json(`${E}/categories`, { method: 'POST', body: { values: { name: 'Particuliers' } } })).id
    ids.social = (await claire.json(`${E}/services`, { method: 'POST', body: {
      values: { title: SAVED, excerpt: 'Contrats et licenciements.', cover: media['bureau.png'].id, category: ids.companies, onQuote: false, fromPrice: 150, body: '<p>Texte enregistré.</p>' },
      translations: { en: { values: { title: 'Employment law', excerpt: 'Contracts.' } } }, publish: ['fr', 'en'],
    } })).id
    ids.tax = (await claire.json(`${E}/services`, { method: 'POST', body: { values: { title: 'Droit fiscal', onQuote: true }, publish: ['fr'] } })).id
    await claire.json(`${E}/home/home`, { method: 'PUT', body: {
      values: { heroTitle: 'Un conseil clair', showGallery: true, gallery: [{ media: media['bureau.png'].id, caption: 'Le bureau' }], featured: [ids.social] }, publish: ['fr'],
    } })
    const { id, link } = await claire.json('/api/cms/users', { method: 'POST', body: { name: LINA.name, email: LINA.email, role: LINA.role } })
    LINA.id = id
    await visitor.post(link.replace(/^.*\/admin\/invite\//, '/api/cms/invite/'), { password: LINA.password })
    check((await lina.signIn(LINA.email, LINA.password)).status === 200, 'connexion de la rédactrice refusée')
  })

  await step('le bouton ouvre la page du site à droite du formulaire', async () => {
    await goForm(`/admin/services/${ids.social}`)
    await openLive()
    await frameH1(SAVED)
    const src = await page.$eval('iframe[data-cms-live-frame]', f => f.getAttribute('src'))
    check(src === '/services/droit-social?preview=1', 'adresse du cadre : ' + src)
    const box = await page.evaluate(() => {
      const r = sel => document.querySelector(sel).getBoundingClientRect()
      const form = r('main section'), panel = r('[data-cms-live-panel]'), title = r('fieldset input')
      return { formRight: form.right, panelLeft: panel.left, panelRight: panel.right, panelHeight: panel.height, inputWidth: title.width, vw: innerWidth, vh: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth }
    })
    check(box.formRight <= box.panelLeft + 1 && box.panelRight === box.vw && box.panelHeight === box.vh, 'deux colonnes : ' + JSON.stringify(box))
    check(box.inputWidth > 300 && !box.overflow, 'formulaire trop étroit ou page qui déborde : ' + JSON.stringify(box))
    // Le bandeau « Mode aperçu » du site est masqué dans le cadre : le volet dit déjà ce que c'est.
    await inFrame(() => { const b = document.querySelector('[data-cms-preview-banner]'); return b && getComputedStyle(b).display === 'none' }, 'bandeau masqué')
    await page.waitForSelector('[data-cms-live-status][data-state=live]')
    await t.shot(page, 'deux-colonnes')
  })

  await step('la page suit la saisie sans enregistrer, sans rechargement, et sans un appel par frappe', async () => {
    await (await frame()).evaluate(() => { window.__sansRechargement = true })
    const before = prepared.length, loads = frameLoads.length
    const input = await field(page, 'Titre')
    await retype(input, TYPED, { delay: 25 })
    await frameH1(TYPED)
    await page.waitForSelector('[data-cms-live-status][data-state=live]')
    const calls = prepared.length - before
    check(calls >= 1 && calls <= 4, `${calls} appels pour ${TYPED.length} frappes`)
    check(await (await frame()).evaluate(() => window.__sansRechargement === true) && frameLoads.length === loads, 'le cadre a été rechargé pendant la saisie')
    check((await page.evaluate(() => document.body.innerText)).includes('Modifications non enregistrées'), 'le formulaire devrait rester non enregistré')
    check((await publicService()).title === SAVED, 'le site en ligne a changé')
    check((await draftOf('services', ids.social)).locales.fr.values.title === SAVED, 'le brouillon a été enregistré')
    check((await claire.json('/api/content/services/droit-social?preview=1')).title === SAVED, 'l\'aperçu enregistré a changé')
  })

  await step('texte mis en forme, image remplacée puis retirée', async () => {
    await page.click('.tiptap'); await page.keyboard.type(' Ajout en direct.')
    await frameSays('Ajout en direct.')
    const first = await inFrame(() => document.querySelector('main img')?.currentSrc || document.querySelector('main img')?.src, 'image du service')
    check(first.includes('bureau'), 'image de départ : ' + first)
    await clickText(page, 'button', 'Remplacer')
    await page.waitForSelector('.modal-open button[title="salle.png"]')
    await page.click('.modal-open button[title="salle.png"]')
    await inFrame(() => (document.querySelector('main img')?.getAttribute('src') ?? '').includes('salle'), 'nouvelle image dans la page')
    await clickText(page, await fieldsetSel('Image'), 'Retirer')
    await inFrame(() => !document.querySelector('main img'), 'image retirée de la page')
  })
  /** Sélecteur des boutons du champ qui porte ce libellé (marqué pour l'occasion). */
  async function fieldsetSel(label) {
    await (await fieldset(page, label)).evaluate((el) => { el.dataset.testField = '1' })
    return 'fieldset[data-test-field] button'
  }

  await step('la liste de l\'accueil reflète aussi le contenu en cours : titre, relation, champ masqué par une condition', async () => {
    // Navigation dans le cadre, par un lien du site : le mode aperçu et la saisie en cours suivent.
    await (await frame()).evaluate(() => [...document.querySelectorAll('a')].find(a => a.textContent.includes('Retour'))?.click())
    await inFrame(() => location.pathname === '/' && location.search.includes('preview=1'), 'accueil dans le cadre')
    const card = () => inFrame(title => [...document.querySelectorAll('main section a.card')].find(a => a.textContent.includes(title))?.innerText, 'carte du service', TYPED)
    check(/Entreprises · À partir de 150 € HT/.test(await card()), 'carte de départ : ' + await card())
    // La relation mise en avant sur l'accueil, elle, vient d'un autre contenu : elle garde le titre enregistré.
    await (await field(page, 'Catégorie', 'select')).select(ids.people)
    await inFrame(title => [...document.querySelectorAll('main section a.card')].some(a => a.textContent.includes(title) && a.textContent.includes('Particuliers')), 'relation changée', TYPED)
    await (await (await find(page, 'label', 'Tarif sur devis')).$('input')).evaluate(el => el.click())
    await inFrame(title => [...document.querySelectorAll('main section a.card')].some(a => a.textContent.includes(title) && a.textContent.includes('Sur devis') && !a.textContent.includes('150')), 'tarif masqué', TYPED)
    // L'autre service de la liste n'a pas bougé.
    check(await inFrame(() => [...document.querySelectorAll('main section a.card')].some(a => a.textContent.includes('Droit fiscal')), 'autre service'), 'autre service absent')
  })

  await step('seconde langue : l\'aperçu suit la langue en cours d\'édition', async () => {
    await clickText(page, '[role=tab]', 'en')
    await page.waitForFunction(() => document.querySelector('iframe[data-cms-live-frame]')?.getAttribute('src') === '/en/services/employment-law?preview=1')
    await frameH1('Employment law')
    await retype(await field(page, 'Titre'), 'Employment and payroll')
    await frameH1('Employment and payroll')
    check((await visitor.json('/api/content/services/employment-law?locale=en')).title === 'Employment law', 'la version anglaise en ligne a changé')
    await clickText(page, '[role=tab]', 'fr')
    await frameH1(TYPED)
  })

  await step('largeurs : téléphone, tablette, ordinateur (page réduite pour tenir dans le volet)', async () => {
    const size = async () => ({ ...await (await frame()).evaluate(() => ({ inner: innerWidth })), ...await page.$eval('iframe[data-cms-live-frame]', f => ({ shown: f.getBoundingClientRect().width, panel: f.closest('[data-cms-live-panel]').getBoundingClientRect().width })) })
    await page.click('[data-cms-live-device=phone]')
    await page.waitForFunction(() => document.querySelector('iframe[data-cms-live-frame]').dataset.device === 'phone')
    let s = await size()
    check(s.inner === 390 && Math.round(s.shown) === 390, 'téléphone : ' + JSON.stringify(s))
    await frameH1(TYPED) // le changement de largeur ne recharge pas la page et ne perd pas la saisie
    await t.shot(page, 'telephone')
    await page.click('[data-cms-live-device=tablet]')
    await page.waitForFunction(() => document.querySelector('iframe[data-cms-live-frame]').dataset.device === 'tablet')
    s = await size()
    check(s.inner === 768 && s.shown <= s.panel, 'tablette : ' + JSON.stringify(s))
    await page.click('[data-cms-live-device=desktop]')
    await page.waitForFunction(() => document.querySelector('iframe[data-cms-live-frame]').dataset.device === 'desktop')
    s = await size()
    check(s.inner >= 1280 && Math.abs(s.shown - s.panel) <= 2, 'ordinateur : ' + JSON.stringify(s))
  })

  await step('séparation réglable au clavier, retenue ; bouton « recharger » ; ouverture dans un onglet', async () => {
    const width = () => page.$eval('[data-cms-live-panel]', p => p.getBoundingClientRect().width)
    const before = await width()
    await page.focus('[data-cms-live-resize]')
    await page.keyboard.press('ArrowLeft')
    await page.waitForFunction(w => document.querySelector('[data-cms-live-panel]').getBoundingClientRect().width > w + 20, {}, before)
    check(Number(await page.evaluate(() => localStorage.getItem('cms-live-share'))) > 0.5, 'largeur non retenue')
    const formRight = await page.$eval('main section', s => s.getBoundingClientRect().right)
    check(formRight <= await page.$eval('[data-cms-live-panel]', p => p.getBoundingClientRect().left) + 1, 'le formulaire passe sous le volet')
    await page.keyboard.press('ArrowRight')
    // Recharger : la page revient, et reçoit de nouveau la saisie en cours.
    const loads = frameLoads.length
    await page.click('[data-cms-live-reload]')
    await page.waitForFunction(() => true)
    await frameH1(TYPED)
    check(frameLoads.length > loads, 'le cadre n\'a pas été rechargé')
    const [tab] = await Promise.all([
      new Promise(resolve => page.browser().once('targetcreated', async target => resolve(await target.page()))),
      page.click('[data-cms-live-tab]'),
    ])
    t.track(tab)
    await tab.waitForFunction(() => document.querySelector('h1'))
    // L'onglet montre ce qui est enregistré, pas la saisie en cours (elle ne vit que dans le formulaire).
    check(tab.url() === `${B}/services/droit-social?preview=1` && await tab.$eval('h1', h => h.textContent.trim()) === SAVED, 'onglet : ' + tab.url())
    await tab.close()
  })

  await step('rien n\'a été enregistré ni publié : l\'API publique, le brouillon en base et le journal le prouvent', async () => {
    const online = await publicService()
    check(online.title === SAVED && online.category?.title === 'Entreprises' && online.fromPrice === 150 && online.cover?.url.includes('bureau') && online.body === '<p>Texte enregistré.</p>', 'en ligne : ' + JSON.stringify(online).slice(0, 300))
    const doc = await draftOf('services', ids.social)
    check(doc.version === 1 && doc.locales.fr.values.title === SAVED && doc.locales.en.values.title === 'Employment law' && doc.shared.category === ids.companies && doc.shared.onQuote === false, 'brouillon : ' + JSON.stringify(doc).slice(0, 300))
    const revisions = await claire.json(`${E}/services/${ids.social}/revisions`)
    check((revisions.items ?? revisions).length === 1, 'historique : ' + JSON.stringify(revisions).slice(0, 200))
    const activity = JSON.stringify(await claire.json('/api/cms/activity'))
    check(!activity.includes(TYPED) && !activity.includes('payroll'), 'la saisie non enregistrée est dans le journal d\'activité')
  })

  await step('page unique (accueil) : titre, galerie masquée puis complétée, relation multiple', async () => {
    // Le volet reste ouvert d'un contenu à l'autre. Les modifications du service sont abandonnées (la question est acceptée).
    await clickText(page, 'aside a', 'Accueil')
    await page.waitForFunction(() => location.pathname === '/admin/home')
    await page.waitForSelector('[data-cms-live-panel]')
    await frameH1('Un conseil clair')
    check(await page.$eval('iframe[data-cms-live-frame]', f => f.getAttribute('src')) === '/?preview=1', 'adresse du cadre')
    // Le service n'est plus en cours de saisie : la liste montre de nouveau ce qui est enregistré.
    await frameSays(SAVED)
    await retype(await field(page, 'Titre principal'), 'Un conseil limpide')
    await frameH1('Un conseil limpide')
    await inFrame(() => document.querySelectorAll('.cms-gallery figure').length === 1 && document.querySelector('.cms-gallery figcaption')?.textContent === 'Le bureau', 'galerie de départ')
    // Champ masqué par une condition : la galerie disparaît de la page, puis revient avec ses images.
    const toggle = await (await find(page, 'label', 'Afficher une galerie de photos')).$('input')
    await toggle.evaluate(el => el.click())
    await inFrame(() => !document.querySelector('.cms-gallery'), 'galerie masquée')
    await toggle.evaluate(el => el.click())
    await inFrame(() => document.querySelectorAll('.cms-gallery figure').length === 1, 'galerie revenue')
    // Une image ajoutée à la galerie.
    await page.$$eval('section.cms-section[data-section="Le cabinet en images"] > h3 > button', els => els.forEach(e => e.getAttribute('aria-expanded') === 'false' && e.click()))
    await clickText(page, 'button', 'Ajouter des images')
    await page.waitForSelector('.modal-open .grid button')
    await page.$$eval('.modal-open .grid button', els => els.find(e => e.title.startsWith('equipe')).click())
    await clickText(page, '.modal-open .modal-action button', 'Ajouter')
    await page.waitForFunction(() => !document.querySelector('.modal-open'))
    await inFrame(() => { const imgs = [...document.querySelectorAll('.cms-gallery img')]; return imgs.length === 2 && imgs[1].getAttribute('src').includes('equipe') }, 'image ajoutée à la galerie')
    // Relation multiple : un second service mis en avant.
    const featured = await fieldset(page, 'Services mis en avant')
    await featured.evaluate(el => [...el.querySelectorAll('label')].find(l => l.textContent.includes('Droit fiscal')).querySelector('input').click())
    await inFrame(() => [...document.querySelectorAll('.badge')].map(b => b.textContent.trim()).join() === 'Droit social,Droit fiscal', 'relation multiple')
    const home = await visitor.json('/api/content/home')
    check(home.heroTitle === 'Un conseil clair' && home.gallery.length === 1 && home.featured.length === 1, 'l\'accueil en ligne a changé : ' + JSON.stringify(home).slice(0, 200))
    check((await draftOf('home', 'home')).locales.fr.values.heroTitle === 'Un conseil clair', 'le brouillon de l\'accueil a été enregistré')
    await t.shot(page, 'accueil')
  })

  await step('petit écran : une bascule Formulaire / Aperçu remplace les deux colonnes', async () => {
    await page.setViewport({ width: 390, height: 800 })
    await page.waitForSelector('[data-cms-live-switch]')
    // Le menu latéral se replie en glissant : attendre qu'il soit sorti de l'écran.
    await page.waitForFunction(() => document.querySelector('.drawer-side aside').getBoundingClientRect().right <= 0)
    const shown = () => page.$eval('[data-cms-live-panel]', p => p.offsetParent !== null || getComputedStyle(p).display !== 'none')
    const panel = await page.$eval('[data-cms-live-panel]', (p) => { const r = p.getBoundingClientRect(); return { left: r.left, width: r.width, vw: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth, wide: [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1 && getComputedStyle(e).position !== 'fixed' && !e.closest('.drawer-side')).slice(0, 6).map(e => e.tagName + '.' + String(e.className).slice(0, 60) + ' ' + Math.round(e.getBoundingClientRect().right)) } })
    check(await shown() && panel.left === 0 && panel.width === panel.vw && !panel.overflow, 'aperçu en plein écran : ' + JSON.stringify(panel))
    await frameH1('Un conseil limpide')
    await t.shot(page, 'petit-ecran-apercu')
    await clickText(page, '[data-cms-live-switch] [role=tab]', 'Formulaire')
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-cms-live-panel]')).display === 'none')
    await retype(await field(page, 'Titre principal'), 'Un conseil net')
    await t.shot(page, 'petit-ecran-formulaire')
    await clickText(page, '[data-cms-live-switch] [role=tab]', 'Aperçu')
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-cms-live-panel]')).display !== 'none')
    await frameH1('Un conseil net')
    await page.setViewport({ width: 1500, height: 1000 })
    await page.waitForFunction(() => !document.querySelector('[data-cms-live-switch]'))
  })

  await step('nouveau contenu : aperçu indisponible avant le premier enregistrement, avec un message clair ; fermeture', async () => {
    await goForm('/admin/services/new')
    await openLive()
    await page.waitForSelector('[data-cms-live-unavailable]')
    check((await page.$eval('[data-cms-live-unavailable]', e => e.textContent)).includes('après le premier enregistrement'), 'message')
    check(!await page.$('iframe[data-cms-live-frame]'), 'un cadre est affiché pour un contenu qui n\'existe pas')
    // Langue jamais enregistrée d'un contenu existant : même réponse, donnée par le serveur.
    const r = await claire.post(`${E}/services/${ids.tax}/live-preview`, { locale: 'en', shared: {}, values: { title: 'Tax law' } })
    check(r.status === 409 && r.json.message.includes('enregistrez'), `langue sans adresse : ${r.status} ${r.text.slice(0, 120)}`)
    const before = prepared.length
    await page.click('[data-cms-live-close]')
    await page.waitForFunction(() => !document.querySelector('[data-cms-live-panel]') && document.querySelector('.drawer-content').style.paddingRight === '')
    await (await field(page, 'Titre')).type('Sans aperçu')
    await wait(800) // vérifie qu'il ne se passe rien : volet fermé, aucun appel
    check(prepared.length === before, 'des appels partent alors que le volet est fermé')
  })

  await step('la préparation applique le traitement de l\'API publique : HTML nettoyé, vides normalisés, références résolues', async () => {
    const r = await claire.json(`${E}/services/${ids.social}/live-preview`, { method: 'POST', body: {
      locale: 'fr',
      shared: { cover: media['salle.png'].id, category: ids.people, onQuote: true, fromPrice: 90, champInconnu: 'x' },
      values: { title: 'Essai', excerpt: '', body: '<p onclick="x()">Bonjour <script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">lien</a></p>', cases: [{ title: 'Dossier', photos: [media['equipe.png'].id, 'fichier-inexistant'] }] },
    } })
    const e = r.entry
    check(e.id === ids.social && e.locale === 'fr' && e.path === '/services/droit-social' && e.slug === 'droit-social', 'identité : ' + JSON.stringify(e).slice(0, 200))
    check(!/script|onclick|onerror|javascript:|<img/.test(e.body) && e.body.includes('Bonjour'), 'HTML : ' + e.body)
    check(e.excerpt === null && e.fromPrice === null && e.onQuote === true && !('champInconnu' in e), 'vides et champ masqué : ' + JSON.stringify([e.excerpt, e.fromPrice, e.onQuote]))
    check(e.cover?.url.includes('salle') && e.category?.title === 'Particuliers' && e.category.collection === 'categories', 'références : ' + JSON.stringify([e.cover, e.category]))
    check(e.cases.length === 1 && e.cases[0].photos.length === 1 && e.cases[0].photos[0].url.includes('equipe') && e.cases[0].photos[0].caption === null, 'galerie dans un répéteur : ' + JSON.stringify(e.cases))
    check(e.seo?.title === 'Essai', 'référencement : ' + JSON.stringify(e.seo))
    // Même forme que l'API publique pour le même contenu.
    const online = await publicService()
    check(Object.keys(e).sort().join() === Object.keys(online).sort().join(), `clés : ${Object.keys(e).sort().join()} / ${Object.keys(online).sort().join()}`)
    check((await draftOf('services', ids.social)).version === 1, 'la préparation a écrit en base')
  })

  await step('droits : rien sans session, rien au-delà de ce que le formulaire permet ; champ réservé gardé', async () => {
    const body = { locale: 'fr', shared: {}, values: { title: 'Tentative' } }
    const url = `${E}/services/${ids.social}/live-preview`
    const anonymous = await visitor.post(url, body)
    check(anonymous.status === 401 && !anonymous.text.includes(SAVED), `sans session : ${anonymous.status}`)
    check((await visitor.post(`${url}?preview=1`, body)).status === 401, 'sans session, avec ?preview=1')
    check((await visitor.get(url)).status !== 200, 'la route répond à une lecture')
    // Rédactrice : la boutique lui est fermée, les réglages aussi.
    const product = (await claire.json(`${E}/products`, { method: 'POST', body: { values: { title: 'Guide' } } })).id
    check((await lina.post(`${E}/products/${product}/live-preview`, body)).status === 403, 'boutique ouverte à la rédactrice')
    check((await lina.post(`${E}/settings/settings/live-preview`, body)).status === 403, 'réglages ouverts à la rédactrice')
    // « Seulement ses contenus » : le témoignage d'une autre personne lui est refusé.
    const quote = (await claire.json(`${E}/testimonials`, { method: 'POST', body: { values: { author: 'Paul', quote: 'Très bien.' } } })).id
    check((await lina.post(`${E}/testimonials/${quote}/live-preview`, { locale: 'fr', shared: {}, values: {} })).status === 403, 'témoignage d\'une autre personne')
    check((await claire.post(`${E}/services/inconnu/live-preview`, body)).status === 404 && (await claire.post(`${E}/inconnu/x/live-preview`, body)).status === 404, 'contenu ou type inconnu')
    check((await claire.post(url, { ...body, locale: 'de' })).status === 400 && (await claire.post(url, { ...body, values: 'texte' })).status === 400, 'demande mal formée acceptée')
    // Champ réservé (« Public ») : la rédactrice voit la valeur enregistrée, quoi qu'elle envoie.
    await claire.json(`${E}/services/${ids.tax}`, { method: 'PUT', body: { values: { audience: 'companies' } } })
    const asWriter = await lina.json(`${E}/services/${ids.tax}/live-preview`, { method: 'POST', body: { locale: 'fr', shared: { audience: 'individuals', onQuote: true }, values: { title: 'Droit fiscal' } } })
    const asAdmin = await claire.json(`${E}/services/${ids.tax}/live-preview`, { method: 'POST', body: { locale: 'fr', shared: { audience: 'individuals', onQuote: true }, values: { title: 'Droit fiscal' } } })
    check(asWriter.entry.audience === 'companies' && asAdmin.entry.audience === 'individuals', `champ réservé : ${asWriter.entry.audience} / ${asAdmin.entry.audience}`)
  })

  await step('cache : ni la préparation ni la page du cadre ne peuvent être mises en cache', async () => {
    const r = await claire.post(`${E}/services/${ids.social}/live-preview`, { locale: 'fr', shared: {}, values: { title: 'Essai' } })
    check(r.status === 200 && r.headers.get('cache-control') === 'private, no-store', 'préparation : ' + r.headers.get('cache-control'))
    check(prepared.cache === 'private, no-store', 'préparation (navigateur) : ' + prepared.cache)
    check(frameLoads.length >= 3 && frameLoads.every(l => l.cache === 'private, no-store' && /noindex/.test(l.robots ?? '')), 'pages du cadre : ' + JSON.stringify(frameLoads.slice(0, 3)))
    for (const path of ['/api/content/services?preview=1', '/api/content/home?preview=1', '/api/content/services/droit-social?preview=1']) {
      const read = await claire.get(path)
      check(read.headers.get('cache-control') === 'private, no-store', `${path} : ${read.headers.get('cache-control')}`)
    }
    // Hors aperçu, le site garde son cache : la fonction n'y a rien changé.
    check(/s-maxage/.test((await visitor.get('/api/content/services')).headers.get('cache-control') ?? ''), 'le cache du site a disparu')
  })

  await step('messages : une page d\'une autre origine ne peut ni injecter de contenu ni écouter le cadre', async () => {
    const draft = { type: 'home', id: 'home', locale: 'fr', defaultLocale: 'fr', entry: { id: 'home', locale: 'fr', heroTitle: 'Contenu injecté', gallery: [], featured: [], faq: [] } }
    const message = { tag: 'cms-live-preview', kind: 'draft', draft }
    // 1. Une page étrangère affiche le site en aperçu dans un cadre et lui envoie un contenu.
    const foreign = await t.newPage({ context: await t.newContext() })
    await foreign.setContent(`<script>window.received = []; addEventListener('message', e => received.push(e.data))</script><iframe id="site" src="${B}/?preview=1" style="width:800px;height:600px"></iframe>`, { waitUntil: 'networkidle0' })
    const siteTitle = async () => (await (await foreign.$('#site')).contentFrame()).evaluate(() => document.querySelector('h1')?.textContent.trim()).catch(() => null)
    await until(async () => await siteTitle() === 'Un conseil clair', 'le site dans le cadre de la page étrangère')
    check(await foreign.evaluate(() => location.origin) !== B, 'la page de test devrait être d\'une autre origine')
    await wait(500)
    await foreign.evaluate((message) => { const w = document.querySelector('#site').contentWindow; w.postMessage(message, '*'); w.postMessage(message, '*') }, message)
    await wait(700) // vérifie qu'il ne se passe rien
    check(await siteTitle() === 'Un conseil clair', 'une autre origine a injecté un contenu : ' + await siteTitle())
    check((await foreign.evaluate(() => window.received.filter(d => d?.tag === 'cms-live-preview').length)) === 0, 'le cadre a parlé à une page d\'une autre origine')
    await foreign.close()

    // 2. Dans le vrai volet : un message à l'origine falsifiée est ignoré ; le même, de la bonne origine, est appliqué (témoin).
    await goForm('/admin/home')
    await openLive()
    await frameH1('Un conseil clair')
    await page.waitForSelector('[data-cms-live-status][data-state=live]')
    const forge = origin => page.evaluate((message, origin) => {
      const target = document.querySelector('iframe[data-cms-live-frame]').contentWindow
      target.dispatchEvent(new target.MessageEvent('message', { data: message, origin, source: window }))
    }, message, origin)
    await forge('https://ailleurs.example')
    await wait(500)
    check(await (await frame()).evaluate(() => document.querySelector('h1').textContent.trim()) === 'Un conseil clair', 'origine falsifiée acceptée')
    // Bonne origine mais mauvaise fenêtre (le cadre lui-même, pas le formulaire).
    await page.evaluate((message) => { const target = document.querySelector('iframe[data-cms-live-frame]').contentWindow; target.dispatchEvent(new target.MessageEvent('message', { data: message, origin: location.origin, source: target })) }, message)
    await wait(300)
    check(await (await frame()).evaluate(() => document.querySelector('h1').textContent.trim()) === 'Un conseil clair', 'mauvaise fenêtre acceptée')
    await forge(B)
    await frameH1('Contenu injecté')
    // 3. Hors mode aperçu (page du site en ligne dans un cadre de la même origine) : rien n'est écouté.
    await page.evaluate(() => { const f = document.createElement('iframe'); f.id = 'en-ligne'; f.src = '/'; f.style.cssText = 'position:fixed;left:0;top:0;width:400px;height:300px;z-index:99'; document.body.append(f) })
    // Même origine : la page du cadre se lit directement depuis le formulaire.
    const onlineTitle = () => page.evaluate(() => document.querySelector('#en-ligne').contentDocument?.querySelector('h1')?.textContent.trim())
    await page.waitForFunction(() => document.querySelector('#en-ligne').contentDocument?.querySelector('h1')?.textContent.includes('Un conseil clair'))
    await wait(700) // le temps que la page du cadre ait fini de démarrer
    await page.evaluate(message => document.querySelector('#en-ligne').contentWindow.postMessage(message, location.origin), message)
    await wait(700)
    check(await onlineTitle() === 'Un conseil clair', 'le site en ligne a accepté un contenu non enregistré : ' + await onlineTitle())
  })

  await step('une rédactrice a l\'aperçu en direct sur ce qu\'elle peut modifier, brouillon compris', async () => {
    const writer = await t.newPage({ context: await t.newContext(), width: 1500, height: 1000 })
    await login(writer, B, LINA)
    const draft = (await lina.json(`${E}/services`, { method: 'POST', body: { values: { title: 'Brouillon de Lina', onQuote: true } } })).id
    await writer.goto(`${B}/admin/services/${draft}`, { waitUntil: 'networkidle0' })
    await writer.$eval('[data-cms-live-toggle]', b => b.click())
    const title = text => inFrameOf(writer, text => document.querySelector('h1')?.textContent.trim() === text, `titre « ${text} »`, text)
    await title('Brouillon de Lina')
    await writer.waitForSelector('[data-cms-live-status][data-state=live]')
    await retype(await field(writer, 'Titre'), 'Brouillon de Lina modifié')
    await title('Brouillon de Lina modifié')
    check((await visitor.get('/api/content/services/brouillon-de-lina')).status === 404, 'le brouillon est visible sur le site en ligne')
    await writer.close()
  })
}
