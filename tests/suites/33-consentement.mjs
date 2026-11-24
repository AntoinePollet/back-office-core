// Module Consentement : bandeau des pages du site (refuser aussi simple qu'accepter, rien avant le choix), choix gardé
// six mois, lien « Gérer mes cookies », accord joint à la provenance des contacts, langues, largeur de téléphone.
import { check, clickText, json, login, says, until } from '../lib/harness.mjs'
import { config } from '../lib/config.mjs'

export const meta = { title: 'consentement : bandeau, choix gardé, lien pour changer d\'avis, accord joint aux contacts' }

const AD = '/?utm_source=google&utm_medium=cpc&gclid=TEST-GCLID-CONSENT'
const KEY = 'cms-consent'

export default async function (t) {
  const { B, step } = t
  const page = await t.newPage()
  const claire = t.http(), visitor = t.http()
  const html = async path => (await visitor.get(path)).text
  const banner = p => p.$('[data-cms-consent]')
  const waitBanner = p => p.waitForSelector('[data-cms-consent]')
  const waitNoBanner = p => p.waitForFunction(() => !document.querySelector('[data-cms-consent]'))
  const act = (p, action) => p.$eval(`[data-cms-consent-action=${action}]`, b => b.click())
  const stored = p => p.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null'), KEY)
  const navigate = (p, path) => p.evaluate(path => document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$router.push(path), path)
  let ip = 60
  const visitorPage = async () => {
    const context = await t.newContext(); const p = await t.newPage({ context })
    await p.setExtraHTTPHeaders({ [config.ipHeader]: `203.0.113.${ip++}` })
    return { p, context }
  }
  const sendContact = async (p, name) => {
    await p.waitForSelector('input[name=name]')
    await p.type('input[name=name]', name)
    await p.type('input[name=email]', 'visiteur@example.com')
    await p.type('textarea[name=message]', 'Bonjour, je voudrais un rendez-vous.')
    await p.click('input[name=consent]')
    await clickText(p, 'main button', 'Envoyer'); await says(p, 'Merci, votre message est bien parti.')
  }
  const message = name => until(async () => (await json(page, '/api/cms/forms')).submissions.find(s => s.values.name === name), 'message ' + name)

  await step('module désactivé : ni bandeau, ni lien, ni configuration dans les pages', async () => {
    await login(page, B)
    check((await claire.signIn(t.admin.email, t.admin.password)).status === 200, 'connexion refusée')
    const listed = (await claire.json('/api/cms/modules')).find(m => m.id === 'consent')
    check(listed && !listed.enabled && listed.category === 'privacy' && listed.canEnable, JSON.stringify(listed))
    check(!(await html('/')).includes('cms-consent-config'), 'configuration présente alors que le module est désactivé')
    const { p, context } = await visitorPage()
    await p.goto(B + '/', { waitUntil: 'networkidle0' })
    check(!(await banner(p)) && !(await p.$('[data-cms-consent-link]')), 'bandeau ou lien affiché')
    await context.close()
  })

  await step('activation et réglage : adresse de la politique contrôlée ; configuration dans les pages du site seulement', async () => {
    check((await claire.call('/api/cms/modules/consent/enabled', { method: 'PUT', body: { enabled: true } })).status === 200, 'activation refusée')
    const bad = await claire.call('/api/cms/modules/consent', { method: 'PUT', body: { values: { policyUrl: 'javascript:alert(1)' } } })
    check(bad.status === 400 && /page du site/.test(bad.json.message), `${bad.status} ${bad.text}`)
    check((await claire.call('/api/cms/modules/consent', { method: 'PUT', body: { values: { policyUrl: '/confidentialite' } } })).status === 200, 'réglage refusé')
    const home = await html('/')
    const tag = /<script type="application\/json" id="cms-consent-config">(.*?)<\/script>/s.exec(home)
    check(!!tag, 'configuration absente de la page d\'accueil')
    const sent = JSON.parse(tag[1])
    check(sent.purposes.length === 1 && sent.purposes[0].id === 'ads' && sent.policyUrl === '/confidentialite' && sent.defaultLocale === 'fr', tag[1])
    check(!(await html('/admin/login')).includes('cms-consent-config'), 'configuration présente dans le back-office')
    await page.goto(B + '/admin', { waitUntil: 'networkidle0' })
    check(!(await banner(page)), 'bandeau affiché dans le back-office')
  })

  await step('première visite : bandeau affiché, rien d\'écrit avant le choix, refuser aussi simple qu\'accepter', async () => {
    const { p, context } = await visitorPage()
    await p.goto(B + '/', { waitUntil: 'networkidle0' })
    await waitBanner(p)
    check(await stored(p) === null && !(await p.evaluate(() => document.cookie)).includes('consent'), 'un choix est écrit avant que le visiteur ait choisi')
    const text = await p.$eval('[data-cms-consent]', e => e.innerText)
    check(text.includes('Votre accord') && text.includes('Mesure de la publicité') && text.includes('Tout refuser') && text.includes('Tout accepter') && text.includes('Personnaliser'), text)
    check(await p.$eval('[data-cms-consent-policy]', a => a.getAttribute('href')) === '/confidentialite', 'lien vers la politique')
    // Les deux boutons ont la même taille, la même couleur, la même police, et sont sur la même ligne.
    const look = sel => p.$eval(sel, (b) => { const r = b.getBoundingClientRect(); const s = getComputedStyle(b); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bg: s.backgroundColor, color: s.color, weight: s.fontWeight, size: s.fontSize } })
    const refuse = await look('[data-cms-consent-action=refuse]'), accept = await look('[data-cms-consent-action=accept]')
    check(JSON.stringify({ ...refuse, w: 0 }) === JSON.stringify({ ...accept, w: 0 }) && Math.abs(refuse.w - accept.w) <= 2, `refuser ${JSON.stringify(refuse)} ; accepter ${JSON.stringify(accept)}`)
    // Le site reste utilisable derrière le bandeau, et le site peut demander l'accord : tout est refusé pour l'instant.
    check(await p.evaluate(() => document.elementFromPoint(innerWidth / 2, 40)?.closest('[data-cms-consent]') === null), 'le bandeau couvre le haut de la page')
    await t.shot(p, 'bandeau')
    await context.close()
  })

  await step('tout refuser : bandeau fermé, choix gardé, pas redemandé ; « Gérer mes cookies » le rouvre, rien de coché', async () => {
    const { p, context } = await visitorPage()
    await p.goto(B + AD, { waitUntil: 'networkidle0' })
    await waitBanner(p)
    await act(p, 'refuse')
    await waitNoBanner(p)
    const choice = await stored(p)
    check(choice.v === 1 && JSON.stringify(choice.choices) === '{"ads":false}' && Math.abs(choice.at - Date.now()) < 60_000, JSON.stringify(choice))
    // Refus : le contact part sans accord.
    await navigate(p, '/contact')
    await sendContact(p, 'Visiteur qui refuse')
    const refused = (await message('Visiteur qui refuse')).origin
    check(refused.channel === 'google-ads' && refused.consent === undefined, JSON.stringify(refused))
    await p.goto(B + '/', { waitUntil: 'networkidle0' })
    await p.waitForSelector('[data-cms-consent-link]')
    check(!(await banner(p)), 'bandeau redemandé après un refus')
    check((await p.$eval('[data-cms-consent-link]', b => b.textContent.trim())) === 'Gérer mes cookies', 'texte du lien')
    await p.$eval('[data-cms-consent-link]', b => b.click())
    await p.waitForSelector('[data-cms-consent][data-view=details]')
    check(await p.$eval('[data-cms-consent-purpose=ads]', c => c.checked) === false, 'case cochée après un refus')
    // Échap referme sans rien changer, puisqu'un choix existe.
    await p.keyboard.press('Escape')
    await waitNoBanner(p)
    check(JSON.stringify((await stored(p)).choices) === '{"ads":false}', 'choix modifié par Échap')
    await context.close()
  })

  await step('personnaliser puis accepter : rien de coché d\'avance, choix enregistré, accord joint au contact', async () => {
    const { p, context } = await visitorPage()
    await p.goto(B + AD, { waitUntil: 'networkidle0' })
    await waitBanner(p)
    await act(p, 'customize')
    await p.waitForSelector('[data-cms-consent][data-view=details]')
    check(await p.$eval('[data-cms-consent-purpose=ads]', c => c.checked) === false, 'case cochée d\'avance')
    await t.shot(p, 'personnaliser')
    await p.click('[data-cms-consent-purpose=ads]')
    const events = p.evaluate(() => new Promise(resolve => window.addEventListener('cms:consent', e => resolve(e.detail), { once: true })))
    await act(p, 'save')
    await waitNoBanner(p)
    check(JSON.stringify(await events) === '{"ads":true}' && JSON.stringify((await stored(p)).choices) === '{"ads":true}', JSON.stringify(await stored(p)))
    await navigate(p, '/contact')
    await sendContact(p, 'Visiteur qui accepte')
    const accepted = (await message('Visiteur qui accepte')).origin
    check(accepted.channel === 'google-ads' && accepted.clickId === 'TEST-GCLID-CONSENT' && accepted.consent === true, JSON.stringify(accepted))
    // Dans le back-office, l'accord est écrit avec la provenance du message.
    await page.goto(`${B}/admin/forms`, { waitUntil: 'networkidle0' })
    await clickText(page, 'main ul.divide-y li button', 'Visiteur qui accepte')
    check((await page.$eval('[data-origin-detail]', e => e.innerText)).includes('mesure de la publicité acceptée'), 'accord absent du détail')
    // Il change d'avis : « Tout refuser » depuis le lien.
    await p.goto(B + '/', { waitUntil: 'networkidle0' })
    await p.waitForSelector('[data-cms-consent-link]')
    await p.$eval('[data-cms-consent-link]', b => b.click())
    await p.waitForSelector('[data-cms-consent][data-view=details]')
    check(await p.$eval('[data-cms-consent-purpose=ads]', c => c.checked) === true, 'choix précédent non rappelé')
    await act(p, 'refuse')
    await waitNoBanner(p)
    check(JSON.stringify((await stored(p)).choices) === '{"ads":false}', 'refus non enregistré')
    await context.close()
  })

  await step('choix de plus de six mois, ou illisible : redemandé', async () => {
    const { p, context } = await visitorPage()
    await p.goto(B + '/', { waitUntil: 'networkidle0' })
    await waitBanner(p)
    await act(p, 'accept')
    await waitNoBanner(p)
    await p.evaluate((key) => { const s = JSON.parse(localStorage.getItem(key)); s.at = Date.now() - 150 * 86_400_000; localStorage.setItem(key, JSON.stringify(s)) }, KEY)
    await p.reload({ waitUntil: 'networkidle0' })
    await p.waitForSelector('[data-cms-consent-link]')
    check(!(await banner(p)), 'choix de cinq mois redemandé')
    await p.evaluate((key) => { const s = JSON.parse(localStorage.getItem(key)); s.at = Date.now() - 190 * 86_400_000; localStorage.setItem(key, JSON.stringify(s)) }, KEY)
    await p.reload({ waitUntil: 'networkidle0' })
    await waitBanner(p)
    await p.evaluate(key => localStorage.setItem(key, 'pas du json'), KEY)
    await p.reload({ waitUntil: 'networkidle0' })
    await waitBanner(p)
    await context.close()
  })

  await step('page en anglais : bandeau en anglais ; largeur de téléphone : tout tient à l\'écran', async () => {
    await claire.json('/api/cms/entries/services', { method: 'POST', body: { values: { title: 'Droit des affaires', onQuote: true }, translations: { en: { values: { title: 'Business law' } } }, publish: ['fr', 'en'] } })
    const { p, context } = await visitorPage()
    await p.goto(B + '/en/services/business-law', { waitUntil: 'networkidle0' })
    await waitBanner(p)
    const text = await p.$eval('[data-cms-consent]', e => e.innerText)
    check(text.includes('Your consent') && text.includes('Refuse all') && text.includes('Accept all') && text.includes('Privacy policy'), text)
    await p.setViewport({ width: 390, height: 780 })
    await p.goto(B + '/', { waitUntil: 'networkidle0' })
    await waitBanner(p)
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    const box = await p.$eval('.cms-consent-box', (e) => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom } })
    check(overflow <= 0 && box.left >= 0 && box.right <= 390 && box.top >= 0 && box.bottom <= 780, `débordement ${overflow} px, boîte ${JSON.stringify(box)}`)
    const buttons = await p.$$eval('[data-cms-consent-action]', els => els.map((b) => { const r = b.getBoundingClientRect(); return [b.dataset.cmsConsentAction, Math.round(r.width), Math.round(r.height)] }))
    const refuse = buttons.find(b => b[0] === 'refuse'), accept = buttons.find(b => b[0] === 'accept')
    check(Math.abs(refuse[1] - accept[1]) <= 2 && refuse[2] === accept[2] && refuse[2] >= 40, JSON.stringify(buttons))
    await t.shot(p, 'bandeau-telephone')
    // Au clavier : le bandeau reçoit le clavier à l'ouverture, et ses boutons se suivent à la tabulation.
    check(await p.evaluate(() => document.activeElement?.matches('[data-cms-consent]')), 'le bandeau n\'a pas reçu le clavier')
    await p.keyboard.press('Tab'); await p.keyboard.press('Tab')
    check(await p.evaluate(() => !!document.activeElement?.closest('[data-cms-consent]')), 'la tabulation sort du bandeau')
    await context.close()
  })

  await step('module désactivé de nouveau : le bandeau disparaît des pages', async () => {
    check((await claire.call('/api/cms/modules/consent/enabled', { method: 'PUT', body: { enabled: false } })).status === 200, 'désactivation refusée')
    check(!(await html('/')).includes('cms-consent-config'), 'configuration encore présente')
  })
}
