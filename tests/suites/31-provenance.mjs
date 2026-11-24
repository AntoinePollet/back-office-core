// Provenance des contacts : relevée par le site à l'arrivée du visiteur (annonce Google Ads, moteur de recherche…),
// envoyée avec le formulaire, contrôlée par le serveur, montrée dans « Messages reçus » (tableau, filtre, détail).
import { check, clickText, json, login, says, until } from '../lib/harness.mjs'
import { config } from '../lib/config.mjs'

export const meta = { title: 'provenance des contacts : annonce, moteur de recherche, accès direct, écran Messages reçus' }

const AD = '/?utm_source=google&utm_medium=cpc&utm_campaign=printemps&utm_term=avocat+lyon&gclid=TEST-GCLID-42'

export default async function (t) {
  const { B, step } = t
  const page = await t.newPage()
  const messages = async () => (await json(page, '/api/cms/forms')).submissions
  /** Va sur une page du site sans recharger (navigation interne de Nuxt), comme un clic sur un lien du menu. */
  const navigate = (p, path) => p.evaluate(path => document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$router.push(path), path)
  /** Remplit et envoie le formulaire de contact. */
  const send = async (p, name) => {
    await p.waitForSelector('input[name=name]')
    await p.type('input[name=name]', name)
    await p.type('input[name=email]', 'visiteur@example.com')
    await p.type('textarea[name=message]', 'Bonjour, je voudrais un rendez-vous.')
    await p.click('input[name=consent]')
    await clickText(p, 'button', 'Envoyer'); await says(p, 'Merci, votre message est bien parti.')
  }
  /** Chaque visiteur a sa propre adresse : la limite d'envois par visiteur ne gêne pas la suite. */
  const visitorPage = async (n) => {
    const context = await t.newContext(); const p = await t.newPage({ context })
    await p.setExtraHTTPHeaders({ [config.ipHeader]: `203.0.113.${n}` })
    return { p, context }
  }

  await step('préparation : connexion', () => login(page, B))

  await step('arrivée par une annonce Google Ads, puis contact sans recharger : provenance enregistrée avec le message', async () => {
    const { p, context } = await visitorPage(1)
    await p.goto(B + AD, { waitUntil: 'networkidle0' })
    await navigate(p, '/contact')
    await send(p, 'Annonce Google')
    await context.close()
    const m = await until(async () => (await messages()).find(s => s.values.name === 'Annonce Google'), 'message')
    const o = m.origin
    check(o?.channel === 'google-ads' && o.source === 'google' && o.medium === 'cpc' && o.campaign === 'printemps' && o.term === 'avocat lyon', JSON.stringify(o))
    check(o.click === 'gclid' && o.clickId === 'TEST-GCLID-42' && o.landing === '/' && typeof o.at === 'number' && Math.abs(o.at - Date.now()) < 120_000, JSON.stringify(o))
  })

  await step('arrivée depuis un moteur de recherche : seul le domaine du site précédent est gardé', async () => {
    const { p, context } = await visitorPage(2)
    // En http : le serveur de test l'est aussi, et Chrome n'envoie pas le site précédent d'une page https vers une page http.
    await p.goto(B + '/contact', { waitUntil: 'networkidle0', referer: 'http://www.qwant.com/?q=avocat+lyon+confidentiel', referrerPolicy: 'unsafe-url' })
    await send(p, 'Moteur de recherche')
    await context.close()
    const m = await until(async () => (await messages()).find(s => s.values.name === 'Moteur de recherche'), 'message')
    check(JSON.stringify({ ...m.origin, at: undefined }) === JSON.stringify({ referrer: 'www.qwant.com', landing: '/contact', channel: 'search' }), JSON.stringify(m.origin))
    check(!JSON.stringify(m).includes('confidentiel'), 'la recherche du visiteur a été gardée')
  })

  await step('accès direct : pas de provenance ; rien n\'est écrit sur l\'appareil du visiteur', async () => {
    const { p, context } = await visitorPage(3)
    await p.goto(B + AD, { waitUntil: 'networkidle0' })
    // Rechargement complet : la provenance n'était qu'en mémoire, elle est perdue (pas de traceur sans accord).
    await p.goto(B + '/contact', { waitUntil: 'networkidle0' })
    const stored = await p.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage }, cookie: document.cookie }))
    check(!JSON.stringify(stored).includes('printemps') && !JSON.stringify(stored).includes('GCLID'), 'provenance écrite sur l\'appareil : ' + JSON.stringify(stored))
    await send(p, 'Accès direct')
    await context.close()
    const m = await until(async () => (await messages()).find(s => s.values.name === 'Accès direct'), 'message')
    check(m.origin === null, JSON.stringify(m.origin))
  })

  await step('provenance envoyée par un robot : contrôlée, canal recalculé, champs inconnus et textes trop longs écartés', async () => {
    const api = t.http()
    const post = (name, origin, ip) => api.call('/api/forms/contact', {
      method: 'POST', headers: { [config.ipHeader]: ip },
      body: { values: { name, email: 'robot@example.com', subject: 'devis', message: 'Message envoyé directement.', consent: true }, origin },
    })
    check((await post('Robot 1', { channel: 'google-ads', source: 'salon', campaign: 'x'.repeat(5000), admin: true, landing: 'https://pirate.example' }, '203.0.113.20')).status === 200, 'envoi refusé')
    check((await post('Robot 2', 'texte', '203.0.113.21')).status === 200, 'envoi refusé avec une provenance mal formée')
    const all = await messages()
    const one = all.find(s => s.values.name === 'Robot 1').origin
    check(one.channel === 'campaign' && one.campaign.length === 200 && !('admin' in one) && !('landing' in one), JSON.stringify(one).slice(0, 300))
    check(all.find(s => s.values.name === 'Robot 2').origin === null, 'provenance mal formée gardée')
    // On remet la liste dans l'état attendu par les étapes suivantes.
    for (const s of all.filter(s => s.values.name.startsWith('Robot'))) await page.evaluate(id => fetch(`/api/cms/forms/submissions/${id}`, { method: 'DELETE' }), s.id)
  })

  await step('Messages reçus : d\'où viennent les messages, filtre par canal, détail, campagne', async () => {
    await page.goto(B + '/admin/forms', { waitUntil: 'networkidle0' })
    await page.waitForSelector('[data-origin-stats]')
    const channels = await page.$$eval('[data-origin-channel]', els => els.map(e => [e.dataset.originChannel, e.querySelector('[data-origin-count]').textContent.trim()]))
    check(JSON.stringify(channels.sort()) === JSON.stringify([['direct', '1'], ['google-ads', '1'], ['search', '1']]), JSON.stringify(channels))
    const paid = await page.$eval('[data-origin-paid]', e => e.textContent.replace(/\s+/g, ' ').trim())
    check(paid === '1 message sur 3 grâce à une publicité (33 %).', paid)
    check(await page.$eval('[data-origin-campaign]', e => e.dataset.originCampaign) === 'printemps', 'campagne absente du tableau')
    // Badge dans la liste pour le message venu d'une annonce seulement.
    check((await page.$$('[data-origin-badge]')).length === 1, 'badges : ' + (await page.$$('[data-origin-badge]')).length)
    // Filtre : seulement Google Ads, puis tous les canaux.
    await page.$eval('[data-origin-channel="google-ads"] button', b => b.click())
    await page.waitForFunction(() => document.querySelectorAll('main ul.divide-y > li').length === 1)
    await clickText(page, 'main ul.divide-y li button', 'Annonce Google')
    await page.waitForSelector('[data-origin-detail][data-channel="google-ads"]')
    const detail = await page.$eval('[data-origin-detail]', e => e.innerText)
    check(detail.includes('Google Ads') && detail.includes('printemps') && detail.includes('avocat lyon') && detail.includes('google / cpc') && detail.includes('gclid'), detail)
    await t.shot(page, 'messages-provenance')
    await page.$eval('[data-origin-clear]', b => b.click())
    await page.waitForFunction(() => document.querySelectorAll('main ul.divide-y > li').length === 3)
    await clickText(page, 'main ul.divide-y li button', 'Accès direct')
    await page.waitForSelector('[data-origin-detail][data-channel="direct"]')
    await says(page, 'Aucun indice relevé')
  })

  await step('période : un message hors de la période choisie n\'est ni compté ni listé', async () => {
    // « 7 jours » : les trois messages viennent d'arriver, ils y sont ; il n'y en a pas d'autre à exclure ici,
    // la règle elle-même est vérifiée par les tests unitaires (shared/attribution.test.ts).
    await page.$eval('[data-origin-period="7"]', b => b.click())
    await page.waitForFunction(() => document.querySelector('[data-origin-period="7"]').classList.contains('tab-active'))
    check((await page.$$('main ul.divide-y > li')).length === 3, 'liste sur 7 jours')
  })

  await step('workflow « formulaire envoyé » : variables de provenance proposées', async () => {
    const { events } = await json(page, '/api/cms/workflows')
    const keys = events.find(e => e.name === 'form.submitted').variables.map(v => v.key)
    check(['origin.channel', 'origin.campaign', 'origin.term', 'origin.source'].every(k => keys.includes(k)), keys.join())
  })
}
