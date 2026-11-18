// Apparence du back-office : toujours claire, même si le système est en mode sombre ; couleur du back-office.
import { check, clickText, login } from '../lib/harness.mjs'

export const meta = { title: 'apparence et couleur du back-office (système en mode sombre)' }

const DEFAULT_COLOR = '#4f46e5', COLOR = '#0f766e'

export default async function (t) {
  const { B, step } = t
  const size = { width: 1400, height: 1000 }
  // Système en mode sombre : le back-office doit rester clair.
  const page = await t.newPage({ scheme: 'dark', ...size })
  const css = (sel, prop) => page.evaluate((sel, prop) => { const el = document.querySelector(sel); return el ? getComputedStyle(el)[prop] ?? getComputedStyle(el).getPropertyValue(prop) : null }, sel, prop)
  const v = (sel, name) => page.evaluate((sel, name) => getComputedStyle(document.querySelector(sel)).getPropertyValue(name).trim(), sel, name)
  const white = c => ['rgb(255, 255, 255)', 'oklch(1 0 0)'].includes(c)
  const rgb = hex => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`
  const setColor = body => page.evaluate(async body => (await fetch('/api/cms/admin-color', { method: 'PUT', headers: { 'content-type': 'application/json' }, body })).status, body)

  await step('connexion : page claire malgré un système en mode sombre', async () => {
    await page.goto(B + '/admin/login', { waitUntil: 'networkidle0' })
    check(white(await css('form.card', 'backgroundColor')), 'fond : ' + await css('form.card', 'backgroundColor'))
    await t.shot(page, 'connexion')
    await login(page, B)
  })
  await step('apparence par défaut : arrondi, sans relief, boutons sans bordure', async () => {
    await page.goto(B + '/admin/services', { waitUntil: 'networkidle0' })
    const got = { depth: await v('.cms-admin', '--depth'), field: await v('.cms-admin', '--radius-field'), box: await v('.cms-admin', '--radius-box') }
    check(got.depth === '0' && got.field === '0.75rem' && got.box === '1.25rem', JSON.stringify(got))
    const btn = await page.evaluate(() => { const s = getComputedStyle(document.querySelector('a.btn-primary')); return { border: s.borderTopColor, shadow: s.boxShadow, radius: s.borderTopLeftRadius, bg: s.backgroundColor } })
    check(/rgba\(0, 0, 0, 0\)|transparent/.test(btn.border) && btn.shadow === 'none' && parseFloat(btn.radius) >= 10, JSON.stringify(btn))
    const card = await css('.card', 'backgroundColor'); check(white(card), 'carte : ' + card)
  })
  await t.shot(page, 'liste')
  await step('couleur du back-office : appliquée tout de suite, gardée après rechargement', async () => {
    await page.goto(B + '/admin/appearance', { waitUntil: 'networkidle0' })
    const pick = await page.evaluateHandle(color => [...document.querySelectorAll('.card')].find(c => c.textContent.includes('Couleur du back-office')).querySelector(`button[title="${color}"]`), COLOR)
    // La couleur change à l'écran avant d'être enregistrée : on attend la réponse du serveur avant de recharger.
    const stored = page.waitForResponse(r => r.url().endsWith('/api/cms/admin-color') && r.request().method() === 'PUT')
    await pick.asElement().click()
    await page.waitForFunction(color => getComputedStyle(document.querySelector('.cms-admin')).getPropertyValue('--color-primary').trim() === color, {}, COLOR)
    check(await v('[data-cms-theme-preview]', '--color-primary') !== COLOR, 'la couleur du back-office a changé l\'aperçu du site')
    check((await stored).status() === 200, 'enregistrement de la couleur refusé')
    await page.reload({ waitUntil: 'networkidle0' }); check(await v('.cms-admin', '--color-primary') === COLOR, 'couleur perdue au rechargement')
    await page.goto(B + '/admin/services', { waitUntil: 'networkidle0' }); check(await css('a.btn-primary', 'backgroundColor') === rgb(COLOR), 'bouton : ' + await css('a.btn-primary', 'backgroundColor'))
  })
  await t.shot(page, 'couleur')
  await step('la couleur vaut aussi pour la page de connexion, pas pour le site', async () => {
    const context = await t.newContext(); const anon = await t.newPage({ context, scheme: 'dark', ...size })
    await anon.goto(B + '/admin/login', { waitUntil: 'networkidle0' })
    const btn = await anon.evaluate(() => getComputedStyle(document.querySelector('button.btn-primary')).backgroundColor); check(btn === rgb(COLOR), 'connexion : ' + btn)
    await anon.goto(B + '/', { waitUntil: 'networkidle0' })
    const site = await anon.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim()); check(site !== COLOR, 'le site a pris la couleur du back-office')
    const r = await anon.evaluate(async () => (await fetch('/api/cms/admin-color', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"color":"#000000"}' })).status); check(r === 401, 'modification sans connexion : ' + r)
    await context.close()
  })
  await step('page unique : une seule adresse (/admin/home), l\'ancienne y renvoie', async () => {
    await page.goto(B + '/admin', { waitUntil: 'networkidle0' })
    const href = await page.$$eval('aside .menu a', links => links.find(a => a.textContent.trim() === 'Accueil')?.getAttribute('href'))
    check(href === '/admin/home', 'lien du menu : ' + href)
    await page.goto(B + '/admin/home/home', { waitUntil: 'networkidle0' })
    await page.waitForFunction(() => location.pathname === '/admin/home')
    await page.waitForFunction(() => [...document.querySelectorAll('legend')].some(l => l.textContent.includes('Image')))
  })
  await step('fenêtre de choix d\'image : même apparence', async () => {
    await page.goto(B + '/admin/home', { waitUntil: 'networkidle0' })
    await clickText(page, 'button', 'Choisir une image'); await page.waitForSelector('.modal-open .btn-primary')
    const button = await css('.modal-open .btn-primary', 'backgroundColor'), box = await css('.modal-open .modal-box', 'backgroundColor')
    check(button === rgb(COLOR) && white(box), button + ' / ' + box)
  })
  await step('couleur invalide refusée, retour à la couleur par défaut', async () => {
    check(await setColor('{"color":"red;}*{display:none"}') === 400, 'couleur invalide acceptée')
    check(await setColor('{"color":null}') === 200, 'retour au défaut refusé')
    await page.reload({ waitUntil: 'networkidle0' }); check(await v('.cms-admin', '--color-primary') === DEFAULT_COLOR, 'défaut : ' + await v('.cms-admin', '--color-primary'))
  })
}
