// Galeries (champ image avec plusieurs images, légendes) et sections du formulaire : par le navigateur, puis par l'outil d'import.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { config } from '../lib/config.mjs'
import { check, clickText, fieldset, json, login, says, send, until } from '../lib/harness.mjs'

export const meta = { title: 'galeries (sélection multiple, envoi, ordre, légendes, retrait, répéteur, import) et sections repliables du formulaire' }

export default async function (t) {
  const { B, step } = t
  const page = await t.newPage({ width: 1500, height: 1300 })

  // ───── Outils propres à la suite ─────
  const sectionSel = label => `section.cms-section[data-section="${label}"]`
  /** État des sections qui portent ce titre (une par volet de langue) : true si dépliée. */
  const sectionStates = label => page.$$eval(`${sectionSel(label)} > h3 > button`, els => els.map(e => e.getAttribute('aria-expanded') === 'true'))
  const toggleSection = (label, n = 0) => page.$$eval(`${sectionSel(label)} > h3 > button`, (els, n) => els[n].click(), n)
  /** Vignettes d'une galerie : nom du fichier et légende, dans l'ordre affiché. `n` : la n-ième galerie de ce nom. */
  const gallery = (label, n = 0) => page.evaluate((label, n) => {
    const set = [...document.querySelectorAll('fieldset')].filter(f => f.querySelector('legend')?.textContent.replace('*', '').trim() === label)[n]
    return [...set.querySelectorAll('li[data-item]')].map(li => [li.querySelector('[draggable]').title, li.querySelector('input')?.value ?? null])
  }, label, n)
  const names = list => list.map(([name]) => name.replace(/\.png$/, '')).join(',')
  /** Bouton d'une vignette, par son libellé accessible (« Retirer image 2 »…). */
  const press = (label, n = 0) => page.evaluate((label, n) => {
    const buttons = [...document.querySelectorAll(`button[aria-label="${label}"]`)]
    buttons[n].click()
  }, label, n)
  /** Tape une légende sous la vignette `index` de la n-ième galerie de ce nom. */
  const caption = async (label, index, text, n = 0) => {
    const input = await page.evaluateHandle((label, index, n) => {
      const f = [...document.querySelectorAll('fieldset')].filter(f => f.querySelector('legend')?.textContent.replace('*', '').trim() === label)[n]
      return f.querySelectorAll('li[data-item] input')[index]
    }, label, index, n)
    await input.asElement().type(text)
  }
  /** Fenêtre de choix : coche les fichiers dans cet ordre (par début de nom), puis les ajoute. */
  const pick = async (...files) => {
    await page.waitForSelector('.modal-open .grid button')
    for (const file of files) {
      await page.$$eval('.modal-open .grid button', (els, file) => els.find(e => e.title.startsWith(file)).click(), file)
    }
    await clickText(page, '.modal-open .modal-action button', 'Ajouter')
    await page.waitForFunction(() => !document.querySelector('.modal-open'))
  }
  const publish = async () => {
    await clickText(page, 'button', 'Publier')
    await says(page, 'Publié. Le site est à jour.')
    await page.waitForFunction(() => !document.body.innerText.includes('Modifications non enregistrées'))
  }

  await step('connexion', () => login(page, B))

  // ───── Galerie au premier niveau (accueil) ─────

  await step('section repliée par défaut : ses champs sont cachés, un clic la déplie', async () => {
    await page.goto(B + '/admin/home/home', { waitUntil: 'networkidle0' })
    check(JSON.stringify(await sectionStates('Le cabinet en images')) === '[false]', 'la section devait être repliée : ' + JSON.stringify(await sectionStates('Le cabinet en images')))
    check(JSON.stringify(await sectionStates('Bandeau')) === '[true,true]', 'Bandeau : dépliée, dans la zone traduite et dans la zone commune')
    const hidden = await (await fieldset(page, 'Photos du cabinet')).evaluate(el => el.offsetParent === null)
    check(hidden, 'la galerie devait être cachée')
    check(await page.$eval(`${sectionSel('Le cabinet en images')} button`, el => el.textContent.includes('1 champ')), 'le nombre de champs d\'une section repliée est indiqué')
    await toggleSection('Le cabinet en images')
    await page.waitForFunction(sel => document.querySelector(sel).querySelector('[role=region]').offsetParent !== null, {}, sectionSel('Le cabinet en images'))
  })

  await step('galerie : trois fichiers envoyés d\'un coup depuis la fenêtre de choix, cochés dans l\'ordre d\'envoi', async () => {
    await clickText(page, 'button', 'Ajouter des images')
    await page.waitForSelector('.modal-open input[type=file]')
    const input = await page.$('.modal-open input[type=file]')
    await input.uploadFile(t.fixture('atelier.png'), t.fixture('chantier.png'), t.fixture('reunion.png'))
    await page.waitForFunction(() => document.querySelector('.modal-open .modal-action')?.textContent.includes('3 sélectionnées'))
    await clickText(page, '.modal-open .modal-action button', 'Ajouter 3 images')
    await page.waitForFunction(() => !document.querySelector('.modal-open'))
    const list = await gallery('Photos du cabinet')
    check(names(list) === 'atelier,chantier,reunion', 'ordre : ' + JSON.stringify(list))
  })

  await step('légendes, ordre au clavier, glisser-déposer, retrait', async () => {
    await caption('Photos du cabinet', 0, 'Atelier de Lyon')
    await caption('Photos du cabinet', 1, 'Chantier (69)')
    // Clavier : « Déplacer après » sur la première image ; le focus suit l'image.
    const after = await page.$('button[aria-label="Déplacer image 1 après"]')
    await after.focus()
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => document.activeElement?.closest('li[data-item]')?.dataset.item === '1')
    check(names(await gallery('Photos du cabinet')) === 'chantier,atelier,reunion', 'clavier : ' + JSON.stringify(await gallery('Photos du cabinet')))
    // Glisser-déposer : la troisième image en tête.
    await page.evaluate(() => {
      const items = [...document.querySelectorAll('li[data-item]')]
      const dt = new DataTransfer()
      const handle = items[2].querySelector('[draggable]')
      handle.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
      items[0].dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
      handle.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }))
    })
    let list = await gallery('Photos du cabinet')
    check(names(list) === 'reunion,chantier,atelier', 'glisser-déposer : ' + JSON.stringify(list))
    // La légende suit son image.
    check(list[2][1] === 'Atelier de Lyon' && list[1][1] === 'Chantier (69)' && list[0][1] === '', 'légendes : ' + JSON.stringify(list))
    await press('Retirer image 2')
    list = await gallery('Photos du cabinet')
    check(names(list) === 'reunion,atelier' && list[1][1] === 'Atelier de Lyon', 'retrait : ' + JSON.stringify(list))
  })

  await step('fenêtre de choix : les images déjà présentes ne se choisissent pas deux fois ; ajout d\'une image existante', async () => {
    await clickText(page, 'button', 'Ajouter des images')
    await page.waitForSelector('.modal-open .grid button')
    const taken = await page.$$eval('.modal-open .grid button[aria-disabled="true"]', els => els.map(e => e.title).sort().join())
    check(taken === 'atelier.png,reunion.png', 'déjà ajoutées : ' + taken)
    // Un clic sur une image déjà présente ne la sélectionne pas.
    await page.$$eval('.modal-open .grid button', els => els.find(e => e.title === 'atelier.png').click())
    check(await page.$$eval('.modal-open .grid button[aria-pressed="true"]', els => els.length) === 0, 'une image déjà présente a été sélectionnée')
    await page.$$eval('.modal-open .grid button', els => els.find(e => e.title === 'chantier.png').click())
    await clickText(page, '.modal-open .modal-action button', 'Ajouter 1 image')
    await page.waitForFunction(() => !document.querySelector('.modal-open'))
    await caption('Photos du cabinet', 2, 'Le chantier')
    check(names(await gallery('Photos du cabinet')) === 'reunion,atelier,chantier', JSON.stringify(await gallery('Photos du cabinet')))
  })

  await step('fichier déposé directement sur la galerie : envoyé et ajouté à la fin', async () => {
    await page.evaluate(async () => {
      const canvas = Object.assign(document.createElement('canvas'), { width: 90, height: 60 })
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#c63'
      ctx.fillRect(0, 0, 90, 60)
      const blob = await new Promise(r => canvas.toBlob(r, 'image/png'))
      const dt = new DataTransfer()
      dt.items.add(new File([blob], 'depot.png', { type: 'image/png' }))
      const root = [...document.querySelectorAll('fieldset')].find(f => f.querySelector('legend')?.textContent.trim() === 'Photos du cabinet').querySelector('.cms-gallery')
      root.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
    })
    await until(async () => (await gallery('Photos du cabinet')).length === 4, 'la quatrième image')
    check(names(await gallery('Photos du cabinet')) === 'reunion,atelier,chantier,depot', JSON.stringify(await gallery('Photos du cabinet')))
  })

  await step('publication : le site reçoit les images dans l\'ordre, avec leurs légendes (null si vide)', async () => {
    await (await fieldset(page, 'Titre principal')).$eval('input', el => el.focus())
    await page.keyboard.type('Bienvenue')
    await publish()
    const home = await json(page, '/api/content/home')
    const got = home.gallery.map(p => [p.name, p.caption])
    check(JSON.stringify(got) === JSON.stringify([['reunion.png', null], ['atelier.png', 'Atelier de Lyon'], ['chantier.png', 'Le chantier'], ['depot.png', null]]), 'API : ' + JSON.stringify(got))
    check(home.gallery.every(p => p.url.startsWith('/media/') && p.mime === 'image/png' && p.width > 0), 'fichiers : ' + JSON.stringify(home.gallery[0]))
    // Enregistré sous sa forme documentée.
    const saved = await json(page, '/api/cms/entries/home/home')
    check(saved.shared.gallery.length === 4 && saved.shared.gallery[1].caption === 'Atelier de Lyon' && typeof saved.shared.gallery[1].media === 'string', 'en base : ' + JSON.stringify(saved.shared.gallery))
    const site = await t.newPage()
    await site.goto(B + '/', { waitUntil: 'networkidle0' })
    const shown = await site.$$eval('main .cms-gallery figure', figs => figs.map(f => [f.querySelector('img')?.getAttribute('src')?.split('/').pop()?.split('?')[0], f.querySelector('figcaption')?.textContent ?? null]))
    check(JSON.stringify(shown) === JSON.stringify([['reunion.png', null], ['atelier.png', 'Atelier de Lyon'], ['chantier.png', 'Le chantier'], ['depot.png', null]]), 'site : ' + JSON.stringify(shown))
    await site.close()
  })

  await step('médiathèque : « Utilisé dans » voit la galerie ; suppression d\'un fichier utilisé refusée', async () => {
    const media = await json(page, '/api/cms/media')
    const reunion = media.find(m => m.name === 'reunion.png')
    const usage = await json(page, `/api/cms/media/${reunion.id}/usage`)
    check(usage.length === 1 && usage[0].label === 'Accueil', 'usage : ' + JSON.stringify(usage))
    const r = await page.evaluate(async id => (await fetch(`/api/cms/media/${id}`, { method: 'DELETE' })).status, reunion.id)
    check(r === 409, 'suppression : statut ' + r)
  })

  await step('section dont tous les champs sont masqués (showIf) : elle disparaît', async () => {
    const toggle = async () => page.evaluate(() => [...document.querySelectorAll('label')].find(l => l.textContent.includes('Afficher une galerie de photos')).querySelector('input').click())
    await toggle()
    await page.waitForFunction(sel => !document.querySelector(sel), {}, sectionSel('Le cabinet en images'))
    await toggle()
    await page.waitForSelector(sectionSel('Le cabinet en images'))
  })

  // ───── Galerie dans un répéteur, erreurs, traductions ─────

  let serviceId
  await step('erreur dans une section repliée : à la publication, la section s\'ouvre et signale l\'erreur', async () => {
    const created = JSON.parse((await send(page, '/api/cms/entries/services', { values: { title: 'Rénovation', onQuote: true, cases: [{ text: 'Sans titre pour l\'instant.' }] } })).body)
    serviceId = created.id
    check(serviceId, 'création : ' + JSON.stringify(created))
    await page.goto(`${B}/admin/services/${serviceId}`, { waitUntil: 'networkidle0' })
    check(JSON.stringify(await sectionStates('Réalisations')) === '[false]', 'Réalisations devait être repliée')
    await clickText(page, 'button', 'Publier')
    await says(page, 'Certains champs sont à corriger')
    await page.waitForFunction(sel => document.querySelector(sel + ' > h3 > button').getAttribute('aria-expanded') === 'true', {}, sectionSel('Réalisations'))
    check(await page.$eval(sectionSel('Réalisations'), el => el.textContent.includes('1 à corriger')), 'la section devait signaler l\'erreur')
  })

  await step('répéteur : chaque élément a sa galerie, composée et légendée', async () => {
    // Ouvre l'élément du répéteur et le corrige.
    await page.$eval(`${sectionSel('Réalisations')} fieldset .cursor-pointer`, el => el.click())
    const title = await page.waitForSelector(`${sectionSel('Réalisations')} fieldset fieldset input`)
    await title.type('Toiture à Lyon')
    await page.$$eval(`${sectionSel('Réalisations')} button`, els => els.find(e => e.textContent.includes('Ajouter des images')).click())
    await pick('reunion', 'atelier')
    await caption('Photos', 0, 'Avant')
    await caption('Photos', 1, 'Après')
    check(names(await gallery('Photos')) === 'reunion,atelier', JSON.stringify(await gallery('Photos')))
  })

  await step('traductions côte à côte : la section s\'ouvre et se ferme dans les deux langues ; l\'anglais a sa propre galerie', async () => {
    await page.evaluate(() => [...document.querySelectorAll('label')].find(l => l.textContent.includes('Côte à côte')).querySelector('input').click())
    await page.waitForFunction(sel => document.querySelectorAll(sel).length === 2, {}, sectionSel('Réalisations'))
    await toggleSection('Réalisations', 1)
    check(JSON.stringify(await sectionStates('Réalisations')) === '[false,false]', 'fermée dans les deux volets : ' + JSON.stringify(await sectionStates('Réalisations')))
    await toggleSection('Réalisations', 0)
    check(JSON.stringify(await sectionStates('Réalisations')) === '[true,true]', 'ouverte dans les deux volets : ' + JSON.stringify(await sectionStates('Réalisations')))
    // Volet anglais : un élément, une image légendée en anglais.
    const en = (await page.$$(sectionSel('Réalisations')))[1]
    const pane = (await en.evaluateHandle(el => el.closest('.p-5'))).asElement()
    await (await pane.$('fieldset input')).type('Renovation')
    await en.evaluate(el => [...el.querySelectorAll('button')].find(b => b.textContent.trim() === 'Ajouter').click())
    const enTitle = await en.waitForSelector('fieldset fieldset input')
    await enTitle.type('Roof in Lyon')
    await en.evaluate(el => [...el.querySelectorAll('button')].find(b => b.textContent.includes('Ajouter des images')).click())
    await pick('atelier')
    await caption('Photos', 0, 'Before', 1)
    await publish()
    const fr = await json(page, `/api/content/services/${serviceId}`)
    const enItem = await json(page, `/api/content/services/${serviceId}?locale=en`)
    const shape = item => JSON.stringify(item.cases.map(c => [c.title, c.photos.map(p => [p.name, p.caption])]))
    check(shape(fr) === JSON.stringify([['Toiture à Lyon', [['reunion.png', 'Avant'], ['atelier.png', 'Après']]]]), 'français : ' + shape(fr))
    check(shape(enItem) === JSON.stringify([['Roof in Lyon', [['atelier.png', 'Before']]]]), 'anglais : ' + shape(enItem))
    const site = await t.newPage()
    await site.goto(B + fr.path, { waitUntil: 'networkidle0' })
    const captions = await site.$$eval('.cms-case figcaption', els => els.map(e => e.textContent))
    check(captions.join() === 'Avant,Après', 'site : ' + captions.join())
    await site.close()
  })

  await step('API : une galerie s\'écrit aussi en liste d\'identifiants ; clé inconnue refusée', async () => {
    const media = await json(page, '/api/cms/media')
    const ids = ['chantier.png', 'depot.png'].map(n => media.find(m => m.name === n).id)
    const ok = await send(page, `/api/cms/entries/services/${serviceId}`, { values: { cases: [{ title: 'Toiture à Lyon', photos: ids }] } }, 'PUT')
    check(ok.status === 200, 'écriture : ' + ok.status + ' ' + ok.body.slice(0, 200))
    check(JSON.stringify(JSON.parse(ok.body).locales.fr.values.cases[0].photos) === JSON.stringify(ids.map(media => ({ media }))), 'forme enregistrée : ' + ok.body.slice(0, 300))
    const bad = await send(page, `/api/cms/entries/services/${serviceId}`, { values: { cases: [{ title: 'x', photos: [{ media: ids[0], legende: 'non' }] }] } }, 'PUT')
    check(bad.status === 422 && bad.body.includes('cases.0.photos.0.legende'), 'clé inconnue : ' + bad.status + ' ' + bad.body.slice(0, 200))
  })

  // ───── Import ─────

  await step('outil d\'import : une galerie écrite comme une liste de chemins, avec légende et texte alternatif', async () => {
    const dir = path.join(config.tmpDir, 'import-galerie')
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
    fs.copyFileSync(t.fixture('atelier.png'), path.join(dir, 'a.png'))
    fs.copyFileSync(t.fixture('Photo du Cabinet.png'), path.join(dir, 'b.png'))
    const file = path.join(dir, 'contenus.json')
    fs.writeFileSync(file, JSON.stringify({
      collections: {
        services: [{
          id: 'importe',
          title: 'Service importé',
          onQuote: true,
          cases: [{ title: 'Cas importé', photos: ['b.png', { file: 'a.png', alt: 'Vue de l\'atelier', caption: 'Lyon (69)' }] }],
        }],
      },
    }))
    const out = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(config.rootDir, 'packages', 'cms', 'bin', 'import.mjs'), file, '--url', B], {
        cwd: config.playgroundDir,
        env: { ...process.env, CMS_EMAIL: t.admin.email, CMS_PASSWORD: t.admin.password, CMS_URL: '' },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let text = ''
      child.stdout.on('data', d => { text += d })
      child.stderr.on('data', d => { text += d })
      child.on('error', reject)
      child.on('close', code => resolve({ code, text }))
    })
    check(out.code === 0 && out.text.includes('1 créé'), 'import : ' + out.text)
    const services = await json(page, '/api/content/services')
    const item = services.find(s => s.title === 'Service importé')
    const photos = item?.cases[0]?.photos ?? []
    check(photos.length === 2 && photos[0].caption === null && photos[1].caption === 'Lyon (69)' && photos[1].alt === 'Vue de l\'atelier', 'site : ' + JSON.stringify(photos))
  })
}
