// Menu du back-office : sections, dossiers repliables (contenus par groupe, Référencement, Réglages, Administration),
// dossier de l'écran ouvert toujours visible, état retenu, menu selon le rôle.
import { check, login, until } from '../lib/harness.mjs'

export const meta = { title: 'menu : arbre des contenus et réglages regroupés' }

const MARC = { name: 'Marc Petit', email: 'marc@example.com', password: 'mot-de-passe-de-marc', role: 'editor' }

/** Le menu tel qu'on le voit : titres de section, dossiers (ouverts ou non) et leurs entrées. */
const readMenu = page => page.$eval('[data-cms-nav]', (ul) => {
  const out = []
  for (const li of ul.children) {
    if (li.classList.contains('menu-title')) out.push({ title: li.textContent.trim() })
    const details = li.querySelector(':scope > details')
    if (details) out.push({ folder: details.querySelector('summary').textContent.trim(), key: details.dataset.navFolder, open: details.open, items: [...details.querySelectorAll('ul a')].map(a => a.textContent.trim()) })
    else if (li.querySelector(':scope > a')) out.push({ item: li.querySelector(':scope > a').textContent.trim() })
  }
  return out
})
const folderOf = (menu, label) => menu.find(n => n.folder === label)

export default async function (t) {
  const { B, step } = t
  const claire = t.http(), visitor = t.http()
  const page = await t.newPage()

  await step('administratrice : sections Contenus et Outils, puis Référencement, Réglages, Administration', async () => {
    await login(page, B)
    await page.goto(B + '/admin/services', { waitUntil: 'networkidle0' })
    const menu = await readMenu(page)
    const titles = menu.filter(n => n.title).map(n => n.title)
    check(titles.join() === 'Contenus,Outils', 'sections : ' + titles.join())
    // Les contenus : un dossier par groupe, ouverts par défaut.
    const pages = folderOf(menu, 'Pages'), collections = folderOf(menu, 'Collections')
    check(pages?.open && pages.items.includes('Accueil'), 'dossier Pages : ' + JSON.stringify(pages))
    check(collections?.open && ['Services', 'Catégories', 'Témoignages'].every(l => collections.items.includes(l)), 'dossier Collections : ' + JSON.stringify(collections))
    const site = menu.slice(menu.findIndex(n => n.title === 'Outils') + 1).filter(n => n.item).map(n => n.item)
    check(['Médiathèque', 'Audience', 'Paiements'].every(l => site.includes(l)) && site.some(l => l.startsWith('Messages reçus')), 'section Outils : ' + site.join())
    const expected = {
      Référencement: ['Pages et titres', 'Redirections'],
      Réglages: ['Apparence', 'Disponibilité', 'Modules', 'Workflows'],
      Administration: ['Utilisateurs', 'Activité', 'Sauvegardes', 'Corbeille', 'Structure des contenus'],
    }
    for (const [label, items] of Object.entries(expected)) {
      const f = folderOf(menu, label)
      check(f && !f.open && f.items.join() === items.join(), `${label} : ` + JSON.stringify(f))
    }
    await t.shot(page, 'administratrice')
  })

  await step('l\'écran ouvert est visible : son dossier s\'ouvre tout seul', async () => {
    await page.goto(B + '/admin/modules', { waitUntil: 'networkidle0' })
    const settings = folderOf(await readMenu(page), 'Réglages')
    check(settings.open, 'Réglages replié alors que Modules est ouvert')
    const active = await page.$eval('[data-cms-nav] a.menu-active', a => a.textContent.trim())
    check(active === 'Modules', 'entrée active : ' + active)
    // Navigation interne (sans recharger) vers un écran d'un autre dossier.
    await page.$eval('[data-nav-folder="admin"] summary', s => s.click())
    await page.$eval('[data-nav-folder="admin"] a[href="/admin/backups"]', a => a.click())
    await page.waitForFunction(() => location.pathname === '/admin/backups')
    check(folderOf(await readMenu(page), 'Administration').open, 'Administration replié')
  })

  await step('dossier replié ou ouvert à la main : retenu après rechargement', async () => {
    await page.goto(B + '/admin/media', { waitUntil: 'networkidle0' })
    await page.$eval('[data-nav-folder="contents:Collections"] summary', s => s.click())
    await page.$eval('[data-nav-folder="seo"] summary', s => s.click())
    await page.reload({ waitUntil: 'networkidle0' })
    const menu = await readMenu(page)
    check(!folderOf(menu, 'Collections').open, 'Collections rouvert au rechargement')
    check(folderOf(menu, 'Référencement').open, 'Référencement replié au rechargement')
    // Ouvrir un contenu de la collection repliée la rouvre.
    await page.goto(B + '/admin/services', { waitUntil: 'networkidle0' })
    check(folderOf(await readMenu(page), 'Collections').open, 'Collections replié alors que Services est ouvert')
  })

  await step('recherche (⌘K) : les écrans des dossiers y sont, avec le nom du dossier', async () => {
    await page.goto(B + '/admin/media', { waitUntil: 'networkidle0' })
    await page.keyboard.down('Meta'); await page.keyboard.press('k'); await page.keyboard.up('Meta')
    await page.waitForSelector('dialog[open] input, .modal-open input')
    await page.keyboard.type('sauveg')
    await page.waitForFunction(() => [...document.querySelectorAll('[role=option], li')].some(e => e.textContent.includes('Sauvegardes') && e.textContent.includes('Administration')))
    await page.keyboard.press('Escape')
  })

  // ───── Favoris ─────
  const favoritesShown = () => page.$$eval('[data-nav-favorites] [data-nav-item]', lis => lis.map(li => li.dataset.navItem))
  const star = to => page.$eval(`[data-cms-nav] li:not([data-nav-favorites] *)[data-nav-item="${to}"] [data-nav-star]`, b => b.click())
  const saved = async () => (await claire.json('/api/cms/me/favorites')).favorites

  await step('favoris : l\'étoile épingle un écran en tête du menu, même rangé dans un dossier replié', async () => {
    check((await claire.signIn(t.admin.email, t.admin.password)).status === 200, 'connexion')
    await page.goto(B + '/admin/media', { waitUntil: 'networkidle0' })
    check(!(await readMenu(page)).some(n => n.title === 'Favoris'), 'section Favoris sans favori')
    for (const to of ['/admin/media', '/admin/backups', '/admin/services']) {
      await star(to)
      await page.waitForFunction(to => [...document.querySelectorAll('[data-nav-favorites] [data-nav-item]')].some(li => li.dataset.navItem === to), {}, to)
    }
    check((await readMenu(page))[0]?.title === 'Favoris', 'Favoris pas en tête du menu')
    check((await favoritesShown()).join() === '/admin/media,/admin/backups,/admin/services', 'ordre : ' + (await favoritesShown()).join())
    const pressed = await page.$eval('[data-cms-nav] li:not([data-nav-favorites] *)[data-nav-item="/admin/backups"] [data-nav-star]', b => b.getAttribute('aria-pressed'))
    check(pressed === 'true', 'étoile du dossier non marquée')
    await until(async () => (await saved()).length === 3, 'favoris enregistrés')
    await page.reload({ waitUntil: 'networkidle0' })
    await page.waitForSelector('[data-nav-favorites]')
    check((await favoritesShown()).join() === '/admin/media,/admin/backups,/admin/services', 'favoris perdus au rechargement')
    await t.shot(page, 'favoris')
  })

  await step('favoris : déplacés au clavier (Alt + ↑) et en glissant', async () => {
    await page.focus('[data-nav-favorites] [data-nav-item="/admin/services"] a')
    await page.keyboard.down('Alt'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp'); await page.keyboard.up('Alt')
    await until(async () => (await saved()).join() === '/admin/services,/admin/media,/admin/backups', 'ordre enregistré après Alt + ↑').catch(async (e) => { throw new Error(e.message + ' — enregistré : ' + (await saved()).join() + ' ; affiché : ' + (await favoritesShown()).join() + ' ; focus : ' + await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120))) })
    check((await favoritesShown()).join() === '/admin/services,/admin/media,/admin/backups', 'ordre affiché : ' + (await favoritesShown()).join())
    check(await page.evaluate(() => document.activeElement?.closest('[data-nav-item]')?.dataset.navItem) === '/admin/services', 'focus perdu après le déplacement')
    // Glisser « Sauvegardes » sur « Services » : il prend sa place.
    await page.evaluate(() => {
      const item = to => document.querySelector(`[data-nav-favorites] [data-nav-item="${to}"]`)
      const data = new DataTransfer()
      const fire = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data }))
      fire(item('/admin/backups'), 'dragstart'); fire(item('/admin/services'), 'dragover'); fire(item('/admin/services'), 'drop'); fire(item('/admin/backups'), 'dragend')
    })
    await until(async () => (await saved()).join() === '/admin/backups,/admin/services,/admin/media', 'ordre enregistré après glisser-déposer')
  })

  await step('favoris : retirés par l\'étoile ; liste nettoyée côté serveur ; propres à chaque compte', async () => {
    await page.$eval('[data-nav-favorites] [data-nav-item="/admin/media"] [data-nav-star]', b => b.click())
    await until(async () => (await saved()).join() === '/admin/backups,/admin/services', 'favori retiré')
    check((await claire.put('/api/cms/me/favorites', { favorites: 'pas une liste' })).status === 400, 'liste invalide acceptée')
    const cleaned = await claire.json('/api/cms/me/favorites', { method: 'PUT', body: { favorites: ['/admin/backups', 'https://ailleurs.example', '/admin/backups', '/site', '/admin/services'] } })
    check(cleaned.favorites.join() === '/admin/backups,/admin/services', 'nettoyage : ' + cleaned.favorites.join())
    check((await visitor.get('/api/cms/me/favorites')).status === 401, 'favoris lus sans connexion')
  })

  await step('libellés longs : coupés avec « … », chevrons des dossiers toujours visibles', async () => {
    await page.goto(B + '/admin/media', { waitUntil: 'networkidle0' })
    const result = await page.evaluate(() => {
      const long = 'Un libellé beaucoup trop long pour tenir dans la largeur du menu du back-office'
      const folder = document.querySelector('[data-nav-folder="contents:Collections"]')
      folder.open = true
      folder.querySelector('summary .truncate').textContent = long
      folder.querySelector('ul .truncate').textContent = long
      const menu = document.querySelector('[data-cms-nav]').getBoundingClientRect()
      const summary = folder.querySelector('summary')
      const label = summary.querySelector('.truncate')
      const childLabel = folder.querySelector('ul .truncate')
      const widest = Math.max(...[...document.querySelectorAll('[data-cms-nav] li')].map(li => li.getBoundingClientRect().right))
      const chevron = getComputedStyle(summary, '::after')
      return {
        // Le libellé est coupé (« … ») plutôt que d'élargir l'entrée.
        labelCut: label.scrollWidth > label.clientWidth && childLabel.scrollWidth > childLabel.clientWidth,
        // Aucune entrée ne dépasse le menu ; le chevron (::after du dossier) est dessiné, au bord droit du dossier.
        widest: Math.round(widest), menuRight: Math.round(menu.right),
        chevron: chevron.content !== 'none' && chevron.display !== 'none',
        // Même chevron que celui d'un dossier au libellé court : il n'est pas écrasé par le libellé.
        chevronSize: `${chevron.width}×${chevron.height}`,
        normalChevron: (() => { const c = getComputedStyle(document.querySelector('[data-nav-folder="contents:Pages"] summary'), '::after'); return `${c.width}×${c.height}` })(),
        summaryRight: Math.round(summary.getBoundingClientRect().right),
        title: summary.title || label.closest('[title]')?.title || '',
      }
    })
    check(result.labelCut && result.widest <= result.menuRight && result.summaryRight <= result.menuRight && result.chevron && result.chevronSize === result.normalChevron, JSON.stringify(result))
    await t.shot(page, 'libelles-longs')
  })

  await step('éditeur : ni Réglages ni Administration, la corbeille dans Outils', async () => {
    check((await claire.signIn(t.admin.email, t.admin.password)).status === 200, 'connexion')
    const { link } = await claire.json('/api/cms/users', { method: 'POST', body: { name: MARC.name, email: MARC.email, role: MARC.role } })
    check((await visitor.post(`/api/cms/invite/${link.replace(/^.*\/admin\/invite\//, '')}`, { password: MARC.password })).status === 200, 'invitation')
    const context = await t.newContext()
    const other = await t.newPage({ context })
    await login(other, B, MARC)
    await other.goto(B + '/admin/services', { waitUntil: 'networkidle0' })
    const menu = await readMenu(other)
    check(!folderOf(menu, 'Réglages') && !folderOf(menu, 'Administration'), 'dossiers d\'administration montrés à l\'éditeur')
    check(folderOf(menu, 'Référencement')?.items.join() === 'Pages et titres,Redirections', 'Référencement : ' + JSON.stringify(folderOf(menu, 'Référencement')))
    check(menu.some(n => n.item === 'Corbeille'), 'corbeille absente pour l\'éditeur')
    check(!menu.some(n => n.title === 'Favoris'), 'l\'éditeur voit les favoris de l\'administratrice')
    // Un favori vers un écran auquel il n'a pas accès n'est pas montré.
    await other.evaluate(() => fetch('/api/cms/me/favorites', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ favorites: ['/admin/users', '/admin/media'] }) }))
    await other.reload({ waitUntil: 'networkidle0' })
    await other.waitForSelector('[data-nav-favorites]')
    const shown = await other.$$eval('[data-nav-favorites] [data-nav-item]', lis => lis.map(li => li.dataset.navItem))
    check(shown.join() === '/admin/media', 'favoris de l\'éditeur : ' + shown.join())
    await t.shot(other, 'editeur')
    await context.close()
  })

  await step('téléphone : menu ouvert par le bouton, sans débordement', async () => {
    const phone = await t.newPage({ width: 390, height: 844 })
    await phone.goto(B + '/admin/services', { waitUntil: 'networkidle0' })
    await phone.click('label[for="cms-nav"]')
    await phone.waitForFunction(() => document.querySelector('#cms-nav').checked)
    await phone.waitForFunction(() => document.querySelector('aside').getBoundingClientRect().left >= 0)
    await new Promise(r => setTimeout(r, 400))
    const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    check(overflow <= 0, `débordement horizontal : ${overflow} px`)
    await t.shot(phone, 'telephone')
  })
}
