// Aperçu du site avec les brouillons : mode aperçu qui suit la navigation, et liens d'aperçu à partager.
import { execFileSync } from 'node:child_process'
import { readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { config } from '../lib/config.mjs'
import { check, login, says } from '../lib/harness.mjs'

export const meta = { title: 'aperçu du site et liens d\'aperçu partagés' }

const MARC = { name: 'Marc Petit', email: 'marc@example.com', password: 'mot-de-passe-de-marc', role: 'editor' }
const LINA = { name: 'Lina Roux', email: 'lina@example.com', password: 'mot-de-passe-de-lina', role: 'writer' }
const ONLINE = 'Service en ligne', CHANGED = 'Service en ligne, nouveau texte', COMING = 'Service à venir'

/** Fichier de la base locale du serveur de test, pour simuler le temps qui passe. Null si introuvable. */
function databaseFile() {
  const find = (dir) => {
    if (!existsSync(dir)) return null
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { const hit = find(full); if (hit) return hit }
      else if (entry.name.endsWith('.sqlite') && !entry.name.includes('metadata')) return full
    }
    return null
  }
  return find(config.tmpDir)
}

export default async function (t) {
  const { step, admin, B, info } = t
  const claire = t.http(), marc = t.http(), lina = t.http(), visitor = t.http()
  const ids = {}, links = {}
  const service = (title, extra = {}) => ({ shared: { onQuote: true }, locales: { fr: { values: { title } } }, ...extra })
  const titles = async (client, preview) => (await client.json('/api/content/services' + (preview ? `?preview=${encodeURIComponent(preview)}` : ''))).map(s => s.title).sort().join(' | ')
  const tokenOf = url => new URL(url).searchParams.get('preview')

  await step('préparation : un service en ligne modifié en brouillon, un service jamais publié', async () => {
    check((await claire.signIn(admin.email, admin.password)).status === 200, 'connexion de l\'administratrice refusée')
    ids.online = (await claire.json('/api/cms/entries/services', { method: 'POST', body: service(ONLINE, { publish: ['fr'] }) })).id
    await claire.json(`/api/cms/entries/services/${ids.online}`, { method: 'PUT', body: service(CHANGED) })
    ids.coming = (await claire.json('/api/cms/entries/services', { method: 'POST', body: service(COMING) })).id
    for (const [who, client] of [[MARC, marc], [LINA, lina]]) {
      const { id, link } = await claire.json('/api/cms/users', { method: 'POST', body: { name: who.name, email: who.email, role: who.role } })
      who.id = id
      await visitor.post(link.replace(/^.*\/admin\/invite\//, '/api/cms/invite/'), { password: who.password })
      check((await client.signIn(who.email, who.password)).status === 200, 'connexion refusée pour ' + who.name)
    }
  })

  await step('le site en ligne ne montre aucun brouillon, même en demandant l\'aperçu sans y avoir droit', async () => {
    check(await titles(visitor) === ONLINE, 'site en ligne : ' + await titles(visitor))
    check(await titles(visitor, '1') === ONLINE, 'aperçu sans connexion : ' + await titles(visitor, '1'))
    check(await titles(visitor, 'jeton-invente-de-plus-de-vingt-caracteres') === ONLINE, 'aperçu avec un faux jeton')
    check(await titles(claire, '1') === `${CHANGED} | ${COMING}`, 'aperçu connecté : ' + await titles(claire, '1'))
    const page = await visitor.get('/?preview=1')
    check(/no-store/.test(page.headers.get('cache-control') ?? '') && /noindex/.test(page.headers.get('x-robots-tag') ?? '') && page.headers.get('referrer-policy') === 'same-origin',
      `en-têtes : ${page.headers.get('cache-control')} / ${page.headers.get('x-robots-tag')} / ${page.headers.get('referrer-policy')}`)
  })

  await step('mode aperçu : il suit la navigation sur tout le site, jusqu\'à ce qu\'on le quitte', async () => {
    const page = await t.newPage({ context: await t.newContext() })
    await login(page, B)
    await page.goto(`${B}/?preview=1`, { waitUntil: 'networkidle0' })
    await says(page, 'Mode aperçu : vous voyez les brouillons')
    const home = await page.evaluate(() => document.body.innerText)
    check(home.includes(COMING) && home.includes(CHANGED), 'les brouillons ne sont pas sur l\'accueil en aperçu')
    // Lien du site (navigation interne).
    await (await page.evaluateHandle(text => [...document.querySelectorAll('main a')].find(a => a.textContent.includes(text)), COMING)).asElement().evaluate(a => a.click())
    await page.waitForFunction(() => location.pathname === '/services/service-a-venir')
    check(new URL(page.url()).searchParams.get('preview') === '1', 'paramètre perdu au clic : ' + page.url())
    await page.waitForFunction(text => document.querySelector('h1')?.textContent.includes(text), {}, COMING)
    // Lien ordinaire (rechargement complet de la page).
    await page.evaluate(() => { const a = document.createElement('a'); a.href = '/'; a.textContent = 'lien ordinaire'; a.id = 'lien-ordinaire'; document.body.append(a) })
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('#lien-ordinaire')])
    check(new URL(page.url()).pathname === '/' && new URL(page.url()).searchParams.get('preview') === '1', 'paramètre perdu sur un lien ordinaire : ' + page.url())
    check((await page.evaluate(() => document.body.innerText)).includes(COMING), 'brouillons absents après un lien ordinaire')
    // Sortie.
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.$eval('a[data-cms-preview-exit]', a => a.click())])
    const after = await page.evaluate(() => document.body.innerText)
    check(page.url() === `${B}/` && !after.includes(COMING) && after.includes(ONLINE) && !after.includes('Mode aperçu'), 'sortie de l\'aperçu : ' + page.url())
    // Le back-office, lui, ne prend jamais le paramètre.
    await page.goto(`${B}/services/service-en-ligne?preview=1`, { waitUntil: 'networkidle0' })
    await page.evaluate(() => { const a = document.createElement('a'); a.href = '/admin'; a.id = 'vers-admin'; a.textContent = 'admin'; document.body.append(a) })
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('#vers-admin')])
    check(!page.url().includes('preview'), 'le paramètre a suivi dans le back-office : ' + page.url())
  })

  await step('lien partagé : création contrôlée, réservée à qui peut publier', async () => {
    const bad = [
      (await claire.post('/api/cms/preview-links', { label: '', days: 7 })).status,
      (await claire.post('/api/cms/preview-links', { label: 'Direction', days: 3 })).status,
      (await lina.post('/api/cms/preview-links', { label: 'Par une rédactrice', days: 7 })).status,
      (await visitor.post('/api/cms/preview-links', { label: 'Anonyme', days: 7 })).status,
    ]
    check(bad.join() === '400,400,403,401', bad.join())
    const created = await claire.json('/api/cms/preview-links', { method: 'POST', body: { label: 'Direction', days: 7 } })
    links.claire = created
    check(tokenOf(created.url)?.length >= 40 && created.url.startsWith(`${B}/?preview=`), 'adresse : ' + created.url)
    const listed = await claire.json('/api/cms/preview-links')
    check(listed.length === 1 && listed[0].label === 'Direction' && !listed[0].expired && !JSON.stringify(listed).includes(tokenOf(created.url)), 'liste : ' + JSON.stringify(listed))
    check((await claire.json('/api/cms/me')).sharePreview === true && (await lina.json('/api/cms/me')).sharePreview === false, 'droit de partage mal annoncé')
  })

  await step('lien partagé : un visiteur sans compte voit les brouillons, navigue, et n\'a accès à rien d\'autre', async () => {
    const token = tokenOf(links.claire.url)
    check(await titles(visitor, token) === `${CHANGED} | ${COMING}`, 'aperçu par lien : ' + await titles(visitor, token))
    check((await visitor.get(`/api/cms/me?preview=${token}`)).status === 401 && (await visitor.get(`/api/cms/entries/services?preview=${token}`)).status === 401, 'le lien a ouvert le back-office')
    const page = await t.newPage({ context: await t.newContext() })
    await page.goto(links.claire.url, { waitUntil: 'networkidle0' })
    await says(page, 'Aperçu partagé : cette version du site n\'est pas encore en ligne.')
    check((await page.evaluate(() => document.body.innerText)).includes(COMING), 'brouillon absent de l\'aperçu partagé')
    await (await page.evaluateHandle(text => [...document.querySelectorAll('main a')].find(a => a.textContent.includes(text)), COMING)).asElement().evaluate(a => a.click())
    await page.waitForFunction(() => location.pathname === '/services/service-a-venir')
    check(new URL(page.url()).searchParams.get('preview') === token, 'jeton perdu à la navigation : ' + page.url())
    check(await page.evaluate(() => document.querySelector('meta[name=robots]')?.content) === 'noindex, nofollow', 'page d\'aperçu indexable')
  })

  await step('lien partagé : il montre ce que son créateur peut ouvrir, pas plus', async () => {
    const link = await marc.json('/api/cms/preview-links', { method: 'POST', body: { label: 'Lien de Marc', days: 1 } })
    links.marc = link
    // Ses droits sont ensuite réduits aux témoignages, qui n'ont pas de page : le lien suit, et il ne peut plus en créer.
    await claire.json(`/api/cms/users/${MARC.id}`, { method: 'PATCH', body: { types: ['testimonials'] } })
    check((await marc.post('/api/cms/preview-links', { label: 'Sans page à publier', days: 1 })).status === 403, 'partage accepté sans droit de publier une page')
    check(await titles(visitor, tokenOf(link.url)) === ONLINE, 'un lien a montré des brouillons fermés à son créateur : ' + await titles(visitor, tokenOf(link.url)))
    await claire.json(`/api/cms/users/${MARC.id}`, { method: 'PATCH', body: { types: null } })
    check(await titles(visitor, tokenOf(link.url)) === `${CHANGED} | ${COMING}`, 'les droits retrouvés ne s\'appliquent pas au lien')
    check((await marc.json('/api/cms/preview-links')).map(l => l.label).join() === 'Lien de Marc', 'un éditeur voit les liens des autres')
    check((await claire.json('/api/cms/preview-links')).length === 2, 'l\'administratrice devrait voir tous les liens')
  })

  await step('révocation : par son créateur ou un administrateur, effet immédiat', async () => {
    check((await marc.del(`/api/cms/preview-links/${links.claire.id}`)).status === 403, 'un tiers a révoqué le lien')
    check((await claire.del(`/api/cms/preview-links/${links.claire.id}`)).status === 200, 'révocation refusée')
    check(await titles(visitor, tokenOf(links.claire.url)) === ONLINE, 'le lien révoqué fonctionne encore')
    check(await titles(visitor, tokenOf(links.marc.url)) === `${CHANGED} | ${COMING}`, 'la révocation a touché un autre lien')
  })

  await step('expiration : un lien dont la date est passée ne montre plus rien', async () => {
    const file = databaseFile()
    let done = false
    if (file) {
      try { execFileSync('sqlite3', [file, `update cms_preview_links set expires_at = ${Date.now() - 1000} where id = '${links.marc.id}'`]); done = true }
      catch { /* outil absent */ }
    }
    if (!done) { info('non vérifié ici : il faut l\'outil sqlite3 pour avancer la date du lien'); return }
    check(await titles(visitor, tokenOf(links.marc.url)) === ONLINE, 'le lien expiré fonctionne encore')
    check((await marc.json('/api/cms/preview-links'))[0].expired === true, 'la liste ne signale pas l\'expiration')
  })

  await step('compte supprimé : ses liens cessent de fonctionner', async () => {
    const link = await marc.json('/api/cms/preview-links', { method: 'POST', body: { label: 'Avant départ', days: 30 } })
    check(await titles(visitor, tokenOf(link.url)) === `${CHANGED} | ${COMING}`, 'le lien devrait fonctionner')
    check((await claire.del(`/api/cms/users/${MARC.id}`)).status === 200, 'suppression du compte refusée')
    check(await titles(visitor, tokenOf(link.url)) === ONLINE, 'le lien d\'un compte supprimé fonctionne encore')
  })

  await step('interface : la fenêtre « Aperçu » ouvre l\'aperçu et crée un lien affiché une seule fois', async () => {
    const page = await t.newPage({ context: await t.newContext() })
    await login(page, B)
    await (await page.evaluateHandle(() => [...document.querySelectorAll('header button')].find(b => b.textContent.trim() === 'Aperçu'))).asElement().evaluate(b => b.click())
    await page.waitForSelector('.modal-open a[href="/?preview=1"]')
    await page.type('.modal-open input[placeholder^="Ex."]', 'Validation du gérant')
    await (await page.evaluateHandle(() => [...document.querySelectorAll('.modal-open button')].find(b => b.textContent.trim() === 'Créer le lien'))).asElement().evaluate(b => b.click())
    await says(page, 'Lien créé pour « Validation du gérant »')
    const url = await page.$eval('.modal-open input[readonly]', i => i.value)
    check(await titles(visitor, tokenOf(url)) === `${CHANGED} | ${COMING}`, 'le lien créé depuis l\'interface ne fonctionne pas')
    check(await page.evaluate(() => [...document.querySelectorAll('.modal-open li')].some(li => li.textContent.includes('Validation du gérant') && li.textContent.includes('jusqu\'au'))), 'le lien n\'est pas dans la liste')
    // Un rédacteur a l'aperçu, pas le partage.
    const writer = await t.newPage({ context: await t.newContext() })
    await login(writer, B, LINA)
    await (await writer.evaluateHandle(() => [...document.querySelectorAll('header button')].find(b => b.textContent.trim() === 'Aperçu'))).asElement().evaluate(b => b.click())
    await writer.waitForSelector('.modal-open a[href="/?preview=1"]')
    check(!(await writer.evaluate(() => document.querySelector('.modal-open').innerText)).includes('Partager l\'aperçu'), 'le rédacteur voit le partage')
  })
}
