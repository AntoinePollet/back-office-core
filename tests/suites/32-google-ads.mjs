// Module Google Ads (lecture) : réglages, vérification de la connexion, erreurs traduites, rapport des campagnes
// rapproché des contacts du site (identifiant de campagne, nom, gclid retrouvé chez Google), écran, droits ;
// pilotage par l'administrateur : pause, reprise, budget par jour, garde-fous, journal d'activité.
import { check, clickText, json, login, says } from '../lib/harness.mjs'
import { config } from '../lib/config.mjs'
import { CUSTOMER_DOWN, CUSTOMER_EMPTY, CUSTOMER_READ_ONLY, CUSTOMER_TEST_ONLY, CUSTOMER_VIA_MANAGER, KNOWN_GCLID, MANAGER, SECRET_UNKNOWN, TOKEN_REVOKED } from '../lib/mock-google.mjs'

export const meta = {
  title: 'Google Ads : réglages, campagnes, contacts du site par campagne, coût par contact',
  mock: true,
  // Seules les adresses de Google visent le faux service ; les identifiants sont saisis dans le back-office.
  env: ({ mock }) => ({ NUXT_GOOGLE_ADS_API_URL: `${mock}/google-ads/v26`, NUXT_GOOGLE_OAUTH_TOKEN_URL: `${mock}/google/token` }),
}

const CLIENT = '1234-abcd.apps.googleusercontent.com'
const SECRET = 'GOCSPX-secret-du-client'
const TOKEN = 'jeton-actualisation-1'
const CUSTOMER = '123-456-7890'

export default async function (t) {
  const { B, step, calls } = t
  const page = await t.newPage()
  const claire = t.http(), marc = t.http(), lina = t.http(), visitor = t.http()
  const searches = (part = '') => calls().filter(c => c.url.includes('googleAds:search') && String(c.body?.query ?? '').includes(part))
  const save = (values, secrets) => claire.call('/api/cms/modules/google-ads', { method: 'PUT', body: { values, ...(secrets ? { secrets } : {}) } })
  const verify = async () => (await claire.json('/api/cms/modules/google-ads/test', { method: 'POST' }))
  const report = (days = 30, client = claire) => client.call(`/api/cms/google-ads?days=${days}`)
  let ip = 30
  const contact = (name, origin) => visitor.call('/api/forms/contact', {
    method: 'POST', headers: { [config.ipHeader]: `203.0.113.${ip++}` },
    body: { values: { name, email: 'visiteur@example.com', subject: 'devis', message: 'Bonjour, je voudrais un rendez-vous.', consent: true }, origin },
  })

  await step('module désactivé : ni menu ni chiffres ; réglages réservés à l\'administrateur', async () => {
    await login(page, B)
    check((await claire.signIn(t.admin.email, t.admin.password)).status === 200, 'connexion refusée')
    const listed = (await claire.json('/api/cms/modules')).find(m => m.id === 'google-ads')
    check(listed && !listed.enabled && listed.category === 'ads' && listed.canEnable, JSON.stringify(listed))
    check((await report()).status === 404, 'chiffres servis alors que le module est désactivé')
    await page.goto(B + '/admin', { waitUntil: 'networkidle0' })
    check(!(await page.$$eval('aside .menu a', els => els.map(a => a.textContent))).some(x => x.includes('Annonces Google')), 'menu affiché')
    check((await claire.call('/api/cms/modules/google-ads/enabled', { method: 'PUT', body: { enabled: true } })).status === 200, 'activation refusée')
    const empty = (await report()).json
    check(empty.state === 'unconfigured', JSON.stringify(empty))
  })

  await step('réglages : numéros et client mal écrits refusés, secrets jamais renvoyés', async () => {
    const bad = await save({ customerId: '12345', clientId: 'pas-un-client' })
    check(bad.status === 400 && /dix chiffres/.test(bad.json.message), `${bad.status} ${bad.text}`)
    const saved = (await save({ customerId: CUSTOMER, clientId: CLIENT }, { clientSecret: SECRET, refreshToken: TOKEN })).json
    check(saved.configured && saved.enabled, JSON.stringify(saved).slice(0, 300))
    const text = (await claire.get('/api/cms/modules/google-ads')).text
    check(!text.includes(SECRET) && !text.includes(TOKEN), 'un secret est renvoyé par l\'API')
  })

  await step('vérifier la connexion : compte nommé ; aucun jeton développeur n\'est envoyé', async () => {
    const r = await verify()
    check(r.ok && r.message === 'Connexion réussie au compte Google Ads « Cabinet Durand » (EUR).', JSON.stringify(r))
    const token = calls().find(c => c.url === '/google/token')
    check(token.body.grant_type === 'refresh_token' && token.body.client_id === CLIENT && token.body.client_secret === SECRET && token.body.refresh_token === TOKEN, JSON.stringify(token.body))
    const call = searches('FROM customer').pop()
    check(call.url === '/google-ads/v26/customers/1234567890/googleAds:search' && call.auth === `Bearer acces-${TOKEN}` && call.developerToken === null && call.login === null, JSON.stringify(call))
  })

  await step('refus de Google traduits : jeton révoqué, secret inconnu, accès « Test », compte administrateur manquant, panne', async () => {
    await save({}, { refreshToken: TOKEN_REVOKED })
    let r = await verify()
    check(!r.ok && /expiré ou a été révoqué/.test(r.message) && /7 jours/.test(r.message), JSON.stringify(r))
    await save({}, { refreshToken: TOKEN, clientSecret: SECRET_UNKNOWN })
    r = await verify()
    check(!r.ok && /identifiant client OAuth ou son secret/.test(r.message), JSON.stringify(r))
    await save({ customerId: CUSTOMER_TEST_ONLY }, { clientSecret: SECRET })
    r = await verify()
    check(!r.ok && /Explorer/.test(r.message), JSON.stringify(r))
    const refused = (await report()).json
    check(refused.state === 'refused' && /Explorer/.test(refused.message), JSON.stringify(refused))
    await save({ customerId: CUSTOMER_VIA_MANAGER })
    r = await verify()
    check(!r.ok && /compte administrateur \(MCC\)/.test(r.message), JSON.stringify(r))
    await save({ loginCustomerId: `${MANAGER.slice(0, 3)}-${MANAGER.slice(3, 6)}-${MANAGER.slice(6)}` })
    r = await verify()
    check(r.ok && searches('FROM customer').pop().login === MANAGER, JSON.stringify(r))
    await save({ customerId: CUSTOMER_DOWN, loginCustomerId: '' })
    const down = (await report()).json
    check(down.state === 'unavailable' && /ne répond pas/.test(down.message), JSON.stringify(down))
    await save({ customerId: CUSTOMER_EMPTY })
    const none = (await report()).json
    check(none.state === 'ok' && none.report.campaigns.length === 0 && none.report.totals.costMicros === 0, JSON.stringify(none))
    await save({ customerId: CUSTOMER })
    check((await verify()).ok, 'retour aux bons réglages')
  })

  await step('rapport : contacts rattachés par identifiant de campagne, par nom, par gclid retrouvé chez Google', async () => {
    const sent = await Promise.all([
      contact('Par identifiant', { source: 'google', medium: 'cpc', campaignId: '101' }),
      contact('Par gclid', { click: 'gclid', clickId: KNOWN_GCLID, at: Date.now() - 3_600_000 }),
      contact('Par nom', { source: 'google', medium: 'cpc', campaign: 'marque' }),
      contact('Clic inconnu', { click: 'gclid', clickId: 'GCLID-INCONNU-0002', at: Date.now() - 3_600_000 }),
      contact('Publicité Facebook', { source: 'facebook', medium: 'cpc', campaign: 'Printemps' }),
      contact('Accès direct', undefined),
    ])
    check(sent.every(r => r.status === 200), sent.map(r => r.status).join())
    const r = (await report()).json
    check(r.state === 'ok' && r.account.name === 'Cabinet Durand' && r.account.currency === 'EUR' && /^\d{4}-\d{2}-\d{2}$/.test(r.from) && r.to >= r.from, JSON.stringify(r).slice(0, 300))
    const rows = r.report.campaigns.map(c => [c.id, c.name, c.clicks, c.costMicros, c.contacts, c.costPerContactMicros])
    // « Ancienne », sans activité ni contact, n'est pas listée.
    check(JSON.stringify(rows) === JSON.stringify([['101', 'Printemps', 300, 150000000, 2, 75000000], ['102', 'Marque', 50, 20000000, 1, 20000000]]), JSON.stringify(rows))
    check(JSON.stringify(r.report.unassigned) === JSON.stringify({ messages: 1, payments: 0, contacts: 1 }), JSON.stringify(r.report.unassigned))
    const tot = r.report.totals
    check(tot.costMicros === 170000000 && tot.contacts === 4 && tot.costPerContactMicros === 42500000 && tot.clicks === 350 && tot.conversions === 5.5, JSON.stringify(tot))
    // La requête des campagnes porte sur la période, dans le fuseau du compte.
    const query = searches('FROM campaign').pop().body.query
    check(query.includes(`BETWEEN '${r.from}' AND '${r.to}'`), query)
  })

  await step('gclid : la campagne retrouvée est enregistrée avec le message, et n\'est plus redemandée ; un clic récent introuvable sera recherché plus tard', async () => {
    const messages = (await json(page, '/api/cms/forms')).submissions
    const found = messages.find(m => m.values.name === 'Par gclid').origin
    check(found.campaignId === '101' && found.campaign === 'Printemps' && found.clickId === KNOWN_GCLID && found.channel === 'google-ads', JSON.stringify(found))
    const unknown = messages.find(m => m.values.name === 'Clic inconnu').origin
    check(!unknown.campaignId && !unknown.clickChecked, JSON.stringify(unknown))
    const before = searches(KNOWN_GCLID).length
    check(before === 1, 'recherches du clic connu : ' + before)
    const campaignsBefore = searches('FROM campaign').length
    check((await report()).json.report.campaigns[0].contacts === 2, 'rapport changé au second affichage')
    check(searches(KNOWN_GCLID).length === before, 'le clic déjà retrouvé a été redemandé à Google')
    // Les chiffres de Google sont gardés cinq minutes : pas de nouvel appel pour la même période.
    check(searches('FROM campaign').length === campaignsBefore, 'campagnes redemandées à Google malgré la mémoire')
  })

  await step('écran « Annonces Google » : totaux, campagnes, coût par contact, période', async () => {
    await page.goto(B + '/admin', { waitUntil: 'networkidle0' })
    await clickText(page, 'aside a', 'Annonces Google')
    await page.waitForSelector('[data-ads-state=ok]')
    const total = key => page.$eval(`[data-ads-total=${key}]`, e => e.textContent.replace(/\s+/g, ' ').trim())
    check(await total('cost') === '170,00 €' && await total('contacts') === '4' && await total('costPerContact') === '42,50 €' && await total('conversions') === '5,5', [await total('cost'), await total('contacts'), await total('costPerContact'), await total('conversions')].join(' | '))
    const rows = await page.$$eval('[data-ads-campaign]', trs => trs.map(tr => [tr.dataset.adsCampaign, tr.querySelector('[data-ads-cost]').textContent, tr.querySelector('[data-ads-contacts]').textContent, tr.querySelector('[data-ads-cpc]').textContent].map(x => x.replace(/\s+/g, ' ').trim())))
    check(JSON.stringify(rows) === JSON.stringify([['101', '150,00 €', '2', '75,00 €'], ['102', '20,00 €', '1', '20,00 €']]), JSON.stringify(rows))
    check((await page.$eval('[data-ads-unassigned]', e => e.innerText)).includes('campagne non retrouvée'), 'ligne des contacts sans campagne absente')
    await says(page, 'Compte « Cabinet Durand »')
    await t.shot(page, 'annonces')
    const before = searches('FROM campaign').length
    await page.$eval('[data-ads-period="7"]', b => b.click())
    await page.waitForFunction(() => document.querySelector('[data-ads-period="7"]').getAttribute('aria-pressed') === 'true')
    await page.waitForFunction(() => !document.querySelector('[data-ads-state=ok]').classList.contains('opacity-50'))
    check(searches('FROM campaign').length === before + 1, 'la période n\'a pas été redemandée à Google')
    // Largeur de téléphone : pas de débordement de la page.
    await page.setViewport({ width: 390, height: 1200 })
    await page.waitForFunction(() => innerWidth === 390)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check(overflow <= 0, `la page déborde de ${overflow} px`)
    await t.shot(page, 'annonces-telephone')
    await page.setViewport({ width: 1400, height: 1100 })
  })

  await step('droits : l\'éditeur lit les chiffres, le rédacteur et le visiteur non', async () => {
    for (const [who, client] of [[{ name: 'Marc Petit', email: 'marc@example.com', role: 'editor' }, marc], [{ name: 'Lina Roux', email: 'lina@example.com', role: 'writer' }, lina]]) {
      const { link } = await claire.json('/api/cms/users', { method: 'POST', body: who })
      await visitor.post(link.replace(/^.*\/admin\/invite\//, '/api/cms/invite/'), { password: 'motdepasse-test-2' })
      check((await client.signIn(who.email, 'motdepasse-test-2')).status === 200, 'connexion refusée pour ' + who.name)
    }
    const codes = [(await report(30, marc)).status, (await report(30, lina)).status, (await report(30, visitor)).status]
    check(codes.join() === '200,403,401', codes.join())
    check((await marc.call('/api/cms/modules/google-ads', { method: 'PUT', body: { values: { customerId: CUSTOMER } } })).status === 403, 'l\'éditeur change les réglages')
  })

  const mutates = () => calls().filter(c => c.url.endsWith(':mutate'))
  const campaign = id => t.google.campaigns().find(c => c.id === id)
  const setStatus = (id, status, client = claire) => client.call(`/api/cms/google-ads/campaigns/${id}/status`, { method: 'PUT', body: { status } })
  const setBudget = (id, amount, expectedMicros, client = claire) => client.call(`/api/cms/google-ads/campaigns/${id}/budget`, { method: 'PUT', body: { amount, expectedMicros } })
  const journal = async () => (await claire.json('/api/cms/activity?limit=100')).items.map(i => i.summary ?? i.phrase ?? JSON.stringify(i))
  const row = async id => (await report()).json.report.campaigns.find(c => c.id === id)

  await step('pause et reprise d\'une campagne : état relu chez Google, une seule demande, journal d\'activité', async () => {
    const before = await row('101')
    check(before.status === 'ENABLED' && before.budget.amountMicros === 20000000 && before.budget.period === 'DAILY' && !before.budget.shared, JSON.stringify(before.budget))
    let r = await setStatus('101', 'PAUSED')
    check(r.status === 200 && r.json.status === 'PAUSED' && campaign('101').status === 'PAUSED', `${r.status} ${r.text}`)
    const sent = mutates().pop()
    check(sent.url === '/google-ads/v26/customers/1234567890/campaigns:mutate' && JSON.stringify(sent.body) === JSON.stringify({ operations: [{ update: { resourceName: 'customers/1234567890/campaigns/101', status: 'PAUSED' }, updateMask: 'status' }] }), JSON.stringify(sent))
    // Le rapport ne ressert pas l'ancien état gardé en mémoire.
    check((await row('101')).status === 'PAUSED', 'le rapport montre encore la campagne active')
    // Déjà en pause : rien n'est redemandé à Google.
    const count = mutates().length
    check((await setStatus('101', 'PAUSED')).status === 200 && mutates().length === count, 'seconde demande envoyée à Google')
    // Refus : état inconnu, campagne inconnue, campagne supprimée.
    check((await setStatus('101', 'REMOVED')).status === 400, 'suppression acceptée')
    check((await setStatus('999', 'PAUSED')).status === 404 && (await setStatus('101 OR 1=1', 'PAUSED')).status === 404, 'campagne inconnue acceptée')
    r = await setStatus('103', 'ENABLED')
    check(r.status === 409 && /supprimée/.test(r.json.message), `${r.status} ${r.text}`)
    check(mutates().length === count, 'une demande refusée est partie chez Google')
    // Depuis l'écran : bouton « Relancer », avec confirmation.
    await page.goto(B + '/admin/google-ads', { waitUntil: 'networkidle0' })
    await page.waitForSelector('[data-ads-campaign="101"] [data-ads-toggle]')
    check((await page.$eval('[data-ads-campaign="101"] [data-ads-toggle]', b => b.textContent.trim())) === 'Relancer', 'bouton de la campagne en pause')
    const asked = []
    page.once('dialog', d => asked.push(d.message()))
    await page.$eval('[data-ads-campaign="101"] [data-ads-toggle]', b => b.click())
    await page.waitForFunction(() => document.querySelector('[data-ads-campaign="101"] [data-ads-status]')?.textContent.trim() === 'Active')
    check(/Relancer la campagne « Printemps »/.test(asked[0]) && asked[0].replace(/\s/g, ' ').includes('20,00 € par jour') && campaign('101').status === 'ENABLED', asked[0])
    const lines = await journal()
    check(lines.some(l => l.includes('a mis en pause la campagne Google Ads « Printemps »')) && lines.some(l => l.includes('a relancé la campagne Google Ads « Printemps »')), lines.slice(0, 4).join(' | '))
  })

  await step('budget par jour : fenêtre, plafonds annoncés, refus de Google affiché, changement appliqué et inscrit au journal', async () => {
    // Budget partagé (« Marque ») : pas de crayon, la raison est écrite ; campagne supprimée : pas listée.
    check(!(await page.$('[data-ads-campaign="102"] [data-ads-budget-edit]')) && /partagé entre plusieurs campagnes/.test(await page.$eval('[data-ads-campaign="102"] [data-ads-budget-lock]', e => e.textContent)), 'budget partagé modifiable')
    check((await page.$eval('[data-ads-campaign="101"] [data-ads-budget]', e => e.textContent.replace(/\s+/g, ' ').trim())).startsWith('20,00 €'), 'budget affiché')
    await page.$eval('[data-ads-campaign="101"] [data-ads-budget-edit]', b => b.click())
    await page.waitForSelector('[data-ads-budget-dialog][open] [data-ads-budget-input]')
    const input = await page.$('[data-ads-budget-input]')
    check(await input.evaluate(el => el.value) === '20,00', 'montant proposé : ' + await input.evaluate(el => el.value))
    check(await page.$eval('[data-ads-budget-save]', b => b.disabled), 'bouton actif sans changement')
    const type = async (value) => { await input.evaluate((el) => { el.focus(); el.select() }); await page.keyboard.press('Backspace'); await input.type(value) }
    // En dessous du minimum de Google : la demande part, Google refuse, le message est affiché et rien ne change.
    await type('0,50')
    await page.$eval('[data-ads-budget-save]', b => b.click())
    await page.waitForSelector('[data-ads-budget-error]')
    check(/en dessous du minimum/.test(await page.$eval('[data-ads-budget-error]', e => e.textContent)) && campaign('101').budgetMicros === 20000000, await page.$eval('[data-ads-budget-error]', e => e.textContent))
    // Saisie illisible : le bouton reste inactif.
    await type('beaucoup')
    check(await page.$eval('[data-ads-budget-save]', b => b.disabled), 'bouton actif pour une saisie illisible')
    await type('35,5')
    await page.waitForSelector('[data-ads-budget-effect]')
    const effect = (await page.$eval('[data-ads-budget-effect]', e => e.textContent)).replace(/\s+/g, ' ')
    check(effect.includes('71,00 €') && effect.includes('1 079,20 €'), effect)
    await t.shot(page, 'budget')
    await page.$eval('[data-ads-budget-save]', b => b.click())
    await page.waitForFunction(() => !document.querySelector('[data-ads-budget-dialog][open]'))
    await page.waitForFunction(() => document.querySelector('[data-ads-campaign="101"] [data-ads-budget]')?.textContent.replace(/\s+/g, ' ').trim().startsWith('35,50 €'))
    check(campaign('101').budgetMicros === 35500000, 'budget chez Google : ' + campaign('101').budgetMicros)
    const sent = mutates().pop()
    check(sent.url === '/google-ads/v26/customers/1234567890/campaignBudgets:mutate' && JSON.stringify(sent.body) === JSON.stringify({ operations: [{ update: { resourceName: 'customers/1/campaignBudgets/501', amountMicros: 35500000 }, updateMask: 'amount_micros' }] }), JSON.stringify(sent))
    const lines = await journal()
    check(lines.some(l => l.replace(/\s/g, ' ').includes('a changé le budget par jour de la campagne Google Ads « Printemps » : 20,00 € → 35,50 €')), lines.slice(0, 3).join(' | '))
  })

  await step('budget : garde-fous du serveur (partagé, changé entre-temps, montant illisible ou démesuré)', async () => {
    const count = mutates().length
    let r = await setBudget('102', '10', 5000000)
    check(r.status === 409 && /partagé/.test(r.json.message), `${r.status} ${r.text}`)
    for (const bad of ['', 'dix', '-4', '0', '12,345', '20000']) check((await setBudget('101', bad, 35500000)).status === 400, 'montant accepté : ' + bad)
    // Quelqu'un a changé le budget dans Google Ads depuis l'affichage : rien n'est écrasé.
    t.google.setBudget('101', 60000000)
    r = await setBudget('101', '40', 35500000)
    check(r.status === 409 && /a changé dans Google Ads/.test(r.json.message) && campaign('101').budgetMicros === 60000000, `${r.status} ${r.text}`)
    check(mutates().length === count, 'une demande refusée est partie chez Google')
    // Même montant que l'actuel : accepté, sans demande à Google.
    check((await setBudget('101', '60', 60000000)).status === 200 && mutates().length === count, 'demande inutile envoyée')
    check((await setBudget('101', '40', 60000000)).status === 200 && campaign('101').budgetMicros === 40000000, 'changement refusé avec le bon montant attendu')
  })

  await step('pilotage réservé à l\'administrateur ; accès en lecture seule chez Google expliqué', async () => {
    check((await setStatus('101', 'PAUSED', marc)).status === 403 && (await setBudget('101', '1', 40000000, marc)).status === 403, 'l\'éditeur pilote une campagne')
    check((await setStatus('101', 'PAUSED', lina)).status === 403 && (await setStatus('101', 'PAUSED', visitor)).status === 401, 'rédacteur ou visiteur')
    check(campaign('101').status === 'ENABLED', 'campagne modifiée sans droit')
    // L'éditeur voit les chiffres et le budget, sans bouton.
    const context = await t.newContext(); const other = await t.newPage({ context })
    await login(other, B, { email: 'marc@example.com', password: 'motdepasse-test-2' })
    await other.goto(B + '/admin/google-ads', { waitUntil: 'networkidle0' })
    await other.waitForSelector('[data-ads-campaign="101"] [data-ads-budget]')
    check(!(await other.$('[data-ads-toggle]')) && !(await other.$('[data-ads-budget-edit]')), 'boutons de pilotage montrés à l\'éditeur')
    await context.close()
    // Jeton d'un compte Google qui n'a qu'un accès en lecture : Google refuse, et le message dit quoi faire.
    await save({ customerId: CUSTOMER_READ_ONLY })
    const r = await setStatus('101', 'PAUSED')
    check(r.status === 502 && /accès en lecture/.test(r.json.message) && /Standard/.test(r.json.message), `${r.status} ${r.text}`)
    check(campaign('101').status === 'ENABLED', 'campagne modifiée malgré le refus')
  })
}
