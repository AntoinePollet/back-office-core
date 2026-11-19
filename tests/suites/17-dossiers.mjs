// Dossiers de la médiathèque : création, envoi dans un dossier, déplacements (glisser-déposer, « Déplacer vers… »),
// renommage, suppression, recherche, fenêtre de choix d'une image, adresses publiques inchangées, droits, import.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { config } from '../lib/config.mjs'
import { api, check, clickText, json, login, says, send, until } from '../lib/harness.mjs'

export const meta = { title: 'dossiers de la médiathèque : créer, envoyer, déplacer, renommer, supprimer, rechercher, choisir une image, droits, import' }

const LINA = { name: 'Lina Roux', email: 'lina@example.com', password: 'mot-de-passe-de-lina', role: 'writer' }
const BIN = path.join(config.rootDir, 'packages', 'cms', 'bin', 'import.mjs')

export default async function (t) {
  const { B, step } = t
  const page = await t.newPage()
  const admin = t.http(), anon = t.http()
  /** Messages des boîtes de confirmation (acceptées d'office par le lanceur). */
  const dialogs = []
  page.on('dialog', d => dialogs.push(d.message()))

  // ───── Outils propres à la suite ─────
  const media = () => json(page, '/api/cms/media')
  const folders = () => json(page, '/api/cms/media/folders')
  const fileByName = async name => (await media()).find(m => m.name === name)
  const folderByName = async name => (await folders()).find(f => f.name === name)
  /** Fil d'Ariane affiché (dans la fenêtre de choix si `root` le précise). */
  const crumbs = (root = '') => page.$$eval(`${root} nav[aria-label^="Emplacement"] li`, lis => lis.map(li => li.textContent.trim()).join(' › '))
  const openFolder = async (name, root = '') => {
    await clickText(page, `${root} [data-media-folder]`, name)
    await page.waitForFunction((root, name) => document.querySelector(`${root} nav[aria-label^="Emplacement"] [aria-current]`)?.textContent.trim() === name, {}, root, name)
  }
  const goRoot = async (root = '') => {
    await page.$eval(`${root} [data-crumb=""]`, el => el.click())
    await page.waitForFunction(root => document.querySelector(`${root} [data-crumb=""]`)?.getAttribute('aria-current') === 'location', {}, root)
  }
  const tile = name => page.$(`.cms-media-library [data-media] button[title="${name}"]`)
  const upload = async (file, root = '') => {
    const input = await page.$(`${root} .cms-media-library input[type=file]`)
    const done = page.waitForResponse(r => r.url().endsWith('/api/cms/media') && r.request().method() === 'POST')
    await input.uploadFile(t.fixture(file))
    const r = await done
    check(r.ok(), `envoi de ${file} : ${r.status()}`)
  }
  /** Glisser-déposer simulé (les vrais événements de la page, avec un DataTransfer partagé). */
  const dragTo = (fromSel, toSel) => page.evaluate((fromSel, toSel) => {
    const from = document.querySelector(fromSel), to = document.querySelector(toSel)
    if (!from || !to) throw new Error(`glisser-déposer : ${from ? toSel : fromSel} introuvable`)
    const dt = new DataTransfer()
    from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
    to.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
    to.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
    from.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }))
  }, fromSel, toSel)
  const newFolder = async (name) => {
    await clickText(page, '.cms-media-library button', 'Nouveau dossier')
    await page.waitForSelector('[data-cms-folder-name] input')
    await page.type('[data-cms-folder-name] input', name)
    await clickText(page, '[data-cms-folder-name] button', 'Créer')
  }

  await step('connexion', async () => {
    await login(page, B)
    check((await admin.signIn(t.admin.email, t.admin.password)).status === 200, 'connexion de l\'outil HTTP refusée')
  })

  await step('créer des dossiers, à la racine et dans un dossier ; nom déjà pris refusé', async () => {
    await page.goto(B + '/admin/media', { waitUntil: 'networkidle0' })
    check((await crumbs()) === 'Médiathèque', 'fil d\'Ariane à la racine : ' + await crumbs())
    await newFolder('Chantiers')
    await says(page, 'Dossier « Chantiers » créé')
    await page.waitForFunction(() => !document.querySelector('[data-cms-folder-name]'))
    await newFolder('Logos')
    await says(page, 'Dossier « Logos » créé')
    await page.waitForFunction(() => !document.querySelector('[data-cms-folder-name]'))
    await openFolder('Chantiers')
    check((await crumbs()) === 'Médiathèque › Chantiers', 'fil d\'Ariane : ' + await crumbs())
    await newFolder('Toiture')
    await says(page, 'Dossier « Toiture » créé')
    await page.waitForFunction(() => !document.querySelector('[data-cms-folder-name]'))
    // Même nom au même endroit, aux majuscules près : refusé, la fenêtre reste ouverte.
    await goRoot()
    await newFolder('chantiers')
    await says(page, 'Un dossier « chantiers » existe déjà ici.')
    await clickText(page, '[data-cms-folder-name] button', 'Annuler')
    const list = await folders()
    const chantiers = list.find(f => f.name === 'Chantiers')
    check(list.length === 3 && list.find(f => f.name === 'Toiture')?.parentId === chantiers?.id, 'dossiers : ' + JSON.stringify(list))
    // Limites vérifiées par le serveur.
    const long = await send(page, '/api/cms/media/folders', { name: 'x'.repeat(61) })
    check(long.status === 400 && long.body.includes('60 caractères'), 'nom trop long : ' + long.status + ' ' + long.body.slice(0, 200))
    const slash = await send(page, '/api/cms/media/folders', { name: 'a/b' })
    check(slash.status === 400 && slash.body.includes('« / »'), 'nom avec / : ' + slash.status)
  })

  await step('envoyer des fichiers directement dans le dossier ouvert ; nombre de fichiers par dossier', async () => {
    await openFolder('Chantiers')
    await openFolder('Toiture')
    check((await crumbs()) === 'Médiathèque › Chantiers › Toiture', 'fil d\'Ariane : ' + await crumbs())
    await says(page, 'ils seront rangés dans « Toiture »')
    await upload('atelier.png')
    await says(page, 'Fichier importé dans « Toiture »')
    check(await tile('atelier.png'), 'le fichier doit s\'afficher dans le dossier')
    check((await fileByName('atelier.png')).folderId === (await folderByName('Toiture')).id, 'atelier.png devait être dans Toiture')
    await goRoot()
    await upload('chantier.png')
    await upload('reunion.png')
    check((await fileByName('chantier.png')).folderId === null && (await fileByName('reunion.png')).folderId === null, 'envoyés à la racine')
    check(!(await tile('atelier.png')), 'un fichier rangé ne s\'affiche pas à la racine')
    const summary = name => page.$$eval('[data-media-folder]', (els, name) => els.find(e => e.textContent.includes(name))?.innerText.replace(/\s+/g, ' ').trim(), name)
    check((await summary('Chantiers')) === 'Chantiers 1 dossier', 'Chantiers : ' + await summary('Chantiers'))
    check((await summary('Logos')) === 'Logos Vide', 'Logos : ' + await summary('Logos'))
    await openFolder('Chantiers')
    check((await summary('Toiture')) === 'Toiture 1 fichier', 'Toiture : ' + await summary('Toiture'))
    await t.shot(page, 'dossier')
  })

  let url, slug
  await step('le site affiche une image de la médiathèque (avant tout déplacement)', async () => {
    const chantier = await fileByName('chantier.png')
    url = chantier.url
    check(/^\/media\/[0-9a-f-]{36}\/chantier\.png$/.test(url), 'adresse : ' + url)
    const r = await admin.post('/api/cms/entries/services', { values: { title: 'Isolation des combles', onQuote: true, cover: chantier.id }, publish: ['fr'] })
    check(r.status === 200, 'service : ' + r.status + ' ' + r.text.slice(0, 200))
    slug = (await anon.json('/api/content/services')).find(s => s.title === 'Isolation des combles').slug
    const html = (await anon.get(`/services/${slug}`)).text
    check(html.includes(url), 'la page du service doit afficher ' + url)
  })

  await step('glisser-déposer : deux fichiers cochés sur un dossier, puis un fichier sur le fil d\'Ariane', async () => {
    await goRoot()
    // Cocher au clavier : la case est un vrai champ, atteignable par Tab.
    for (const name of ['chantier.png', 'reunion.png']) {
      const box = await page.$(`[data-media]:has(button[title="${name}"]) input[type=checkbox]`)
      await box.focus()
      await page.keyboard.press('Space')
    }
    await page.waitForFunction(() => document.querySelector('[data-selection]')?.textContent.includes('2 fichiers sélectionnés'))
    await t.shot(page, 'selection')
    const logos = await folderByName('Logos')
    await dragTo('[data-media] button[title="chantier.png"]', `[data-media-folder="${logos.id}"]`)
    await says(page, '2 fichiers déplacés dans « Logos »')
    check(!(await tile('chantier.png')) && !(await tile('reunion.png')), 'les fichiers déplacés quittent la racine')
    check((await fileByName('chantier.png')).folderId === logos.id && (await fileByName('reunion.png')).folderId === logos.id, 'dans Logos')
    // Depuis Logos, reunion.png glissé sur « Médiathèque » dans le fil d'Ariane : retour à la racine.
    await openFolder('Logos')
    await dragTo('[data-media] button[title="reunion.png"]', '[data-crumb=""]')
    await says(page, 'Fichier déplacé dans « Médiathèque »')
    check((await fileByName('reunion.png')).folderId === null, 'reunion.png devait revenir à la racine')
  })

  await step('« Déplacer vers… » : depuis la fiche du fichier, dossier choisi dans la liste', async () => {
    await goRoot()
    await (await tile('reunion.png')).evaluate(el => el.click())
    await page.waitForSelector('[data-media-folder-info]')
    check((await page.$eval('[data-media-folder-info]', el => el.textContent)).includes('Médiathèque'), 'emplacement dans la fiche')
    await clickText(page, '[data-media-folder-info] button', 'Déplacer vers…')
    await page.waitForSelector('[data-cms-move]')
    // La liste est utilisable au clavier : le premier choix possible a le focus.
    check(await page.evaluate(() => document.activeElement?.closest('[data-cms-move]') !== null), 'le focus doit être dans la fenêtre')
    check(await page.$eval('[data-cms-move] [data-folder=""]', el => el.disabled), 'l\'emplacement actuel ne se choisit pas')
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-cms-move] .modal-box')).opacity === '1')
    await t.shot(page, 'deplacer-vers')
    const toiture = await folderByName('Toiture')
    await page.$eval(`[data-cms-move] [data-folder="${toiture.id}"]`, el => el.click())
    await clickText(page, '[data-cms-move] button', 'Déplacer ici')
    await says(page, 'Fichier déplacé dans « Chantiers › Toiture »')
    check((await fileByName('reunion.png')).folderId === toiture.id, 'reunion.png devait être dans Toiture')
    await page.waitForFunction(() => document.querySelector('[data-media-folder-info]')?.textContent.includes('Chantiers › Toiture'))
  })

  await step('adresse publique inchangée après déplacement : le site affiche toujours l\'image', async () => {
    const chantier = await fileByName('chantier.png')
    check(chantier.url === url, `adresse changée : ${chantier.url} au lieu de ${url}`)
    const html = (await anon.get(`/services/${slug}`)).text
    check(html.includes(url), 'la page du service doit toujours afficher ' + url)
    const file = await anon.get(url)
    check(file.status === 200 && file.headers.get('content-type') === 'image/png', 'fichier servi : ' + file.status)
    const site = (await anon.json('/api/content/services')).find(s => s.slug === slug)
    check(site.cover.url === url, 'API publique : ' + JSON.stringify(site.cover))
  })

  await step('renommer un dossier ; un dossier ne se déplace pas dans lui-même', async () => {
    await openFolder('Logos')
    await clickText(page, '[data-folder-actions] button', 'Renommer')
    const input = await page.waitForSelector('[data-cms-folder-name] input')
    check(await input.evaluate(el => el.value === 'Logos'), 'le nom actuel est proposé')
    await input.evaluate(el => { el.value = ''; el.dispatchEvent(new Event('input')) })
    await input.type('Logos et marques')
    await clickText(page, '[data-cms-folder-name] button', 'Renommer')
    await says(page, 'Dossier renommé « Logos et marques »')
    check((await crumbs()) === 'Médiathèque › Logos et marques', 'fil d\'Ariane : ' + await crumbs())
    check(await folderByName('Logos et marques'), 'nom enregistré')

    const chantiers = await folderByName('Chantiers'), toiture = await folderByName('Toiture')
    await goRoot()
    await openFolder('Chantiers')
    await clickText(page, '[data-folder-actions] button', 'Déplacer')
    await page.waitForSelector('[data-cms-move]')
    check(await page.$eval(`[data-cms-move] [data-folder="${toiture.id}"]`, el => el.disabled), 'Toiture (sous-dossier) ne doit pas être proposé')
    check(await page.$eval(`[data-cms-move] [data-folder="${chantiers.id}"]`, el => el.disabled), 'Chantiers lui-même ne doit pas être proposé')
    await clickText(page, '[data-cms-move] button', 'Annuler')
    const r = await send(page, `/api/cms/media/folders/${chantiers.id}`, { parentId: toiture.id }, 'PATCH')
    check(r.status === 409 && r.body.includes('dans lui-même'), 'le serveur doit refuser : ' + r.status)
    // Glisser un dossier sur un autre : il s'y range.
    await goRoot()
    const logos = await folderByName('Logos et marques')
    await dragTo(`[data-media-folder="${logos.id}"]`, `[data-media-folder="${chantiers.id}"]`)
    await says(page, 'Dossier « Logos et marques » déplacé dans « Chantiers »')
    check((await folderByName('Logos et marques')).parentId === chantiers.id, 'Logos et marques devait être dans Chantiers')
    await openFolder('Chantiers')
    await openFolder('Logos et marques')
    await clickText(page, '[data-folder-actions] button', 'Déplacer')
    await page.waitForSelector('[data-cms-move]')
    await page.$eval('[data-cms-move] [data-folder=""]', el => el.click())
    await clickText(page, '[data-cms-move] button', 'Déplacer ici')
    await says(page, 'Dossier « Logos et marques » déplacé dans « Médiathèque »')
    check((await folderByName('Logos et marques')).parentId === null, 'revenu à la racine')
  })

  await step('supprimer un dossier vide, puis un dossier non vide (son contenu remonte, après confirmation)', async () => {
    await goRoot()
    await newFolder('Brouillons')
    await says(page, 'Dossier « Brouillons » créé')
    await page.waitForFunction(() => !document.querySelector('[data-cms-folder-name]'))
    await openFolder('Brouillons')
    dialogs.length = 0
    await clickText(page, '[data-folder-actions] button', 'Supprimer le dossier')
    await says(page, 'Dossier supprimé')
    check(dialogs[0] === 'Supprimer le dossier vide « Brouillons » ?', 'confirmation : ' + dialogs[0])
    check(!(await folderByName('Brouillons')), 'Brouillons devait disparaître')
    check((await crumbs()) === 'Médiathèque', 'retour au dossier parent : ' + await crumbs())

    // Sans confirmation (appel direct), un dossier non vide est refusé.
    const chantiers = await folderByName('Chantiers')
    const refused = await api(page, `/api/cms/media/folders/${chantiers.id}`, { method: 'DELETE' })
    check(refused.status === 409 && refused.body.includes('pas vide'), 'dossier non vide : ' + refused.status)

    await openFolder('Logos et marques')
    dialogs.length = 0
    await clickText(page, '[data-folder-actions] button', 'Supprimer le dossier')
    await says(page, 'Dossier supprimé ; son contenu est dans « Médiathèque »')
    check(dialogs[0]?.includes('contient 1 fichier') && dialogs[0].includes('Aucun fichier ne sera supprimé') && dialogs[0].includes('« Médiathèque »'), 'confirmation : ' + dialogs[0])
    const chantier = await fileByName('chantier.png')
    check(chantier && chantier.folderId === null && chantier.url === url, 'chantier.png devait remonter à la racine, même adresse : ' + JSON.stringify(chantier))
    check(await tile('chantier.png'), 'chantier.png s\'affiche à la racine')
    check((await media()).length === 3, 'aucun fichier ne doit être supprimé')
  })

  await step('recherche dans tous les dossiers, avec l\'emplacement de chaque résultat', async () => {
    await page.type('.cms-media-library input[type=search]', 'atelier')
    await page.waitForFunction(() => document.querySelector('.cms-media-library')?.innerText.includes('1 fichier trouvé dans toute la médiathèque'))
    const where = await page.$eval('[data-media]:has(button[title="atelier.png"]) [data-where]', el => el.textContent.trim())
    check(where === 'Chantiers › Toiture', 'emplacement : ' + where)
    await t.shot(page, 'recherche')
    // Un clic sur l'emplacement ouvre le dossier.
    await page.$eval('[data-media]:has(button[title="atelier.png"]) [data-where]', el => el.click())
    await page.waitForFunction(() => document.querySelector('nav[aria-label^="Emplacement"] [aria-current]')?.textContent.trim() === 'Toiture')
    check(await page.$eval('.cms-media-library input[type=search]', el => el.value === ''), 'la recherche est effacée')
    // Un dossier se trouve aussi par son nom.
    await page.type('.cms-media-library input[type=search]', 'toit')
    await page.waitForFunction(() => [...document.querySelectorAll('[data-media-folder]')].some(e => e.textContent.includes('Toiture') && e.textContent.includes('dans Chantiers')))
    await page.$eval('.cms-media-library input[type=search]', el => { el.value = ''; el.dispatchEvent(new Event('input')) })
  })

  await step('fenêtre de choix d\'une image : dernier dossier ouvert, navigation, envoi dans le dossier affiché', async () => {
    // Dernier dossier ouvert dans la médiathèque : Toiture.
    await page.goto(B + '/admin/services/new', { waitUntil: 'networkidle0' })
    await clickText(page, 'button', 'Choisir une image')
    await page.waitForSelector('.modal-open .cms-media-library')
    await page.waitForFunction(() => document.querySelector('.modal-open nav[aria-label^="Emplacement"] [aria-current]')?.textContent.trim() === 'Toiture')
    check(!(await page.$('.modal-open [data-folder-actions]')) && !(await page.$('.modal-open [data-media] input[type=checkbox]')), 'pas de rangement depuis la fenêtre de choix')
    await t.shot(page, 'choix-image')
    await page.$eval('.modal-open [data-crumb]:not([data-crumb=""])', el => el.click()) // « Chantiers »
    await page.waitForFunction(() => document.querySelector('.modal-open nav[aria-label^="Emplacement"] [aria-current]')?.textContent.trim() === 'Chantiers')
    await upload('Photo du Cabinet.png', '.modal-open')
    await page.waitForFunction(() => !document.querySelector('.modal-open'))
    await says(page, 'Photo du Cabinet.png')
    const chantiers = await folderByName('Chantiers')
    check((await fileByName('Photo du Cabinet.png')).folderId === chantiers.id, 'le fichier envoyé depuis la fenêtre doit être rangé dans Chantiers')
  })

  await step('galerie : même navigation, dossier retenu pendant la session (même après rechargement)', async () => {
    await page.goto(B + '/admin/home/home', { waitUntil: 'networkidle0' })
    await page.$eval('section.cms-section[data-section="Le cabinet en images"] > h3 > button', el => el.click())
    await clickText(page, 'button', 'Ajouter des images')
    await page.waitForSelector('.modal-open .cms-media-library')
    await page.waitForFunction(() => document.querySelector('.modal-open nav[aria-label^="Emplacement"] [aria-current]')?.textContent.trim() === 'Chantiers')
    await openFolder('Toiture', '.modal-open')
    await page.$$eval('.modal-open [data-media] button', els => els.find(e => e.title === 'atelier.png').click())
    await clickText(page, '.modal-open .modal-action button', 'Ajouter 1 image')
    await page.waitForFunction(() => !document.querySelector('.modal-open'))
    await page.waitForFunction(() => document.querySelector('.cms-gallery li[data-item] [title="atelier.png"]'))
    // Rechargement : le dossier ouvert est retenu pour la session de l'onglet.
    await page.reload({ waitUntil: 'networkidle0' })
    await page.$eval('section.cms-section[data-section="Le cabinet en images"] > h3 > button', el => el.click())
    await clickText(page, 'button', 'Ajouter des images')
    await page.waitForFunction(() => document.querySelector('.modal-open nav[aria-label^="Emplacement"] [aria-current]')?.textContent.trim() === 'Toiture')
    await clickText(page, '.modal-open .modal-action button', 'Annuler')
  })

  await step('rendu en largeur de téléphone : médiathèque et fenêtre de choix', async () => {
    const phone = await t.newPage({ width: 390, height: 844 })
    await login(phone, B)
    await phone.goto(B + '/admin/media', { waitUntil: 'networkidle0' })
    await phone.waitForSelector('[data-media-folder]')
    const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    check(overflow <= 0, `défilement horizontal de ${overflow} px`)
    // La case à cocher est visible sans survol (écran tactile) ; « Déplacer vers… » est atteignable.
    const box = await phone.$('[data-media] input[type=checkbox]')
    check(await box.evaluate(el => getComputedStyle(el.closest('label')).opacity === '1'), 'case à cocher invisible sur téléphone')
    await box.evaluate(el => el.click())
    await phone.waitForSelector('[data-selection]')
    await t.shot(phone, 'telephone-mediatheque')
    await phone.goto(B + '/admin/services/new', { waitUntil: 'networkidle0' })
    await clickText(phone, 'button', 'Choisir une image')
    await phone.waitForSelector('.modal-open .cms-media-library [data-media]')
    const modalOverflow = await phone.$eval('.modal-open .modal-box', el => el.scrollWidth - el.clientWidth)
    check(modalOverflow <= 0, `fenêtre de choix : défilement horizontal de ${modalOverflow} px`)
    await t.shot(phone, 'telephone-choix')
    await phone.close()
  })

  await step('droits : une rédactrice envoie dans un dossier existant, mais ne range pas (refusé par le serveur)', async () => {
    const { link } = await admin.json('/api/cms/users', { method: 'POST', body: { name: LINA.name, email: LINA.email, role: LINA.role } })
    check((await anon.post(link.replace(/^.*\/admin\/invite\//, '/api/cms/invite/'), { password: LINA.password })).status === 200, 'mot de passe refusé')
    const context = await t.newContext()
    const lina = await t.newPage({ context })
    await login(lina, B, LINA)
    await lina.goto(B + '/admin/media', { waitUntil: 'networkidle0' })
    await lina.waitForSelector('[data-media-folder]')
    check(!(await lina.$('.cms-media-library [data-media] input[type=checkbox]')), 'pas de case à cocher pour une rédactrice')
    check(!(await lina.evaluate(() => document.body.innerText.includes('Nouveau dossier'))), 'pas de « Nouveau dossier »')
    const chantiers = await folderByName('Chantiers'), toiture = await folderByName('Toiture')
    const chantier = await fileByName('chantier.png')
    const asLina = (url, body, method = 'POST') => send(lina, url, body, method)
    const refusals = [
      await asLina('/api/cms/media/folders', { name: 'À moi' }),
      await asLina(`/api/cms/media/folders/${toiture.id}`, { name: 'Renommé' }, 'PATCH'),
      await api(lina, `/api/cms/media/folders/${toiture.id}?force=1`, { method: 'DELETE' }),
      await asLina('/api/cms/media/move', { ids: [chantier.id], folderId: chantiers.id }),
    ]
    check(refusals.every(r => r.status === 403), 'statuts : ' + refusals.map(r => r.status).join(', '))
    check(refusals[0].body.includes('ranger la médiathèque'), 'message : ' + refusals[0].body.slice(0, 200))
    check((await fileByName('chantier.png')).folderId === null && (await folders()).length === 2, 'rien ne doit avoir changé')
    // Envoyer dans un dossier existant reste permis.
    await lina.$eval('[data-media-folder]', el => el.click())
    await lina.waitForFunction(() => document.querySelector('nav[aria-label^="Emplacement"] [aria-current]')?.textContent.trim() === 'Chantiers')
    const input = await lina.$('.cms-media-library input[type=file]')
    await input.uploadFile(t.fixture('reunion.png'))
    await says(lina, 'Fichier importé dans « Chantiers »')
    const hers = (await media()).filter(m => m.name === 'reunion.png' && m.folderId === chantiers.id)
    check(hers.length === 1, 'le fichier de Lina doit être dans Chantiers')
    await lina.close()
  })

  await step('import : fichiers rangés dans des dossiers créés au besoin ; relance sans doublon ; déplacement', async () => {
    const dir = path.join(config.tmpDir, 'import-dossiers')
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
    fs.copyFileSync(t.fixture('atelier.png'), path.join(dir, 'toit.png'))
    fs.copyFileSync(t.fixture('Photo du Cabinet.png'), path.join(dir, 'facade.png'))
    const write = (data) => { const file = path.join(dir, 'contenus.json'); fs.writeFileSync(file, JSON.stringify(data, null, 2)); return file }
    const run = args => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [BIN, ...args, '--url', B], {
        cwd: config.playgroundDir,
        env: { ...process.env, CMS_EMAIL: t.admin.email, CMS_PASSWORD: t.admin.password, CMS_URL: '' },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let out = ''
      child.stdout.on('data', d => { out += d })
      child.stderr.on('data', d => { out += d })
      child.on('error', reject)
      child.on('close', code => resolve({ code, out }))
    })
    const expect = (r, code, ...texts) => {
      check(r.code === code, `code de sortie ${r.code} au lieu de ${code}\n${r.out}`)
      for (const text of texts) check(text instanceof RegExp ? text.test(r.out) : r.out.includes(text), `sortie attendue « ${text} »\n${r.out}`)
    }
    const data = folder => ({
      collections: {
        services: [
          { id: 'toiture', title: 'Réfection de toiture', onQuote: true, cover: { file: 'toit.png', alt: 'Un toit refait', folder: 'Chantiers/Charpente' } },
          // Même dossier écrit avec d'autres majuscules : pas de doublon.
          { id: 'facade', title: 'Ravalement de façade', onQuote: true, cover: { file: 'facade.png', folder } },
        ],
      },
    })
    const file = write(data('chantiers/charpente'))
    const dry = await run([file, '--dry-run'])
    expect(dry, 0, /déjà présent\s+Chantiers\n/, /à créer\s+Chantiers\/Charpente\n/, /à envoyer\s+facade\.png › chantiers\/charpente/)
    check((dry.out.match(/à créer\s+chantiers\/charpente/gi) ?? []).length === 1, 'un même dossier écrit deux fois ne doit être annoncé qu\'une fois\n' + dry.out)
    check((await folders()).length === 2, 'la simulation a créé un dossier')

    const first = await run([file])
    expect(first, 0, /déjà présent\s+Chantiers\n/, /créé\s+Chantiers\/Charpente\n/, /envoyé\s+toit\.png › Chantiers\/Charpente/, '2 créés')
    const charpente = (await folders()).filter(f => f.name.toLowerCase() === 'charpente')
    const chantiers = await folderByName('Chantiers')
    check(charpente.length === 1 && charpente[0].parentId === chantiers.id, 'dossiers : ' + JSON.stringify(await folders()))
    const imported = (await media()).filter(m => m.folderId === charpente[0].id).map(m => m.name).sort()
    check(imported.join() === 'facade.png,toit.png', 'fichiers rangés : ' + imported.join())

    const again = await run([file])
    expect(again, 0, /déjà présent\s+Chantiers\/Charpente/, /déjà présent\s+toit\.png/, '0 créé, 0 mis à jour, 2 inchangés', 'Fichiers : 0 envoyé sur 2')
    check((await folders()).length === 3, 'relance : ' + (await folders()).map(f => f.name).join(', '))

    // Changer le dossier d'un fichier déjà importé : il y est déplacé, adresse inchangée.
    const before = (await media()).find(m => m.name === 'facade.png')
    expect(await run([write(data('Façades'))]), 0, /créé\s+Façades/, /rangé\s+facade\.png › Façades/)
    const after = (await media()).find(m => m.name === 'facade.png')
    check(after.folderId === (await folderByName('Façades')).id && after.url === before.url, 'facade.png : ' + JSON.stringify(after))
    expect(await run([file]), 0, /déjà présent\s+Façades/, /déjà présent\s+facade\.png/)
  })

  await step('aucun fichier perdu : la médiathèque compte tous les fichiers envoyés', async () => {
    const all = await media()
    check(all.length === 7, 'fichiers : ' + all.map(m => m.name).join(', '))
    await until(async () => (await anon.get(url)).status === 200, 'le premier fichier reste servi')
  })
}
