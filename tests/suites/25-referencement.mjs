// Référencement assisté : aperçus et conseils de l'onglet Référencement, titre et description de partage,
// suffixe de titre et image par défaut du site, données structurées, vue d'ensemble, droits, deux langues,
// titres de la page (H1 à H6) lus dans la page rendue.
import { check, clickText, field, login, menuLabels, says } from '../lib/harness.mjs'

export const meta = { title: 'référencement assisté : aperçus, conseils, partage, vue d\'ensemble' }

// Adresse officielle, suffixe de titre et image de partage par défaut : déclarés dans playground/cms.config.ts.
const S = 'https://cabinet-durand.fr'
const DESCRIPTION = 'Conseil et contentieux pour les sociétés lyonnaises : contrats, cessions, baux commerciaux.'
const LONG = 'Accompagnement juridique des entreprises en difficulté et de leurs dirigeants'
const LINA = { name: 'Lina Roux', email: 'lina@example.com', password: 'mot-de-passe-de-lina', role: 'writer' }
const words = n => Array.from({ length: n }, (_, i) => `mot${i}`).join(' ')

export default async function (t) {
  const { B, step, admin } = t
  const page = await t.newPage()
  const claire = t.http(), lina = t.http(), visitor = t.http()
  const ids = {}
  let media

  /** Balises d'une page telle que le serveur la rend, sans exécuter de script. */
  const head = async (url) => {
    const html = (await visitor.get(url)).text
    const metas = {}
    for (const tag of html.match(/<meta\b[^>]*>/g) ?? []) {
      const key = /\b(?:name|property)="([^"]+)"/.exec(tag)?.[1]
      const content = /\bcontent="([^"]*)"/.exec(tag)?.[1]
      if (key && content !== undefined) metas[key] = content.replace(/&#x27;|&#39;|&apos;/g, '\'').replace(/&amp;/g, '&')
    }
    return {
      title: (/<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '').replace(/&#x27;|&#39;|&apos;/g, '\'').replace(/&amp;/g, '&'),
      metas,
      canonical: /<link\b[^>]*rel="canonical"[^>]*href="([^"]+)"/.exec(html)?.[1],
      jsonLd: [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([^<]+)<\/script>/g)].map(m => JSON.parse(m[1])),
    }
  }
  const text = (sel, p = page) => p.$eval(sel, el => el.textContent.trim().replace(/\s+/g, ' '))
  const tipIds = (p = page, root = '') => p.$$eval(`${root} [data-seo-tip]`, els => els.map(e => e.dataset.seoTip))
  const waitTips = (wanted, absent = [], root = '') => page.waitForFunction((wanted, absent, root) => {
    const got = [...document.querySelectorAll(`${root} [data-seo-tip]`)].map(e => e.dataset.seoTip)
    return wanted.every(id => got.includes(id)) && absent.every(id => !got.includes(id))
  }, {}, wanted, absent, root).catch(async () => { throw new Error(`conseils attendus ${wanted} (sans ${absent}), affichés : ${await tipIds(page, root)}`) })
  const waitText = (sel, expected) => page.waitForFunction((sel, expected) => document.querySelector(sel)?.textContent.trim().replace(/\s+/g, ' ') === expected, {}, sel, expected)
    .catch(async () => { throw new Error(`${sel} : attendu « ${expected} », affiché « ${await text(sel).catch(() => 'absent')} »`) })
  const openSeo = async (path) => {
    await page.goto(B + path, { waitUntil: 'networkidle0' })
    await clickText(page, '[role=tab]', 'Référencement')
    await page.waitForSelector('[data-seo-panel] [data-seo-google]')
  }
  const input = name => page.$(`[data-seo-panel] [data-seo-input=${name}]`)
  /** Remplace le contenu d'une zone de saisie (sélection faite dans la page : les aperçus déplacent les champs pendant la frappe). */
  const retype = async (el, value) => {
    await el.evaluate((e) => { e.focus(); e.select() })
    await page.keyboard.press('Backspace')
    if (value) await el.type(value)
  }

  await step('préparation : image sans texte alternatif, trois services, accueil, une rédactrice', async () => {
    await login(page, B)
    check((await claire.signIn(admin.email, admin.password)).status === 200, 'connexion refusée')
    await page.goto(B + '/admin/media', { waitUntil: 'networkidle0' })
    await (await page.$('input[type=file]')).uploadFile(t.fixture('Photo du Cabinet.png')); await says(page, 'Fichier importé')
    ;[media] = await claire.json('/api/cms/media')
    const create = async (key, body) => { ids[key] = (await claire.json('/api/cms/entries/services', { method: 'POST', body })).id }
    await create('a', {
      values: { title: 'Droit des affaires', onQuote: true, cover: media.id, body: `<p>${words(60)}</p>`, seo: { description: DESCRIPTION, image: media.id } },
      translations: { en: { values: { title: 'Business law' } } }, publish: ['fr', 'en'],
    })
    await create('b', { values: { title: 'Droit social', onQuote: true, seo: { description: DESCRIPTION } }, publish: ['fr'] })
    await create('c', { values: { title: 'Droit fiscal', onQuote: true, seo: { noindex: true } }, publish: ['fr'] })
    await claire.get('/api/cms/entries/home/home')
    await claire.json('/api/cms/entries/home/home', { method: 'PUT', body: { values: { heroTitle: 'Un conseil clair' }, publish: ['fr'] } })
    const { id, link } = await claire.json('/api/cms/users', { method: 'POST', body: { name: LINA.name, email: LINA.email, role: LINA.role } })
    LINA.id = id
    check((await visitor.post(link.replace(/^.*\/admin\/invite\//, '/api/cms/invite/'), { password: LINA.password })).status === 200, 'mot de passe refusé')
    check((await lina.signIn(LINA.email, LINA.password)).status === 200, 'connexion de la rédactrice refusée')
  })

  await step('site : nouveaux champs vides, les balises existantes ne changent pas ; suffixe du titre lu dans la configuration', async () => {
    // Les pages du playground appellent useCmsSeo(entry) sans option : « — Cabinet Durand » vient de site.titleSuffix.
    const h = await head('/services/droit-des-affaires')
    const got = { title: h.title, description: h.metas.description, 'og:title': h.metas['og:title'], 'og:description': h.metas['og:description'], 'og:url': h.metas['og:url'], 'og:type': h.metas['og:type'], 'twitter:card': h.metas['twitter:card'], canonical: h.canonical }
    const want = { title: 'Droit des affaires — Cabinet Durand', description: DESCRIPTION, 'og:title': 'Droit des affaires — Cabinet Durand', 'og:description': DESCRIPTION, 'og:url': S + '/services/droit-des-affaires', 'og:type': 'website', 'twitter:card': 'summary_large_image', canonical: S + '/services/droit-des-affaires' }
    check(JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got))
    check(/^https:\/\/cabinet-durand\.fr\/media\/.+\/photo-du-cabinet\.png$/.test(h.metas['og:image'] ?? ''), 'og:image ' + h.metas['og:image'])
    check(!h.metas.robots, 'robots inattendu : ' + h.metas.robots)
    // Balises twitter : le même contenu que les balises og.
    check(h.metas['twitter:title'] === want.title && h.metas['twitter:description'] === DESCRIPTION && h.metas['twitter:image'] === h.metas['og:image'], 'twitter : ' + JSON.stringify(h.metas))
    const api = (await visitor.get('/api/content/services/droit-des-affaires')).json.seo
    check(api.title === 'Droit des affaires' && api.shareTitle === null && api.shareDescription === null && api.noindex === false, 'seo de l\'API : ' + JSON.stringify(api))
  })

  await step('site : image de partage par défaut, page sans titre, nom du site sur l\'accueil seulement', async () => {
    const social = await head('/services/droit-social')
    check(social.metas['og:image'] === S + '/partage.png' && social.metas['twitter:card'] === 'summary_large_image', 'image par défaut : ' + social.metas['og:image'] + ' ' + social.metas['twitter:card'])
    // Hors de l'accueil : pas de bloc « WebSite », seulement le fil d'Ariane déduit des adresses (voir 36-donnees-structurees).
    check(social.jsonLd.length === 1 && JSON.stringify(social.jsonLd[0]['@graph'].map(b => b['@type'])) === '["BreadcrumbList"]', 'données structurées hors de l\'accueil : ' + JSON.stringify(social.jsonLd))
    const home = await head('/')
    // Page unique sans titre de référencement : le suffixe du site sert de titre.
    check(home.title === 'Cabinet Durand' && home.metas['og:title'] === 'Cabinet Durand', 'titre de l\'accueil : ' + home.title)
    check(JSON.stringify(home.jsonLd) === JSON.stringify([{ '@context': 'https://schema.org', '@type': 'WebSite', 'name': 'Cabinet Durand', 'url': S + '/', 'inLanguage': 'fr' }]), 'accueil : ' + JSON.stringify(home.jsonLd))
    const hidden = await head('/services/droit-fiscal')
    check(hidden.metas.robots === 'noindex, nofollow' && hidden.jsonLd.length === 0, 'page masquée : ' + JSON.stringify(hidden.metas))
    const preview = (await fetch(B + '/?preview=1', { headers: { cookie: claire.cookie() } }).then(r => r.text()))
    check(!preview.includes('application/ld+json'), 'données structurées dans un aperçu')
  })

  await step('formulaire : les aperçus montrent les replis (titre du contenu, suffixe, description, image du contenu)', async () => {
    await openSeo(`/admin/services/${ids.a}`)
    await waitText('[data-seo-title]', 'Droit des affaires — Cabinet Durand')
    check(await text('[data-seo-url]') === `${S} › services › droit-des-affaires`, 'adresse : ' + await text('[data-seo-url]'))
    check(await text('[data-seo-description]') === DESCRIPTION, 'description : ' + await text('[data-seo-description]'))
    // Carte de partage : domaine, titre repris de la page, description reprise, image du contenu.
    check(await text('[data-seo-share-host]') === 'cabinet-durand.fr', 'domaine : ' + await text('[data-seo-share-host]'))
    check(await text('[data-seo-share-title]') === 'Droit des affaires — Cabinet Durand' && await text('[data-seo-share-description]') === DESCRIPTION, 'carte : ' + await text('[data-seo-share]'))
    const image = await page.$eval('[data-seo-share-image]', img => ({ src: img.getAttribute('src'), loaded: img.complete && img.naturalWidth > 0 }))
    check(image.src.startsWith(media.url) && image.loaded, 'image de la carte : ' + JSON.stringify(image))
    check(await page.$eval('[data-seo-input=title]', el => el.placeholder) === 'Droit des affaires', 'le champ ne rappelle pas le titre repris')
    await t.shot(page, 'onglet')
  })

  await step('formulaire : les aperçus suivent la saisie ; un titre trop long est coupé, et l\'endroit est montré', async () => {
    await (await input('title')).type('Avocat d\'affaires à Lyon')
    await waitText('[data-seo-title]', 'Avocat d\'affaires à Lyon — Cabinet Durand')
    await waitText('[data-seo-share-title]', 'Avocat d\'affaires à Lyon — Cabinet Durand')
    check(!(await page.$('[data-seo-cut]')) && !(await tipIds()).includes('title-long'), 'titre court signalé comme trop long')

    await retype(await input('title'), LONG)
    await waitTips(['title-long'])
    const shown = await text('[data-seo-title]')
    check(shown.endsWith(' …') && LONG.startsWith(shown.slice(0, -2)) && shown.length < LONG.length, 'titre non coupé : ' + shown)
    // Sous le champ : ce qui reste visible, puis ce que Google coupe (barré), suffixe compris.
    const rest = await text('[data-seo-cut-rest]')
    check(rest.endsWith('— Cabinet Durand'), 'partie coupée : ' + rest)
    check(`${shown.slice(0, -2)} ${rest}`.replace(/\s+/g, ' ') === `${LONG} — Cabinet Durand`, `coupe : « ${shown} » + « ${rest} »`)
    check(/Google le coupera après « .+ »/.test(await text('[data-seo-tip=title-long]')), 'conseil : ' + await text('[data-seo-tip=title-long]'))
    // Sur téléphone, le titre passe sur deux lignes et la description est coupée plus tôt.
    await retype(await input('description'), 'Une phrase assez longue pour dépasser la place disponible sur un téléphone. '.repeat(3).trim())
    await page.$eval('[data-seo-device=mobile]', el => el.click())
    await page.waitForSelector('[data-seo-google][data-device=mobile]')
    const mobile = await text('[data-seo-description]')
    check(mobile.endsWith(' …') && mobile.length <= 120, 'description sur téléphone : ' + mobile.length)
    check((await text('[data-seo-title]')).startsWith(LONG), 'titre sur téléphone : ' + await text('[data-seo-title]'))
    await page.$eval('[data-seo-device=desktop]', el => el.click())
    const desktop = await text('[data-seo-description]')
    check(desktop.endsWith(' …') && desktop.length > 120 && desktop.length <= 160, 'description sur ordinateur : ' + desktop.length)
    await waitTips(['description-long'])
    // Description vidée : l'aperçu le dit, le conseil change.
    await retype(await input('description'), '')
    await waitTips(['description-missing'], ['description-long'])
    check((await text('[data-seo-description]')).includes('Google choisit lui-même un extrait'), 'aperçu sans description : ' + await text('[data-seo-description]'))
    check(!(await page.$('[data-seo-share-description]')), 'la carte affiche une description vide')
  })

  await step('titre et description de partage distincts : la carte change, pas le résultat Google', async () => {
    await retype(await input('title'), 'Avocat d\'affaires à Lyon')
    await retype(await input('description'), DESCRIPTION)
    await (await input('shareTitle')).type('Votre avocat d\'affaires, à deux pas de Bellecour')
    await waitText('[data-seo-share-title]', 'Votre avocat d\'affaires, à deux pas de Bellecour')
    check(await text('[data-seo-title]') === 'Avocat d\'affaires à Lyon — Cabinet Durand', 'le résultat Google a changé : ' + await text('[data-seo-title]'))
    check(await text('[data-seo-share-description]') === DESCRIPTION, 'description de la carte : ' + await text('[data-seo-share-description]'))
    await (await input('shareDescription')).type('Un premier rendez-vous offert.')
    await waitText('[data-seo-share-description]', 'Un premier rendez-vous offert.')
    check(await text('[data-seo-description]') === DESCRIPTION, 'la description Google a changé')
    await clickText(page, 'button', 'Publier'); await says(page, 'Publié. Le site est à jour.')

    const h = await head('/services/droit-des-affaires')
    check(h.title === 'Avocat d\'affaires à Lyon — Cabinet Durand' && h.metas.description === DESCRIPTION, `title « ${h.title} », description « ${h.metas.description} »`)
    check(h.metas['og:title'] === 'Votre avocat d\'affaires, à deux pas de Bellecour' && h.metas['twitter:title'] === h.metas['og:title'], 'og:title : ' + h.metas['og:title'])
    check(h.metas['og:description'] === 'Un premier rendez-vous offert.' && h.metas['twitter:description'] === h.metas['og:description'], 'og:description : ' + h.metas['og:description'])
    const api = (await visitor.get('/api/content/services/droit-des-affaires')).json.seo
    check(api.title === 'Avocat d\'affaires à Lyon' && api.shareTitle === 'Votre avocat d\'affaires, à deux pas de Bellecour' && api.shareDescription === 'Un premier rendez-vous offert.', JSON.stringify(api))
    // Rechargé, le formulaire retrouve ses valeurs.
    await openSeo(`/admin/services/${ids.a}`)
    check(await page.$eval('[data-seo-input=shareTitle]', el => el.value) === 'Votre avocat d\'affaires, à deux pas de Bellecour', 'titre de partage perdu au rechargement')
  })

  await step('conseils : doublon avec une autre page (nommée), image sans texte alternatif, image de partage trop petite', async () => {
    await waitTips(['description-duplicate', 'alt-missing', 'image-small'], ['title-long', 'title-missing', 'description-missing', 'body-short'])
    const twin = await text('[data-seo-tip=description-duplicate]')
    check(twin.includes('Même description que la page « Droit social »'), twin)
    const link = await page.$eval('[data-seo-tip=description-duplicate] a', a => a.getAttribute('href'))
    check(link === `/admin/services/${ids.b}?tab=seo`, 'lien vers le doublon : ' + link)
    check((await text('[data-seo-tip=image-small]')).includes('320 × 240 px'), await text('[data-seo-tip=image-small]'))
    const alt = await text('[data-seo-tip=alt-missing]')
    check(alt.includes('1 image sans texte alternatif') && alt.includes('Photo du Cabinet.png'), alt)
    check(await page.$eval('[data-seo-tip=alt-missing] a', a => a.getAttribute('href')) === `/admin/media?file=${media.id}`, 'lien vers la médiathèque')
    check((await text('[data-seo-tips]')).includes('3 points à voir'), await text('[data-seo-tips]'))

    // Le lien ouvre la fiche du fichier ; le texte alternatif (du fichier, par langue) y est saisi.
    await page.goto(`${B}/admin/media?file=${media.id}`, { waitUntil: 'networkidle0' })
    await page.waitForFunction(() => document.querySelector('aside.card')?.textContent.includes('Photo du Cabinet.png')).catch(() => { throw new Error('la fiche du fichier ne s\'ouvre pas') })
    const box = await page.$('aside.card textarea')
    await box.type('La façade du cabinet'); await page.$eval('aside.card textarea', el => el.blur()); await says(page, 'Texte alternatif enregistré')
    await openSeo(`/admin/services/${ids.a}`)
    await waitTips(['description-duplicate', 'image-small'], ['alt-missing'])
    // Le titre identique se signale aussi, pendant la saisie, sans enregistrer.
    await retype(await input('title'), '  droit SOCIAL ')
    await waitTips(['title-duplicate'])
    check((await text('[data-seo-tip=title-duplicate]')).includes('Même titre que la page « Droit social »'), await text('[data-seo-tip=title-duplicate]'))
    await retype(await input('title'), 'Avocat d\'affaires à Lyon')
    await waitTips([], ['title-duplicate'])
  })

  await step('conseils : page publiée mais masquée (rappel), image par défaut du site dans la carte', async () => {
    await openSeo(`/admin/services/${ids.c}`)
    await waitTips(['hidden-published'], ['description-missing', 'image-missing', 'body-short'])
    check((await text('[data-seo-hidden]')).includes('Page masquée'), 'l\'aperçu ne dit pas que la page est masquée')
    // Pas d'image propre : celle du site (site.shareImage), et l'aperçu le dit.
    const image = await page.$eval('[data-seo-share-image]', img => ({ src: img.getAttribute('src'), loaded: img.complete && img.naturalWidth > 0 }))
    check(image.src === '/partage.png' && image.loaded && !!(await page.$('[data-seo-share-default]')), 'image par défaut : ' + JSON.stringify(image))
    // L'interrupteur est dans les champs communs du formulaire : le décocher met les conseils à jour tout de suite.
    const toggle = await page.evaluateHandle(() => [...document.querySelectorAll('label')].find(l => l.textContent.includes('Masquer cette page des moteurs de recherche') && l.offsetParent)?.querySelector('input'))
    await toggle.asElement().evaluate(el => el.click())
    await waitTips(['description-missing', 'body-short'], ['hidden-published'])
    check(!(await page.$('[data-seo-hidden]')), 'l\'aperçu dit encore que la page est masquée')
    await toggle.asElement().evaluate(el => el.click())
    await waitTips(['hidden-published'], ['description-missing'])
  })

  await step('deux langues : aperçu, saisie et balises propres à chaque langue', async () => {
    await openSeo(`/admin/services/${ids.a}`)
    await clickText(page, '.tabs-box [role=tab]', 'en')
    await page.waitForSelector('[data-seo-panel][data-seo-locale=en]')
    await waitText('[data-seo-title]', 'Business law — Cabinet Durand')
    check(await text('[data-seo-url]') === `${S} › en › services › business-law`, 'adresse : ' + await text('[data-seo-url]'))
    check((await tipIds()).includes('description-missing') && !(await tipIds()).includes('description-duplicate'), 'conseils en anglais : ' + await tipIds())
    // Le texte alternatif saisi en français vaut pour l'anglais, comme sur le site.
    check(!(await tipIds()).includes('alt-missing'), 'texte alternatif réclamé en anglais')
    await (await input('shareTitle')).type('Your business lawyer in Lyon')
    await waitText('[data-seo-share-title]', 'Your business lawyer in Lyon')
    await clickText(page, 'button', 'Publier'); await says(page, 'Publié. Le site est à jour.')
    // Le playground n'a pas de pages en anglais : ce que le site reçoit pour cette langue est lu dans l'API publique.
    const en = (await visitor.get('/api/content/services/business-law?locale=en')).json.seo, fr = await head('/services/droit-des-affaires')
    check(en.title === 'Business law' && en.shareTitle === 'Your business lawyer in Lyon' && en.shareDescription === null && en.description === null, 'en : ' + JSON.stringify(en))
    check(fr.metas['og:title'] === 'Votre avocat d\'affaires, à deux pas de Bellecour', 'fr : ' + fr.metas['og:title'])
    // Côte à côte : un volet par langue, chacun avec ses aperçus et ses conseils.
    await page.$eval('label[title="Afficher deux langues en même temps"] input', el => el.click())
    await page.waitForFunction(() => document.querySelectorAll('[data-seo-panel]').length === 2)
    const titles = await page.$$eval('[data-seo-panel]', els => els.map(e => `${e.dataset.seoLocale}:${e.querySelector('[data-seo-title]').textContent.trim()}`))
    check(titles.sort().join(' | ') === 'en:Business law — Cabinet Durand | fr:Avocat d\'affaires à Lyon — Cabinet Durand', titles.join(' | '))
    await waitTips(['description-duplicate'], ['description-missing'], '[data-seo-locale=fr]')
    await waitTips(['description-missing'], ['description-duplicate'], '[data-seo-locale=en]')
  })

  await step('vue d\'ensemble : toutes les pages, leurs états, filtres, recherche et tri', async () => {
    // Une page sans rien à signaler : description propre, assez de texte, image par défaut du site.
    await claire.json(`/api/cms/entries/services/${ids.b}`, { method: 'PUT', body: { values: { body: `<p>${words(60)}</p>`, seo: { description: 'Contrats de travail, ruptures, prud\'hommes : nous défendons salariés et employeurs.' } }, publish: ['fr'] } })
    await page.goto(B + '/admin', { waitUntil: 'networkidle0' })
    check((await menuLabels(page)).includes('Pages et titres'), 'entrée de menu absente : ' + await menuLabels(page))
    await clickText(page, 'aside .menu a', 'Pages et titres')
    await page.waitForSelector('[data-seo-overview] [data-seo-row]')
    const rows = () => page.$$eval('[data-seo-row]', els => els.map(tr => ({
      name: tr.querySelector('td a').textContent.trim(), locale: tr.querySelector('td .uppercase')?.textContent.trim(), state: tr.querySelector('[data-seo-cell=state]').textContent.trim(),
      title: tr.querySelector('[data-seo-cell=title]').textContent.trim(), description: tr.querySelector('[data-seo-cell=description]').textContent.trim(), points: tr.querySelector('[data-seo-cell=points]').textContent.trim().replace(/\s+/g, ' '),
    })))
    const all = await rows()
    const find = (name, locale = 'fr') => all.find(r => r.name === name && r.locale === locale)
    check(all.length === 5, 'lignes : ' + all.map(r => `${r.name} ${r.locale}`).join(', '))
    check(find('Droit social').state === 'Complet' && find('Droit social').points === '—' && find('Droit social').title === 'Droit social — Cabinet Durand', 'Droit social : ' + JSON.stringify(find('Droit social')))
    check(find('Droit fiscal').state === 'Masqué', 'Droit fiscal : ' + JSON.stringify(find('Droit fiscal')))
    // Le doublon a disparu avec la nouvelle description de « Droit social » : il reste l'image trop petite.
    const a = find('Droit des affaires')
    check(a.state === 'À améliorer' && a.points.startsWith('1') && a.points.includes('Image de partage trop petite') && a.title === 'Avocat d\'affaires à Lyon — Cabinet Durand' && a.description === DESCRIPTION, 'Droit des affaires : ' + JSON.stringify(a))
    const en = find('Business law', 'en')
    check(en.state === 'À améliorer' && en.description === 'Pas de description' && en.points.includes('Pas de description'), 'Business law : ' + JSON.stringify(en))
    const home = find('Accueil')
    check(home.points.startsWith('2') && home.points.includes('Pas de titre') && home.title === 'Cabinet Durand', 'Accueil : ' + JSON.stringify(home))
    // Par défaut : le plus de points d'abord.
    const numbers = all.map(r => parseInt(r.points) || 0)
    check(numbers.join() === [...numbers].sort((x, y) => y - x).join() && numbers[0] === 3 && numbers.at(-1) === 0, 'ordre par défaut : ' + all.map(r => `${r.name} ${r.points[0]}`).join(', '))
    await t.shot(page, 'vue-ensemble')

    const counts = await page.$$eval('[data-seo-filter]', els => els.map(e => e.textContent.trim().replace(/\s+/g, ' ')).join(' | '))
    check(counts.replace(/(\D)(\d)/g, '$1 $2').replace(/ +/g, ' ') === 'Toutes 5 | À améliorer 3 | Complet 1 | Masqué 1', counts)
    await page.$eval('[data-seo-filter=hidden]', el => el.click())
    check((await rows()).map(r => r.name).join() === 'Droit fiscal', 'filtre « Masqué » : ' + (await rows()).map(r => r.name))
    await page.$eval('[data-seo-filter=complete]', el => el.click())
    check((await rows()).map(r => r.name).join() === 'Droit social', 'filtre « Complet » : ' + (await rows()).map(r => r.name))
    await page.$eval('[data-seo-filter=all]', el => el.click())
    await page.$eval('[data-seo-sort=name]', el => el.click())
    check((await rows()).map(r => r.name).join() === 'Accueil,Business law,Droit des affaires,Droit fiscal,Droit social', 'tri par page : ' + (await rows()).map(r => r.name))
    await page.$eval('[data-seo-sort=name]', el => el.click())
    check((await rows())[0].name === 'Droit social', 'tri inversé : ' + (await rows()).map(r => r.name))
    await page.$eval('[data-seo-sort=state]', el => el.click())
    check((await rows()).map(r => r.state).join() === 'À améliorer,À améliorer,À améliorer,Masqué,Complet', 'tri par état : ' + (await rows()).map(r => r.state))
    await page.select('[data-seo-filters] select', 'en')
    check((await rows()).map(r => r.name).join() === 'Business law', 'filtre par langue : ' + (await rows()).map(r => r.name))
    await page.select('[data-seo-filters] select', 'all')
    await page.type('[data-seo-filters] input[type=search]', 'bellecour')
    check((await rows()).length === 0 && (await text('[data-seo-overview]')).includes('Aucune page ne correspond'), 'recherche sans résultat')
    await retype(await page.$('[data-seo-filters] input[type=search]'), 'lyon')
    check((await rows()).map(r => r.name).join() === 'Droit des affaires', 'recherche dans les titres : ' + (await rows()).map(r => r.name))
  })

  await step('vue d\'ensemble : une ligne ouvre l\'onglet Référencement du contenu, dans la bonne langue', async () => {
    await retype(await page.$('[data-seo-filters] input[type=search]'), 'business')
    await page.$eval('[data-seo-row]', tr => tr.click())
    await page.waitForSelector('[data-seo-panel][data-seo-locale=en] [data-seo-google]')
    check(page.url() === `${B}/admin/services/${ids.a}?tab=seo&lang=en`, page.url())
    check(await page.$eval('.tabs-border .tab-active', el => el.textContent.trim()) === 'Référencement', 'onglet ouvert : ' + await page.$eval('.tabs-border .tab-active', el => el.textContent.trim()))
    check(await page.$eval('[data-seo-panel]', el => el.offsetParent !== null) && await text('[data-seo-title]') === 'Business law — Cabinet Durand', 'volet anglais non affiché')
    // Une page unique s'ouvre à /admin/<type>.
    await page.goto(B + '/admin/seo', { waitUntil: 'networkidle0' })
    await clickText(page, '[data-seo-row] td a', 'Accueil')
    await page.waitForSelector('[data-seo-panel][data-seo-locale=fr] [data-seo-google]')
    check(page.url() === `${B}/admin/home?tab=seo`, page.url())
    await waitTips(['title-missing', 'description-missing'])
    check((await text('[data-seo-tip=title-missing]')).includes('Google n\'affichera que « Cabinet Durand »'), await text('[data-seo-tip=title-missing]'))
  })

  await step('droits : connexion exigée ; chacun ne voit que les pages qu\'il peut modifier', async () => {
    check((await visitor.get('/api/cms/seo')).status === 401, 'vue d\'ensemble sans connexion : ' + (await visitor.get('/api/cms/seo')).status)
    // Une rédactrice modifie les services et l'accueil : elle a la vue d'ensemble entière.
    const full = await lina.json('/api/cms/seo')
    check(full.length === 5 && full.every(r => r.to.includes('tab=seo')), 'rédactrice : ' + full.length + ' lignes')
    // Limitée à l'accueil : plus aucun service, ni dans la liste ni dans les doublons.
    await claire.json(`/api/cms/users/${LINA.id}`, { method: 'PATCH', body: { types: ['home'] } })
    const mine = await lina.json('/api/cms/seo')
    check(mine.map(r => r.type).join() === 'home' && !JSON.stringify(mine).includes('Droit'), 'limitée à l\'accueil : ' + JSON.stringify(mine.map(r => r.name)))
    // Limitée à un contenu sans onglet Référencement : liste vide, et pas d'entrée dans le menu.
    await claire.json(`/api/cms/users/${LINA.id}`, { method: 'PATCH', body: { types: ['testimonials'] } })
    check((await lina.json('/api/cms/seo')).length === 0, 'liste non vide sans contenu référencé')
    const other = await t.newPage({ context: await t.newContext() })
    await login(other, B, LINA)
    check(!(await menuLabels(other)).includes('Pages et titres'), 'menu de la rédactrice limitée : ' + await menuLabels(other))
    await other.goto(B + '/admin/seo', { waitUntil: 'networkidle0' })
    await says(other, 'Aucune page à afficher')
    await other.close()
  })

  await step('API d\'écriture et identifiant réservé', async () => {
    // À plat : les nouvelles clés sont rangées par langue ; une clé inconnue est refusée, pas ignorée.
    const saved = await claire.json(`/api/cms/entries/services/${ids.b}`, { method: 'PUT', body: { values: { seo: { shareDescription: 'Partage FR' } }, translations: { en: { values: { title: 'Employment law', seo: { shareTitle: 'Share EN' } } } } } })
    check(saved.locales.fr.values.seo.shareDescription === 'Partage FR' && saved.locales.en.values.seo.shareTitle === 'Share EN' && !('shareTitle' in (saved.shared.seo ?? {})), JSON.stringify([saved.shared.seo, saved.locales.fr.values.seo, saved.locales.en.values.seo]))
    const bad = await claire.put(`/api/cms/entries/services/${ids.b}`, { values: { seo: { ogTitle: 'x' } } })
    check(bad.status === 422 && JSON.stringify(bad.json).includes('seo.ogTitle'), `clé inconnue : ${bad.status} ${bad.text.slice(0, 200)}`)
  })

  await step('largeur de téléphone : onglet et vue d\'ensemble sans débordement', async () => {
    const phone = await t.newPage({ width: 390, height: 844 })
    const overflow = () => phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    // Référence : l'onglet Contenu du même formulaire. L'onglet Référencement ne doit rien élargir.
    await phone.goto(`${B}/admin/services/${ids.a}`, { waitUntil: 'networkidle0' })
    await phone.waitForSelector('fieldset')
    const before = await overflow()
    await phone.goto(`${B}/admin/services/${ids.a}?tab=seo`, { waitUntil: 'networkidle0' })
    await phone.waitForSelector('[data-seo-panel] [data-seo-google]')
    const wide = await phone.$$eval('main *', els => els.filter(e => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 4).map(e => `${e.tagName.toLowerCase()}.${e.className}`))
    check(await overflow() <= before, `l'onglet Référencement déborde de ${await overflow()} px (onglet Contenu : ${before} px) : ${wide.join(' ; ')}`)
    const widths = await phone.$$eval('[data-seo-google], [data-seo-share], [data-seo-tips]', els => els.map(e => Math.round(e.getBoundingClientRect().right)))
    check(widths.every(right => right <= 390), 'aperçus hors de l\'écran : ' + widths)
    await t.shot(phone, 'onglet-telephone')
    await phone.goto(B + '/admin/seo', { waitUntil: 'networkidle0' })
    await phone.waitForSelector('[data-seo-row]')
    check(await overflow() <= 0, 'la vue d\'ensemble déborde de ' + await overflow() + ' px')
    // Le nom, l'état et le nombre de points restent visibles sans faire défiler le tableau.
    const cells = await phone.$eval('[data-seo-row]', tr => [...tr.querySelectorAll('td')].filter(td => td.offsetParent).map(td => Math.round(td.getBoundingClientRect().right)))
    check(cells.length === 3 && cells.every(right => right <= 390), 'colonnes sur téléphone : ' + cells)
    await t.shot(phone, 'vue-ensemble-telephone')
    await phone.close()
  })

  /** Titres affichés dans l'onglet : [niveau, texte, place]. */
  const outline = () => page.$$eval('[data-seo-outline] [data-seo-heading]', els => els.map(e => [Number(e.dataset.seoHeading), e.querySelector('.break-words').textContent.trim(), e.dataset.place]))
  /** Attend un H1 (de ce texte, s'il est donné) dans les titres de l'onglet. */
  const waitH1 = (expected, what) => page.waitForFunction(expected => [...document.querySelectorAll('[data-seo-outline] [data-seo-heading="1"]')]
    .some(e => expected === null || e.querySelector('.break-words').textContent.trim() === expected), { timeout: 20_000 }, expected)
    .catch(async () => { throw new Error(`${what} ; titres affichés : ${JSON.stringify(await outline())}`) })

  await step('titres de la page : lus dans la page rendue (H1 du gabarit, H2 et H3 du texte), dans un cadre invisible', async () => {
    ids.d = (await claire.json('/api/cms/entries/services', {
      method: 'POST',
      body: { values: { title: 'Droit immobilier', onQuote: true, body: `<h2>Nos missions</h2><p>${words(60)}</p><h3>Baux commerciaux</h3><p>${words(20)}</p>`, seo: { description: DESCRIPTION, image: media.id } }, publish: ['fr'] },
    })).id
    await openSeo(`/admin/services/${ids.d}`)
    await page.waitForSelector('[data-seo-outline][data-state=ready]', { timeout: 20_000 })
    await waitH1(null, 'pas de H1')
    const main = (await outline()).filter(h => h[2] === 'main')
    check(JSON.stringify(main.slice(0, 3)) === JSON.stringify([[1, 'Droit immobilier', 'main'], [2, 'Nos missions', 'main'], [3, 'Baux commerciaux', 'main']]), 'titres : ' + JSON.stringify(main))
    const tips = await tipIds()
    check(!tips.some(id => id.startsWith('h1-') || id.startsWith('heading-')), 'conseils inattendus : ' + tips)
    // Le cadre ne se voit pas et ne prend ni clic ni tabulation.
    const probe = await page.$eval('[data-seo-probe]', el => ({ right: el.getBoundingClientRect().right, tab: el.tabIndex, hidden: el.getAttribute('aria-hidden'), events: getComputedStyle(el).pointerEvents }))
    await page.$eval('[data-seo-outline]', el => el.scrollIntoView())
    await t.shot(page, 'titres')
    check(probe.right <= 0 && probe.tab === -1 && probe.hidden === 'true' && probe.events === 'none', 'cadre visible : ' + JSON.stringify(probe))
    // Les boutons de l'éditeur disent quel titre ils produisent.
    await clickText(page, '[role=tab]', 'Contenu')
    const buttons = await page.$$eval('.cms-rich button', els => els.map(b => b.title))
    check(buttons.includes('Titre de section (H2)') && buttons.includes('Sous-titre (H3)'), 'boutons : ' + buttons)
  })

  await step('titres de la page : ils suivent la saisie sans enregistrer ; H1 sans rapport avec le titre de la page', async () => {
    await clickText(page, '[role=tab]', 'Référencement')
    await retype(await input('title'), 'Avocat en droit immobilier à Lyon')
    await clickText(page, '[role=tab]', 'Contenu')
    const title = await field(page, 'Titre')
    await title.evaluate((e) => { e.focus(); e.select() })
    await page.keyboard.press('Backspace')
    await title.type('Bienvenue chez nous')
    await clickText(page, '[role=tab]', 'Référencement')
    await waitH1('Bienvenue chez nous', 'le H1 ne suit pas la saisie')
    await waitTips(['h1-unrelated'])
    check(/« Bienvenue chez nous ».+« Avocat en droit immobilier à Lyon »/.test(await text('[data-seo-tip=h1-unrelated]')), 'conseil : ' + await text('[data-seo-tip=h1-unrelated]'))
    // Rien n'a été enregistré.
    const saved = (await visitor.get('/api/content/services/droit-immobilier')).json
    check(saved.title === 'Droit immobilier', 'titre enregistré : ' + saved.title)
    // Un titre en rapport : le conseil disparaît.
    await clickText(page, '[role=tab]', 'Contenu')
    await (await field(page, 'Titre')).type(' en droit immobilier')
    await clickText(page, '[role=tab]', 'Référencement')
    await waitTips([], ['h1-unrelated'])
  })

  await step('texte long sans intertitre : conseil dans l\'onglet et dans la vue d\'ensemble ; contenu jamais enregistré', async () => {
    ids.e = (await claire.json('/api/cms/entries/services', {
      method: 'POST', body: { values: { title: 'Droit de la famille', onQuote: true, body: `<p>${words(320)}</p>`, seo: { description: DESCRIPTION, image: media.id } }, publish: ['fr'] },
    })).id
    await openSeo(`/admin/services/${ids.e}`)
    await waitTips(['headings-none'])
    check(/Texte long sans intertitre \(32\d mots\)/.test(await text('[data-seo-tip=headings-none]')), 'conseil : ' + await text('[data-seo-tip=headings-none]'))
    const row = (await claire.json('/api/cms/seo')).find(r => r.id === ids.e)
    check(row?.tips.some(tip => tip.id === 'headings-none'), 'vue d\'ensemble : ' + JSON.stringify(row?.tips))
    // Page jamais enregistrée : pas de page à lire, et c'est dit.
    await page.goto(`${B}/admin/services/new`, { waitUntil: 'networkidle0' })
    await clickText(page, '[role=tab]', 'Référencement')
    await page.waitForSelector('[data-seo-outline][data-state=unavailable] [data-seo-outline-unavailable]')
  })
}
