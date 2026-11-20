// Point d'intérêt des images (médiathèque) et recadrage : réglage à la souris, au doigt et au clavier, aperçus, site
// (object-position, recadrage par le serveur, srcset), bornes de la route /media, cache, vignettes du back-office,
// droits, journal, corbeille, sauvegarde, import.
//
// Les images de test sont des dégradés : le rouge d'un pixel donne sa position horizontale dans l'image d'origine
// (0 à gauche, 255 à droite), le vert sa position verticale. Les bords d'une image recadrée disent donc quel rectangle
// le serveur a gardé. En local, le moteur d'images de wrangler ne connaît pas `gravity` en coordonnées : le core y
// recadre en deux passes (voir la route /media) ; le recadrage fait par Cloudflare en ligne n'est pas exercé ici.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { config } from '../lib/config.mjs'
import { check, login, says, until } from '../lib/harness.mjs'

export const meta = { title: 'point d\'intérêt des images et recadrage (médiathèque, site, route des médias, droits, import)' }

const LINA = { name: 'Lina Roux', email: 'lina@example.com', password: 'mot-de-passe-de-lina', role: 'writer' }
const BIN = path.join(config.rootDir, 'packages', 'cms', 'bin', 'import.mjs')

export default async function (t) {
  const { B, step, admin } = t
  const claire = t.http(), lina = t.http(), anon = t.http()
  const page = await t.newPage()
  const site = await t.newPage()
  const ids = {}
  const media = async () => claire.json('/api/cms/media')
  const one = async id => (await media()).find(m => m.id === id)
  const focusOf = async id => JSON.stringify((await one(id)).focus)
  const patch = (client, id, body) => client.call(`/api/cms/media/${id}`, { method: 'PATCH', body })
  /** Attend que le point enregistré soit celui attendu (l'enregistrement part quand on relâche). */
  const saved = (id, x, y) => until(async () => await focusOf(id) === JSON.stringify(x === null ? null : { x, y }), `point enregistré ${x} / ${y}`)
  const upload = (name, type, text) => page.evaluate(async (name, type, text) => {
    const form = new FormData(); form.append('file', new Blob([text], { type }), name)
    return (await fetch('/api/cms/media', { method: 'POST', body: form })).json()
  }, name, type, text)
  /** Ouvre la fiche d'un fichier dans la médiathèque. */
  const openFile = async (p, id) => {
    await p.bringToFront()
    await p.goto(B + '/admin/media', { waitUntil: 'networkidle0' })
    await p.waitForSelector(`[data-media="${id}"] button`)
    await p.$eval(`[data-media="${id}"] button`, el => el.click())
  }
  /** Coordonnées, dans la fenêtre, d'un point de l'image de la fiche donné en proportion de ses côtés. */
  const at = async (p, x, y) => {
    const box = await p.$eval('[data-focus-area]', (el) => { el.scrollIntoView({ block: 'center' }); const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height } })
    return [box.x + box.w * x, box.y + box.h * y]
  }
  /** État de l'outil : position du point, cadrage de chaque aperçu, forme des aperçus. */
  const tool = p => p.evaluate(() => {
    const point = document.querySelector('[data-focus-point]')
    return {
      point: `${point.style.left} ${point.style.top}`,
      label: point.getAttribute('aria-label'),
      previews: [...document.querySelectorAll('[data-focus-preview]')].map((el) => {
        const img = el.querySelector('img'), box = el.getBoundingClientRect()
        return { ratio: el.dataset.focusPreview, shape: Math.round(box.width / box.height * 100) / 100, position: getComputedStyle(img).objectPosition, fit: getComputedStyle(img).objectFit, loaded: img.naturalWidth > 0 }
      }),
      reset: document.querySelector('[data-focus-reset]').disabled,
    }
  })
  /** Ouvre la page d'exemple du site et attend que toutes ses images soient chargées (elles le sont à la demande). */
  const openSite = async (p) => {
    // Un onglet en arrière-plan ne charge pas ses images à la demande et reçoit les gestes au ralenti.
    await p.bringToFront()
    await p.goto(B + '/cadrage', { waitUntil: 'domcontentloaded' })
    await p.waitForSelector('main img')
    await p.evaluate(() => { for (const img of document.querySelectorAll('main img')) img.loading = 'eager' })
    // Premier affichage : chaque version recadrée est calculée à ce moment-là (lent sur une machine chargée).
    await p.waitForFunction(() => [...document.querySelectorAll('main img')].every(i => i.complete && i.naturalWidth > 0), { timeout: 60_000 })
  }
  /** Une image du site : attributs, style, et ce qui a vraiment été chargé. */
  const shot = (p, name, photo = 'paysage.png') => p.$eval(`[data-photo="${photo}"] [data-shot="${name}"]`, img => ({
    src: img.getAttribute('src'), srcset: img.getAttribute('srcset'), style: img.getAttribute('style'), w: img.getAttribute('width'), h: img.getAttribute('height'),
    current: img.currentSrc.replace(location.origin, ''), natural: `${img.naturalWidth}x${img.naturalHeight}`,
    position: getComputedStyle(img).objectPosition, box: Math.round(img.getBoundingClientRect().width / img.getBoundingClientRect().height * 100) / 100,
  }))
  /**
   * Charge une image et lit ses dimensions et le rectangle de l'image d'origine qu'elle montre, d'après la couleur de
   * ses bords (en pour cent de la largeur et de la hauteur d'origine).
   */
  const inspect = (p, url) => p.evaluate(async (url) => {
    const response = await fetch(url)
    const bitmap = await createImageBitmap(await response.blob())
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bitmap, 0, 0)
    const px = (x, y) => ctx.getImageData(x, y, 1, 1).data
    const midX = Math.floor(bitmap.width / 2), midY = Math.floor(bitmap.height / 2)
    const pct = v => Math.round(v / 255 * 100)
    return {
      url: response.url.replace(location.origin, ''), status: response.status, type: response.headers.get('content-type'), cache: response.headers.get('cache-control'), asked: response.headers.get('x-cms-image'),
      width: bitmap.width, height: bitmap.height,
      left: pct(px(0, midY)[0]), right: pct(px(bitmap.width - 1, midY)[0]), top: pct(px(midX, 0)[1]), bottom: pct(px(midX, bitmap.height - 1)[1]),
    }
  }, url)
  const near = (value, expected, tolerance = 3) => Math.abs(value - expected) <= tolerance
  const redirect = async (url) => { const r = await anon.get(url); return `${r.status} ${(r.headers.get('location') ?? '').replace(/^.*\?/, '?')} ${r.headers.get('cache-control')}` }
  const journal = async () => (await claire.json('/api/cms/activity?limit=100')).items.map(l => l.summary)

  await step('préparation : images envoyées, galerie de l\'accueil et produit publiés', async () => {
    check((await claire.signIn(admin.email, admin.password)).status === 200, 'connexion de l\'administratrice refusée')
    await login(page, B)
    await page.goto(B + '/admin/media', { waitUntil: 'networkidle0' })
    const input = await page.waitForSelector('.cms-media-library input[type=file]')
    await input.uploadFile(t.fixture('paysage.png'), t.fixture('portrait.png'))
    await until(async () => (await media()).length === 2, 'deux fichiers envoyés')
    const files = await media()
    ids.paysage = files.find(m => m.name === 'paysage.png').id
    ids.portrait = files.find(m => m.name === 'portrait.png').id
    const paysage = await one(ids.paysage)
    check(paysage.width === 1200 && paysage.height === 800 && paysage.focus === null, 'fichier envoyé : ' + JSON.stringify(paysage))
    ids.svg = (await upload('logo.svg', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><rect width="40" height="20" fill="#06c"/></svg>')).id
    ids.pdf = (await upload('plaquette.pdf', 'application/pdf', '%PDF-1.4\n%%EOF')).id
    ids.gif = (await upload('anime.gif', 'image/gif', Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), c => c.charCodeAt(0)).buffer)).id
    check(ids.svg && ids.pdf && ids.gif, 'SVG, PDF ou GIF refusé')
    await claire.json('/api/cms/entries/home/home', { method: 'PUT', body: { values: { heroTitle: 'Bienvenue', heroImage: ids.paysage, showGallery: true, gallery: [ids.paysage, ids.svg] }, publish: ['fr'] } })
    ids.product = (await claire.json('/api/cms/entries/products', { method: 'POST', body: { values: { title: 'Guide pratique', image: ids.paysage, price: 12 }, publish: ['fr'] } })).id
  })

  await step('avant tout réglage : le site et l\'API sont comme avant (aucun style, adresses inchangées, focus nul)', async () => {
    const home = await anon.json('/api/content/home')
    check(home.gallery[0].focus === null && home.heroImage.focus === null, 'API : ' + JSON.stringify(home.gallery[0]))
    await site.goto(B + '/', { waitUntil: 'networkidle0' })
    const imgs = await site.$$eval('main img', list => list.map(i => ({ src: i.getAttribute('src'), srcset: i.getAttribute('srcset'), style: i.getAttribute('style'), w: i.getAttribute('width'), h: i.getAttribute('height'), ok: i.naturalWidth > 0 })))
    const url = home.heroImage.url
    check(imgs[0].src === `${url}?w=1280` && !imgs[0].style && imgs[0].w === '1200' && imgs[0].h === '800' && imgs[0].ok, 'image principale : ' + JSON.stringify({ ...imgs[0], srcset: '' }))
    check(imgs[0].srcset === [160, 320, 480, 640, 800, 1024, 1280].map(w => `${url}?w=${w} ${w}w`).join(', '), 'srcset : ' + imgs[0].srcset)
    check(!imgs[1].style && !/[&?][rf]=/.test(imgs[1].src + imgs[1].srcset), 'galerie : ' + JSON.stringify(imgs[1]))
  })

  await step('fiche d\'un fichier : un clic sur l\'image place le point, les aperçus suivent, le réglage est enregistré', async () => {
    await openFile(page, ids.paysage)
    await page.waitForSelector('[data-focus-point]')
    const before = await tool(page)
    check(before.point === '50% 50%' && before.reset === true && /au centre/.test(before.label), 'départ : ' + JSON.stringify(before))
    check(JSON.stringify(before.previews.map(p => p.ratio)) === '["1/1","16/9","3/4","3/1"]', 'formats : ' + JSON.stringify(before.previews))
    check(before.previews.every(p => p.fit === 'cover' && p.position === '50% 50%'), 'aperçus au centre : ' + JSON.stringify(before.previews))
    for (const [p, expected] of before.previews.map((p, i) => [p, [1, 1.78, 0.75, 3][i]])) check(near(p.shape, expected, 0.03), `aperçu ${p.ratio} : proportions ${p.shape}`)
    await page.mouse.click(...await at(page, 0.25, 0.75))
    await saved(ids.paysage, 0.25, 0.75)
    await says(page, 'Point d\'intérêt enregistré')
    const after = await tool(page)
    check(after.point === '25% 75%' && after.reset === false && /25 % depuis la gauche et 75 % depuis le haut/.test(after.label), 'après le clic : ' + JSON.stringify(after))
    check(after.previews.every(p => p.position === '25% 75%' && p.loaded), 'aperçus : ' + JSON.stringify(after.previews))
  })

  await step('le point se déplace à la souris (glisser) : enregistré une seule fois, au relâchement', async () => {
    const calls = []
    const listen = (request) => { if (request.method() === 'PATCH') calls.push(request.postData()) }
    page.on('request', listen)
    await page.mouse.move(...await at(page, 0.25, 0.75))
    await page.mouse.down()
    await page.mouse.move(...await at(page, 0.5, 0.5), { steps: 5 })
    const during = await tool(page)
    check(during.point === '50% 50%' && during.previews.every(p => p.position === '50% 50%'), 'pendant le glisser : ' + JSON.stringify(during))
    await page.mouse.move(...await at(page, 0.8, 0.2), { steps: 5 })
    check(calls.length === 0, 'rien ne doit être enregistré avant de relâcher : ' + calls)
    await page.mouse.up()
    await saved(ids.paysage, 0.8, 0.2)
    page.off('request', listen)
    check(calls.length === 1 && calls[0] === '{"focus":{"x":0.8,"y":0.2}}', 'requêtes : ' + JSON.stringify(calls))
    // Hors de l'image : le point reste au bord.
    await page.mouse.move(...await at(page, 0.8, 0.2))
    await page.mouse.down()
    await page.mouse.move(...await at(page, 1.1, -0.3), { steps: 3 })
    await page.mouse.up()
    await saved(ids.paysage, 1, 0)
    check((await tool(page)).point === '100% 0%', 'bord : ' + (await tool(page)).point)
  })

  await step('le point se déplace au clavier (flèches, Maj pour aller plus vite), puis s\'enregistre', async () => {
    await page.focus('[data-focus-point]')
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft')
    await page.keyboard.down('Shift')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.up('Shift')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowRight')
    const state = await tool(page)
    check(state.point === '76% 29%' && state.previews.every(p => p.position === '76% 29%'), 'après les flèches : ' + JSON.stringify(state))
    await saved(ids.paysage, 0.76, 0.29)
    // Les flèches ne sortent pas de l'image.
    await page.keyboard.down('Shift')
    for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowUp')
    await page.keyboard.up('Shift')
    check((await tool(page)).point === '76% 0%', 'haut de l\'image : ' + (await tool(page)).point)
    for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowLeft')
    // Quitter le point enregistre tout de suite.
    await page.$eval('[data-focus-point]', el => el.blur())
    await saved(ids.paysage, 0.75, 0.3)
  })

  await step('site : le navigateur reçoit le point (object-position) ; une image recadrée par le serveur a les bonnes dimensions et montre la bonne partie', async () => {
    const home = await anon.json('/api/content/home')
    check(JSON.stringify(home.gallery[0].focus) === '{"x":0.75,"y":0.3}', 'API : ' + JSON.stringify(home.gallery[0]))
    const url = home.gallery[0].url
    // Page d'accueil, inchangée dans son code : ses images recadrées en CSS gardent maintenant le sujet.
    await site.bringToFront()
    await site.goto(B + '/', { waitUntil: 'networkidle0' })
    const old = await site.$$eval('main img', list => list.map(i => ({ src: i.getAttribute('src'), style: i.getAttribute('style'), position: getComputedStyle(i).objectPosition })))
    check(old[1].src === `${url}?w=1280` && old[1].position === '75% 30%' && old[1].style === 'object-position:75% 30%;', 'galerie de l\'accueil : ' + JSON.stringify(old[1]))

    await openSite(site)
    const css = await shot(site, 'css')
    check(css.position === '75% 30%' && !/[&?][rf]=/.test(css.src + css.srcset) && css.natural !== '0x0', 'recadrage par le navigateur : ' + JSON.stringify({ ...css, srcset: '' }))

    // Carré : 800 × 800 au plus dans une image de 1200 × 800 ; toutes les versions du srcset sont recadrées de même.
    const square = await shot(site, 'carre')
    check(square.src === `${url}?w=800&r=1x1&f=75-30` && square.w === '800' && square.h === '800', 'carré : ' + JSON.stringify(square))
    check(square.srcset === [160, 320, 480, 640, 800].map(w => `${url}?w=${w}&r=1x1&f=75-30 ${w}w`).join(', '), 'srcset du carré : ' + square.srcset)
    const [sw, sh] = square.natural.split('x').map(Number)
    check(sw === sh && sw > 0 && square.box === 1 && /r=1x1&f=75-30$/.test(square.current), 'image chargée : ' + JSON.stringify({ ...square, srcset: '' }))
    // Le rectangle gardé : 800 de large, décalé de (1200 − 800) × 0,75 = 300 → de 25 % à 92 % de la largeur d'origine.
    const sq = await inspect(site, `${url}?w=640&r=1x1&f=75-30`)
    check(sq.width === 640 && sq.height === 640 && sq.type.startsWith('image/') && sq.cache === 'public, max-age=31536000, immutable', 'carré servi : ' + JSON.stringify(sq))
    check(near(sq.left, 25) && near(sq.right, 92) && near(sq.top, 0) && near(sq.bottom, 100), 'partie gardée (carré) : ' + JSON.stringify(sq))
    check(sq.asked === 'width=640,height=640,fit=cover,gravity=0.75x0.3', 'demande au service d\'images : ' + sq.asked)

    // Bandeau 3/1 : 1200 × 400, décalé de (800 − 400) × 0,3 = 120 → de 15 % à 65 % de la hauteur d'origine.
    const band = await shot(site, 'bandeau')
    check(band.w === '1200' && band.h === '400' && band.box === 3 && /&r=3x1&f=75-30$/.test(band.src), 'bandeau : ' + JSON.stringify(band))
    const bd = await inspect(site, `${url}?w=640&r=3x1&f=75-30`)
    check(bd.width === 640 && bd.height === 213 && near(bd.left, 0) && near(bd.right, 100) && near(bd.top, 15) && near(bd.bottom, 65), 'partie gardée (bandeau) : ' + JSON.stringify(bd))

    const wide = await shot(site, 'paysage')
    check(/&r=16x9&f=75-30$/.test(wide.src) && wide.w === '1200' && wide.h === '675' && near(wide.box, 1.78, 0.01), 'paysage : ' + JSON.stringify(wide))
    // `:width="150" :height="200"` : proportions 3/4, versions jusqu'au double pour les écrans denses.
    const portrait = await shot(site, 'portrait')
    check(portrait.w === '150' && portrait.h === '200' && portrait.src === `${url}?w=320&r=3x4&f=75-30` && portrait.box === 0.75, 'portrait : ' + JSON.stringify(portrait))
    check(portrait.srcset === `${url}?w=160&r=3x4&f=75-30 160w, ${url}?w=320&r=3x4&f=75-30 320w`, 'srcset du portrait : ' + portrait.srcset)
    const pt = await inspect(site, `${url}?w=320&r=3x4&f=75-30`)
    // 600 × 800 gardés, décalés de (1200 − 600) × 0,75 = 450 → de 37,5 % à 87,5 %.
    check(pt.width === 320 && pt.height === 427 && near(pt.left, 37.5) && near(pt.right, 87.5), 'partie gardée (portrait) : ' + JSON.stringify(pt))
    // Jamais d'agrandissement : la plus grande version d'un carré fait 800 × 800.
    const big = await inspect(site, `${url}?w=2560&r=1x1&f=75-30`)
    check(big.width === 800 && big.height === 800, 'plus grande version : ' + JSON.stringify(big))
  })

  await step('SVG, GIF, PDF : pas de point d\'intérêt ; sur le site, servis tels quels dans le cadre demandé', async () => {
    const svg = await shot(site, 'carre', 'logo.svg')
    check(/logo\.svg$/.test(svg.src) && svg.srcset === null && svg.box === 1 && /aspect-ratio:\s*1/.test(svg.style) && svg.natural !== '0x0', 'SVG en carré : ' + JSON.stringify(svg))
    for (const id of [ids.svg, ids.gif, ids.pdf]) {
      const r = await patch(claire, id, { focus: { x: 0.2, y: 0.2 } })
      check(r.status === 400 && /ne se règle que sur une image JPEG, PNG, WebP ou AVIF/.test(r.json.message), `fichier ${id} : ${r.status} ${r.text.slice(0, 120)}`)
      check((await patch(claire, id, { focus: null })).status === 200, 'remise au centre refusée')
    }
    await openFile(page, ids.svg)
    await page.waitForFunction(() => document.querySelector('aside.card')?.innerText.includes('logo.svg'))
    check(await page.$('[data-focus]') === null && await page.$eval('aside.card img', i => i.naturalWidth > 0), 'la fiche d\'un SVG ne doit pas proposer de point')
    await openFile(page, ids.pdf)
    await page.waitForFunction(() => document.querySelector('aside.card')?.innerText.includes('plaquette.pdf'))
    check(await page.$('[data-focus]') === null, 'la fiche d\'un PDF ne doit pas proposer de point')
    const plain = await anon.get((await one(ids.svg)).url + '?w=640&r=1x1')
    check(plain.status === 200 && plain.headers.get('content-type') === 'image/svg+xml', 'SVG avec paramètres : ' + plain.status)
  })

  await step('route /media : largeurs et proportions hors liste, point absent, périmé ou inventé, paramètre en trop → une seule adresse', async () => {
    const url = (await one(ids.paysage)).url
    const exact = '?w=640&r=1x1&f=75-30'
    for (const [asked, expected] of [
      ['?w=640&r=1x1', exact], // point absent
      ['?w=640&r=1x1&f=10-10', exact], // point inventé
      ['?w=640&r=1x1&f=75-30&x=1', exact], // paramètre inconnu
      ['?w=600&r=1x1&f=75-30', exact], // largeur hors liste
      ['?w=640&r=1/1&f=75-30', exact], // autre écriture
      ['?w=640&r=7x5&f=75-30', '?w=640&r=4x3&f=75-30'], // proportions hors liste : la plus proche
      ['?w=640&r=1000x1&f=75-30', '?w=640&r=3x1&f=75-30'],
      ['?w=640&r=zzz', '?w=640'], // illisible : pas de recadrage
      ['?w=640&f=75-30', '?w=640'],
      ['?w=99999&r=1x1&f=75-30', '?w=2560&r=1x1&f=75-30'],
    ]) {
      const got = await redirect(url + asked)
      check(got === `302 ${expected} private, no-store`, `${asked} → ${got}`)
    }
    check(await redirect(url + '?w=500') === '301 ?w=640 private, no-store', 'largeur seule : ' + await redirect(url + '?w=500'))
    check(await redirect(url + '?w=640&zz=1') === '301 ?w=640 private, no-store', 'paramètre en trop : ' + await redirect(url + '?w=640&zz=1'))
    const plain = await anon.get(url + '?w=640')
    check(plain.status === 200 && plain.headers.get('cache-control').includes('immutable') && plain.headers.get('x-cms-image') === null, 'réduction simple : ' + plain.status)
    // Paramètre en double : illisible, donc aucune transformation (l'image d'origine, comme avant).
    const twice = await anon.get(url + '?w=640&r=1x1&f=75-30&w=800')
    check(twice.status === 200 && twice.headers.get('content-type') === 'image/png' && twice.headers.get('x-cms-image') === null, 'paramètre en double : ' + twice.status + ' ' + twice.headers.get('content-type'))
    const original = await anon.get(url)
    check(original.status === 200 && original.headers.get('content-type') === 'image/png', 'image d\'origine : ' + original.status)
    check((await anon.get(url.replace('paysage', 'autre') + '?w=640&r=1x1')).status === 404, 'fichier inconnu')
  })

  await step('changer le point : l\'adresse des images recadrées change, l\'ancienne renvoie vers la nouvelle', async () => {
    const url = (await one(ids.paysage)).url
    const r = await patch(claire, ids.paysage, { focus: { x: 0.104, y: 0.9 } })
    check(r.status === 200 && r.json.purgeFailed === false && JSON.stringify(r.json.focus) === '{"x":0.1,"y":0.9}', 'réponse : ' + r.text)
    check((await anon.get('/api/content/home')).headers.get('cache-control').includes('max-age'), 'la page d\'accueil doit rester en cache (et être purgée)')
    await openSite(site)
    const square = await shot(site, 'carre')
    check(square.src === `${url}?w=800&r=1x1&f=10-90` && square.position === '10% 90%' && /f=10-90 800w$/.test(square.srcset), 'carré : ' + JSON.stringify(square))
    check((await shot(site, 'css')).position === '10% 90%', 'recadrage par le navigateur')
    const fresh = await inspect(site, `${url}?w=640&r=1x1&f=10-90`)
    check(fresh.width === 640 && near(fresh.left, 3) && near(fresh.right, 70) && fresh.asked === 'width=640,height=640,fit=cover,gravity=0.1x0.9', 'nouveau cadrage : ' + JSON.stringify(fresh))
    // Une page restée en cache cite encore l'ancienne adresse : le serveur renvoie vers le nouveau cadrage.
    const stale = await redirect(`${url}?w=640&r=1x1&f=75-30`)
    check(stale === '302 ?w=640&r=1x1&f=10-90 private, no-store', 'ancienne adresse : ' + stale)
  })

  await step('vignettes du back-office cadrées sur le point : médiathèque, liste, champ image, galerie', async () => {
    await page.bringToFront()
    await page.goto(B + '/admin/media', { waitUntil: 'networkidle0' })
    const thumb = sel => page.$eval(sel, i => ({ position: getComputedStyle(i).objectPosition, fit: getComputedStyle(i).objectFit, src: i.getAttribute('src') }))
    await page.waitForSelector(`[data-media="${ids.paysage}"] img`)
    const library = await thumb(`[data-media="${ids.paysage}"] img`)
    check(library.position === '10% 90%' && library.fit === 'cover' && /\?w=320$/.test(library.src), 'médiathèque : ' + JSON.stringify(library))
    check((await thumb(`[data-media="${ids.portrait}"] img`)).position === '50% 50%', 'image sans point : au centre')
    await page.goto(B + '/admin/products', { waitUntil: 'networkidle0' })
    await page.waitForSelector('tbody img')
    const list = await thumb('tbody img')
    check(list.position === '10% 90%' && /\?w=160$/.test(list.src), 'liste : ' + JSON.stringify(list))
    await page.goto(`${B}/admin/products/${ids.product}`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('main img[src*="paysage"]')
    check((await thumb('main img[src*="paysage"]')).position === '10% 90%', 'champ image')
    await page.goto(B + '/admin/home/home', { waitUntil: 'networkidle0' })
    await page.waitForSelector('[data-item] img[src*="paysage"]')
    check((await thumb('[data-item] img[src*="paysage"]')).position === '10% 90%', 'galerie')
  })

  await step('« Remettre au centre » ; le texte alternatif et le point ne s\'écrasent pas l\'un l\'autre', async () => {
    check((await patch(claire, ids.paysage, { alt: { fr: 'Un coucher de soleil' } })).json.focus.x === 0.1, 'le texte alternatif a effacé le point')
    await openFile(page, ids.paysage)
    await page.waitForSelector('[data-focus-reset]:not([disabled])')
    check((await tool(page)).point === '10% 90%', 'point relu à l\'ouverture : ' + (await tool(page)).point)
    await page.$eval('[data-focus-reset]', el => el.click())
    await saved(ids.paysage, null)
    await says(page, 'Point d\'intérêt remis au centre')
    const state = await tool(page)
    check(state.point === '50% 50%' && state.reset === true, 'après remise au centre : ' + JSON.stringify(state))
    check((await one(ids.paysage)).alt.fr === 'Un coucher de soleil', 'le point a effacé le texte alternatif')
    await openSite(site)
    const square = await shot(site, 'carre')
    check(/\?w=800&r=1x1$/.test(square.src) && square.position === '50% 50%' && !/object-position/.test(square.style), 'site : ' + JSON.stringify(square))
    const sq = await inspect(site, square.src.replace('w=800', 'w=640'))
    check(sq.width === 640 && near(sq.left, 17) && near(sq.right, 83) && sq.asked === 'width=640,height=640,fit=cover', 'recadrage au centre : ' + JSON.stringify(sq))
  })

  await step('droits et saisies refusées : une rédactrice règle le point (comme le texte alternatif), pas un visiteur', async () => {
    const { id, link } = await claire.json('/api/cms/users', { method: 'POST', body: { name: LINA.name, email: LINA.email, role: LINA.role } })
    check(id && (await anon.post(`/api/cms/invite/${link.replace(/^.*\/admin\/invite\//, '')}`, { password: LINA.password })).status === 200, 'invitation')
    check((await lina.signIn(LINA.email, LINA.password)).status === 200, 'connexion de la rédactrice')
    const hers = await patch(lina, ids.paysage, { focus: { x: 0.3, y: 0.6 } })
    check(hers.status === 200 && JSON.stringify(hers.json.focus) === '{"x":0.3,"y":0.6}', 'rédactrice : ' + hers.status + ' ' + hers.text.slice(0, 150))
    check((await patch(anon, ids.paysage, { focus: { x: 0.9, y: 0.9 } })).status === 401, 'visiteur accepté')
    for (const bad of ['centre', 5, [0.2, 0.3], {}, { x: 0.2 }, { x: 1.5, y: 0.5 }, { x: '0.5', y: 0.5 }, { x: -0.1, y: 0 }]) {
      const r = await patch(claire, ids.paysage, { focus: bad })
      check(r.status === 400 && /focus : attendu/.test(r.json.message), `saisie ${JSON.stringify(bad)} : ${r.status}`)
    }
    check(await focusOf(ids.paysage) === '{"x":0.3,"y":0.6}', 'une saisie refusée a changé le point : ' + await focusOf(ids.paysage))
    check((await patch(claire, 'inconnu', { focus: null })).status === 404, 'fichier inconnu')
  })

  await step('journal d\'activité : réglage et remise au centre inscrits, sans doublon quand rien ne change', async () => {
    await patch(claire, ids.paysage, { focus: { x: 0.3, y: 0.6 } }) // inchangé : pas de ligne
    const set = 'Lina Roux a réglé le point d\'intérêt de l\'image « paysage.png » (30 % depuis la gauche, 60 % depuis le haut)'
    const lines = await until(async () => { const l = await journal(); return l.includes(set) && l }, 'ligne du journal : ' + set)
    check(lines.filter(l => l === set).length === 1, 'doublon : ' + JSON.stringify(lines.filter(l => l.includes('point d\'intérêt'))))
    check(lines.includes('Claire Durand a remis au centre le point d\'intérêt de l\'image « paysage.png »'), 'remise au centre : ' + JSON.stringify(lines.filter(l => l.includes('point d\'intérêt'))))
    check(lines.some(l => l.startsWith('Claire Durand a réglé le point d\'intérêt de l\'image « paysage.png » (25 % depuis la gauche, 75 % depuis le haut)')), 'premier réglage absent')
  })

  await step('corbeille et sauvegarde : le point suit le fichier', async () => {
    await patch(claire, ids.portrait, { focus: { x: 0.4, y: 0.15 } })
    await claire.json('/api/cms/backups', { method: 'POST', body: {} })
    const name = (await claire.json('/api/cms/backups')).items[0].name
    const file = await fetch(`${B}/api/cms/backups/${name}/download`, { headers: { cookie: claire.cookie() } })
    check(file.status === 200, `sauvegarde ${name} : ${file.status}`)
    const text = gunzipSync(Buffer.from(await file.arrayBuffer())).toString('utf8')
    check(text.includes('{\\"x\\":0.4,\\"y\\":0.15}') || text.includes('{"x":0.4,"y":0.15}'), 'le point manque dans la sauvegarde')

    const deleted = await claire.call(`/api/cms/media/${ids.portrait}`, { method: 'DELETE' })
    check(deleted.status === 200, 'mise à la corbeille : ' + deleted.text.slice(0, 150))
    const item = (await claire.json('/api/cms/trash')).items.find(i => i.title === 'portrait.png')
    check(item?.thumbnailPosition === '40% 15%', 'corbeille : ' + JSON.stringify(item))
    await page.bringToFront()
    await page.goto(B + '/admin/trash', { waitUntil: 'networkidle0' })
    await page.waitForSelector('[data-trash-item] img')
    check(await page.$eval('[data-trash-item] img', i => getComputedStyle(i).objectPosition) === '40% 15%', 'vignette de la corbeille')
    const restored = await claire.call(`/api/cms/trash/${item.id}/restore`, { method: 'POST', body: {} })
    check(restored.status === 200 && await focusOf(ids.portrait) === '{"x":0.4,"y":0.15}', 'restauration : ' + restored.status + ' ' + await focusOf(ids.portrait))
  })

  await step('import : « focus » à côté de « file » et « alt » ; relance sans changement ; point corrigé', async () => {
    const dir = path.join(config.tmpDir, 'import-recadrage')
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
    fs.copyFileSync(t.fixture('atelier.png'), path.join(dir, 'atelier.png'))
    fs.writeFileSync(path.join(dir, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>')
    const write = (data) => { const file = path.join(dir, 'contenus.json'); fs.writeFileSync(file, JSON.stringify(data, null, 2)); return file }
    const run = args => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [BIN, ...args, '--url', B], { cwd: config.playgroundDir, env: { ...process.env, CMS_EMAIL: admin.email, CMS_PASSWORD: admin.password, CMS_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      child.stdout.on('data', (d) => { out += d })
      child.stderr.on('data', (d) => { out += d })
      child.on('error', reject)
      child.on('close', code => resolve({ code, out }))
    })
    const data = focus => ({ collections: { products: [
      { id: 'atelier', title: 'Visite de l\'atelier', image: { file: 'atelier.png', alt: 'L\'atelier', focus } },
      { id: 'logo', title: 'Autocollant', image: { file: 'logo.svg', focus: { x: 0.1, y: 0.1 } } },
    ] } })
    const bad = await run([write(data({ x: 3, y: 0 })), '--dry-run'])
    check(bad.code !== 0 && /image\.focus : attendu le point d'intérêt de l'image/.test(bad.out), 'saisie refusée attendue\n' + bad.out)
    const file = write(data({ x: 0.3, y: 0.2 }))
    const first = await run([file])
    check(first.code === 0 && /envoyé\s+atelier\.png/.test(first.out), 'premier import\n' + first.out)
    const atelier = (await media()).find(m => m.name === 'atelier.png')
    check(JSON.stringify(atelier.focus) === '{"x":0.3,"y":0.2}' && atelier.alt.fr === 'L\'atelier', 'fichier importé : ' + JSON.stringify(atelier))
    check((await media()).find(m => m.name === 'logo.svg' && m.id !== ids.svg).focus === null, 'un SVG ne reçoit pas de point')
    const again = await run([file])
    check(again.code === 0 && /déjà présent\s+atelier\.png/.test(again.out) && !/point réglé/.test(again.out), 'relance\n' + again.out)
    const dry = await run([write(data({ x: 0.6, y: 0.7 })), '--dry-run'])
    check(dry.code === 0 && /point à régler\s+atelier\.png/.test(dry.out) && JSON.stringify((await one(atelier.id)).focus) === '{"x":0.3,"y":0.2}', 'simulation\n' + dry.out)
    const changed = await run([write(data({ x: 0.6, y: 0.7 }))])
    check(changed.code === 0 && /point réglé\s+atelier\.png/.test(changed.out) && JSON.stringify((await one(atelier.id)).focus) === '{"x":0.6,"y":0.7}', 'correction\n' + changed.out)
  })

  await step('largeur de téléphone : fiche lisible, point placé au doigt ; page du site sans débordement', async () => {
    const phone = await t.newPage({ width: 390, height: 800 })
    await login(phone, B)
    await openFile(phone, ids.paysage)
    await phone.waitForSelector('[data-focus-point]')
    await phone.touchscreen.tap(...await at(phone, 0.6, 0.4))
    await saved(ids.paysage, 0.6, 0.4)
    const layout = await phone.evaluate(() => {
      const area = document.querySelector('[data-focus-area]').getBoundingClientRect()
      const previews = [...document.querySelectorAll('[data-focus-preview]')].map(el => el.getBoundingClientRect())
      return { overflow: document.documentElement.scrollWidth - innerWidth, area: [Math.round(area.left), Math.round(area.right)], previews: previews.every(b => b.left >= 0 && b.right <= innerWidth && b.width > 20) }
    })
    check(layout.overflow <= 0 && layout.area[0] >= 0 && layout.area[1] <= 390 && layout.previews, 'mise en page : ' + JSON.stringify(layout))
    check((await tool(phone)).point === '60% 40%', 'point au doigt : ' + (await tool(phone)).point)
    // Glisser au doigt.
    const [x1, y1] = await at(phone, 0.6, 0.4), [x2, y2] = await at(phone, 0.2, 0.8)
    await phone.touchscreen.touchStart(x1, y1)
    await phone.touchscreen.touchMove((x1 + x2) / 2, (y1 + y2) / 2)
    await phone.touchscreen.touchMove(x2, y2)
    await phone.touchscreen.touchEnd()
    await saved(ids.paysage, 0.2, 0.8)
    await openSite(phone)
    const page2 = await phone.evaluate(() => ({ overflow: document.documentElement.scrollWidth - innerWidth, loaded: [...document.querySelectorAll('main img')].every(i => i.naturalWidth > 0) }))
    check(page2.overflow <= 0 && page2.loaded, 'page du site : ' + JSON.stringify(page2))
    const square = await shot(phone, 'carre')
    check(/&r=1x1&f=20-80$/.test(square.current) && square.position === '20% 80%', 'carré : ' + JSON.stringify(square))
    await phone.close()
  })
}
