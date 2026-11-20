// Module Stripe : réglages, bouton « Acheter » du site, prix relu côté serveur, webhook signé, écran « Paiements », droits.
import { createHmac } from 'node:crypto'
import { check, clickText, json, login, menuLabels, says, until, wait } from '../lib/harness.mjs'

export const meta = {
  title: 'paiement Stripe : prix du back-office, webhook signé, écran Paiements',
  mock: true,
  // Stripe est joué par le faux service. Aucune clé dans l'hébergement : elle se saisit dans le back-office.
  env: ({ mock }) => ({ NUXT_STRIPE_API_URL: `${mock}/stripe` }),
}

const KEY = 'rk_test_cle-limitee-du-site-4242'
const WHSEC = 'whsec_secret-du-webhook-de-test'
const P = '/api/cms/entries/products'

/** Corps et en-tête d'un événement signé comme le fait Stripe (HMAC-SHA256 de « horodatage.corps »). */
function signed(event, { secret = WHSEC, at = Math.floor(Date.now() / 1000) } = {}) {
  const body = JSON.stringify(event)
  return { body, signature: `t=${at},v1=${createHmac('sha256', secret).update(`${at}.${body}`).digest('hex')}` }
}

export default async function (t) {
  const { B, M, step, calls } = t
  const page = await t.newPage()
  const claire = t.http(), marc = t.http(), lina = t.http(), visitor = t.http(), stripe = t.http()
  const sessionCalls = () => calls().filter(c => c.url === '/stripe/v1/checkout/sessions')
  const hook = (event, options) => {
    const { body, signature } = signed(event, options)
    return stripe.call('/api/stripe/webhook', { method: 'POST', body, headers: { 'content-type': 'application/json', 'stripe-signature': signature } })
  }
  const buy = (id, extra = {}) => visitor.post('/api/stripe/checkout', { collection: 'products', id, quantity: 1, ...extra })
  const ids = {}

  await step('préparation : produits publiés, brouillon, sans prix, hors vente, supprimé', async () => {
    await login(page, B)
    check((await claire.signIn(t.admin.email, t.admin.password)).status === 200, 'connexion refusée')
    // Une image dans la médiathèque, pour vérifier qu'elle part vers Stripe.
    const media = await page.evaluate(async () => {
      const canvas = Object.assign(document.createElement('canvas'), { width: 30, height: 20 })
      canvas.getContext('2d').fillRect(0, 0, 30, 20)
      const form = new FormData()
      form.append('file', await new Promise(r => canvas.toBlob(r, 'image/png')), 'panneau.png')
      return (await fetch('/api/cms/media', { method: 'POST', body: form })).json()
    })
    const create = async (values, publish = ['fr']) => (await claire.json(P, { method: 'POST', body: { values, publish } })).id
    ids.panel = await create({ title: 'Panneau acoustique', description: 'Absorbe les sons.', price: 49.9, onSale: true, image: media.id })
    ids.draft = await create({ title: 'Panneau en préparation', price: 30, onSale: true }, [])
    ids.noPrice = await create({ title: 'Panneau sur devis', onSale: true })
    ids.off = await create({ title: 'Panneau épuisé', price: 20, onSale: false })
    ids.gone = await create({ title: 'Panneau retiré', price: 10, onSale: true })
    check((await claire.del(`${P}/${ids.gone}`)).status === 200, 'suppression refusée')
    // Le brouillon du panneau passe à 1 € sans être publié : le site doit toujours faire payer 49,90 €.
    await claire.json(`${P}/${ids.panel}`, { method: 'PUT', body: { values: { price: 1 } } })
    check((await claire.json(`${P}/${ids.panel}`)).shared.price === 1, 'brouillon non enregistré')
  })

  await step('module Stripe à régler, logo officiel, paiement refusé tant qu\'il n\'est pas réglé', async () => {
    const labels = await menuLabels(page)
    check(labels.includes('Paiements'), 'menu : ' + labels.join(', '))
    await page.goto(B + '/admin/modules', { waitUntil: 'networkidle0' })
    const card = await page.$$eval('main [data-module] > a', els => els.map(e => e.innerText.replace(/\s+/g, ' ')).find(text => text.startsWith('Stripe')))
    check(card?.startsWith('Stripe À régler'), 'carte : ' + card)
    const logo = await page.$eval('main [data-module="stripe"] > a > span[aria-hidden] svg', s => s.getAttribute('fill'))
    check(logo === '#635BFF', 'logo : ' + logo)
    const r = await buy(ids.panel)
    check(r.status === 503 && r.json.message === 'Le paiement en ligne n\'est pas encore configuré sur ce site.', `${r.status} ${r.text}`)
    check(sessionCalls().length === 0, 'Stripe appelé sans réglage')
  })

  await step('réglages : adresse du webhook et événements à recopier, aide sur la clé limitée', async () => {
    await page.goto(B + '/admin/modules/stripe', { waitUntil: 'networkidle0' })
    await says(page, 'À recopier dans Stripe')
    const url = await page.$eval('code[data-detail="Adresse du webhook"]', c => c.textContent)
    check(url === `${B}/api/stripe/webhook`, 'adresse : ' + url)
    const events = await page.$eval('code[data-detail="Événements à cocher"]', c => c.textContent)
    check(events.split('\n').join() === 'checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,charge.refunded', events)
    await says(page, 'Créer une clé limitée'); await says(page, '« Checkout Sessions »')
  })
  await t.shot(page, 'reglages')

  await step('vérification : clé publiable, clé refusée, clé sans droit, puis bonne clé de test', async () => {
    await page.type('input[aria-label="Clé d\'API"]', 'pk_test_cle-publiable')
    await page.type('input[aria-label="Secret de signature du webhook"]', WHSEC)
    await clickText(page, 'button', 'Vérifier la connexion'); await says(page, 'C\'est la clé publiable (pk_…)')
    for (const [key, message] of [['rk_test_mauvaise', 'Stripe ne reconnaît pas cette clé d\'API.'], ['rk_test_sans-droit', 'n\'a pas le droit « Checkout Sessions »'], [KEY, 'Clé de TEST : les paiements sont simulés']]) {
      await clickText(page, 'button', 'Remplacer')
      await page.type('input[aria-label="Clé d\'API"]', key)
      await clickText(page, 'button', 'Vérifier la connexion'); await says(page, message)
    }
    const check1 = calls().filter(c => c.url.startsWith('/stripe/v1/checkout/sessions?')).pop()
    check(check1.key === KEY && check1.version === '2026-10-28.endive', JSON.stringify(check1))
    const one = await page.evaluate(() => fetch('/api/cms/modules/stripe').then(r => r.text()))
    check(!one.includes(KEY) && !one.includes(WHSEC) && !one.includes('cle-limitee'), 'une clé ressort par l\'API')
    check(JSON.parse(one).configured === true, 'module non réglé')
  })

  await step('bouton « Acheter » du site : session créée avec le prix publié, quantité, image, retour, puis redirection vers Stripe', async () => {
    const context = await t.newContext(); const site = await t.newPage({ context })
    await site.goto(B + '/boutique', { waitUntil: 'networkidle0' })
    const cards = await site.$$eval('[data-product]', els => els.map(e => e.dataset.product))
    // Seuls les produits publiés sont sur la page.
    check(cards.sort().join() === 'Panneau acoustique,Panneau sur devis,Panneau épuisé', cards.join())
    await t.shot(site, 'boutique')
    await site.setViewport({ width: 390, height: 1200 }); await wait(300)
    await t.shot(site, 'boutique-telephone')
    await site.setViewport({ width: 1400, height: 1100 })
    await site.select('select[aria-label="Quantité : Panneau acoustique"]', '2')
    await Promise.all([site.waitForNavigation(), clickText(site, '[data-product="Panneau acoustique"] button', 'Acheter')])
    check(site.url() === `${M}/stripe/checkout/cs_test_session0001`, 'adresse : ' + site.url())
    await t.shot(site, 'page-stripe')
    await context.close()
    const call = sessionCalls()[0]
    const b = call.body
    check(call.key === KEY && call.version === '2026-10-28.endive', `clé ${call.key}, version ${call.version}`)
    check(b['line_items[0][price_data][unit_amount]'] === '4990' && b['line_items[0][quantity]'] === '2' && b['line_items[0][price_data][currency]'] === 'eur', JSON.stringify(b))
    check(b['line_items[0][price_data][product_data][name]'] === 'Panneau acoustique' && b.mode === 'payment', JSON.stringify(b))
    check(/^https:\/\/cabinet-durand\.fr\/media\/.+\/panneau\.png$/.test(b['line_items[0][price_data][product_data][images][0]']), 'image : ' + b['line_items[0][price_data][product_data][images][0]'])
    check(b.success_url === `${B}/merci?session_id={CHECKOUT_SESSION_ID}` && b.cancel_url === `${B}/boutique`, `${b.success_url} ${b.cancel_url}`)
    check(b['metadata[cms_entry]'] === ids.panel && b['metadata[cms_collection]'] === 'products' && b['payment_intent_data[metadata][cms_entry]'] === ids.panel, 'métadonnées')
    check(b['shipping_address_collection[allowed_countries][0]'] === 'FR' && b['shipping_address_collection[allowed_countries][1]'] === 'BE', 'livraison')
    check(!Object.keys(b).some(k => k.startsWith('payment_method_types')), 'payment_method_types envoyé')
  })

  await step('montant envoyé par le navigateur ignoré : le serveur relit le prix publié', async () => {
    const r = await buy(ids.panel, { quantity: 1, price: 0.01, amount: 1, unit_amount: 1, currency: 'jpy', returnPath: 'https://pirate.example/' })
    check(r.status === 200 && r.json.url.endsWith('/cs_test_session0002'), `${r.status} ${r.text}`)
    const b = sessionCalls()[1].body
    check(b['line_items[0][price_data][unit_amount]'] === '4990' && b['line_items[0][quantity]'] === '1' && b['line_items[0][price_data][currency]'] === 'eur', JSON.stringify(b))
    // Une adresse de retour vers un autre site est remplacée par l'accueil.
    check(b.cancel_url === `${B}/`, 'retour : ' + b.cancel_url)
  })

  await step('refus : brouillon, sans prix, hors vente, supprimé, inconnu, non vendable, quantité absurde', async () => {
    const before = sessionCalls().length
    const cases = [
      [ids.draft, {}, 404, 'Ce produit n\'existe pas ou n\'est plus en ligne.'],
      [ids.noPrice, {}, 422, 'Ce produit n\'a pas de prix : il ne peut pas être payé en ligne.'],
      [ids.off, {}, 422, 'Ce produit n\'est pas en vente pour le moment.'],
      [ids.gone, {}, 404, 'Ce produit n\'existe pas ou n\'est plus en ligne.'],
      ['inconnu', {}, 404, 'Ce produit n\'existe pas ou n\'est plus en ligne.'],
      [ids.panel, { collection: 'services' }, 404, 'Ce type de contenu n\'est pas en vente.'],
      [ids.panel, { collection: 'constructor' }, 404, 'Ce type de contenu n\'est pas en vente.'],
      ...[0, 6, 1.5, -1, '2', 1e9, null].map(quantity => [ids.panel, { quantity }, 422, 'La quantité doit être un nombre entier entre 1 et 5.']),
    ]
    for (const [id, extra, status, message] of cases) {
      const r = await buy(id, extra)
      check(r.status === status && r.json?.message === message, `${id} ${JSON.stringify(extra)} → ${r.status} ${r.text.slice(0, 200)}`)
    }
    check(sessionCalls().length === before, 'Stripe appelé pour une demande refusée')
  })

  // Session terminée telle que Stripe l'envoie, d'après la vraie demande faite par le site.
  const session = (n, extra = {}) => {
    const sent = sessionCalls()[n - 1].body
    const metadata = Object.fromEntries(Object.entries(sent).filter(([k]) => k.startsWith('metadata[')).map(([k, v]) => [k.slice(9, -1), v]))
    return {
      id: `cs_test_session000${n}`, object: 'checkout.session', mode: 'payment', livemode: false, currency: 'eur', status: 'complete', payment_status: 'paid',
      amount_total: Number(sent['line_items[0][price_data][unit_amount]']) * Number(sent['line_items[0][quantity]']), payment_intent: `pi_test_${n}`,
      customer_details: { email: 'jeanne@example.com', name: 'Jeanne Martin' },
      collected_information: { shipping_details: { name: 'Jeanne Martin', address: { line1: '12 rue des Lilas', line2: null, postal_code: '75011', city: 'Paris', state: null, country: 'FR' } } },
      metadata, ...extra,
    }
  }
  const evt = (id, type, object) => ({ id, object: 'event', type, livemode: false, created: Math.floor(Date.now() / 1000), data: { object } })
  const payments = async () => (await claire.json('/api/cms/payments')).payments

  await step('webhook mal signé, trop vieux ou sans signature : refusé, rien d\'enregistré', async () => {
    const event = evt('evt_1', 'checkout.session.completed', session(1))
    const forged = await hook(event, { secret: 'whsec_pas-le-bon' })
    check(forged.status === 400 && /signature invalide/.test(forged.json.message), `${forged.status} ${forged.text}`)
    const old = await hook(event, { at: Math.floor(Date.now() / 1000) - 600 })
    check(old.status === 400 && /trop ancien/.test(old.json.message), `${old.status} ${old.text}`)
    const bare = await stripe.call('/api/stripe/webhook', { method: 'POST', body: JSON.stringify(event), headers: { 'content-type': 'application/json' } })
    check(bare.status === 400, 'sans signature : ' + bare.status)
    // Corps modifié après signature.
    const { signature } = signed(event)
    const tampered = await stripe.call('/api/stripe/webhook', { method: 'POST', body: JSON.stringify({ ...event, data: { object: { ...event.data.object, amount_total: 1 } } }), headers: { 'stripe-signature': signature } })
    check(tampered.status === 400, 'corps modifié : ' + tampered.status)
    check((await payments()).length === 0, 'un paiement a été enregistré')
  })

  await step('page de succès avant la confirmation de Stripe : « en cours de confirmation », jamais « confirmé »', async () => {
    const context = await t.newContext(); const site = await t.newPage({ context })
    await site.goto(B + '/merci?session_id=cs_test_session0001', { waitUntil: 'networkidle0' })
    await says(site, 'Votre paiement est en cours de confirmation')
    check(!(await site.evaluate(() => document.body.innerText)).includes('confirmé.'), 'paiement annoncé confirmé')
    check((await visitor.get('/api/stripe/sessions/pas-une-session')).status === 404, 'identifiant invalide accepté')
    await context.close()
  })

  await step('webhook signé : paiement enregistré, workflow « paiement reçu » déclenché avec ses variables', async () => {
    await claire.json('/api/cms/workflows', { method: 'POST', body: { name: 'Prévenir à chaque vente', trigger: { event: 'payment.succeeded', types: ['products'] }, actions: [{ kind: 'webhook', url: `${M}/vente` }] } })
    const r = await hook(evt('evt_1', 'checkout.session.completed', session(1)))
    check(r.status === 200 && r.json.result === 'enregistré (paid)', `${r.status} ${r.text}`)
    const [p] = await payments()
    check(p.status === 'paid' && p.title === 'Panneau acoustique' && p.quantity === 2 && p.unitAmount === 4990 && p.amount === 9980 && p.currency === 'eur', JSON.stringify(p))
    check(p.email === 'jeanne@example.com' && p.shipping.city === 'Paris' && p.livemode === false && p.paymentIntent === 'pi_test_1' && p.entryId === ids.panel, JSON.stringify(p))
    const sent = await until(() => calls().find(c => c.url === '/vente'), 'appel du workflow')
    const v = sent.body.payment
    check(v.product === 'Panneau acoustique' && v.quantity === '2' && v.amount.replace(/\s/g, ' ') === '99,80 €' && v.email === 'jeanne@example.com' && v.mode === 'test', JSON.stringify(v))
    check(v.shipping === 'Jeanne Martin\n12 rue des Lilas\n75011 Paris\nFR' && v.adminUrl === `${B}/admin/payments?payment=${p.id}` && v.reference === 'pi_test_1', JSON.stringify(v))
    const run = await until(async () => (await claire.json('/api/cms/workflow-runs')).find(x => x.event === 'payment.succeeded'), 'journal')
    check(run.status === 'success' && run.summary.startsWith('Un paiement est reçu : « Panneau acoustique » × 2'), JSON.stringify(run))
  })

  await step('même événement reçu deux fois : un seul paiement, un seul déclenchement', async () => {
    const again = await hook(evt('evt_1', 'checkout.session.completed', session(1)))
    check(again.status === 200 && again.json.result === 'déjà enregistré', again.text)
    // Le même paiement annoncé par un autre événement (paiement différé réussi) ne compte pas non plus.
    const other = await hook(evt('evt_1b', 'checkout.session.async_payment_succeeded', session(1)))
    check(other.json.result === 'déjà enregistré', other.text)
    await wait(1000)
    check((await payments()).length === 1, 'paiement en double')
    check(calls().filter(c => c.url === '/vente').length === 1, 'workflow déclenché deux fois')
  })

  await step('paiement différé : en attente, puis échoué ; un échec ne redevient pas un succès', async () => {
    const pending = await hook(evt('evt_2', 'checkout.session.completed', session(2, { payment_status: 'unpaid' })))
    check(pending.json.result === 'enregistré (pending)', pending.text)
    check((await visitor.get('/api/stripe/sessions/cs_test_session0002')).json.status === 'pending', 'état public')
    const failed = await hook(evt('evt_3', 'checkout.session.async_payment_failed', session(2, { payment_status: 'unpaid' })))
    check(failed.json.result === 'mis à jour (failed)', failed.text)
    const late = await hook(evt('evt_4', 'checkout.session.async_payment_succeeded', session(2)))
    check(late.json.result === 'déjà enregistré', late.text)
    check((await payments()).find(p => p.sessionId === 'cs_test_session0002').status === 'failed', 'statut')
    check(calls().filter(c => c.url === '/vente').length === 1, 'un échec a déclenché « paiement reçu »')
    // Un événement d'une vente faite ailleurs avec le même compte Stripe est ignoré.
    const foreign = await hook(evt('evt_5', 'checkout.session.completed', { ...session(1), id: 'cs_test_autre_vente', metadata: {} }))
    check(foreign.status === 200 && /ignoré/.test(foreign.json.result) && (await payments()).length === 2, foreign.text)
  })

  await step('page de succès après confirmation : « confirmé », montant et produit', async () => {
    const context = await t.newContext(); const site = await t.newPage({ context })
    await site.goto(B + '/merci?session_id=cs_test_session0001', { waitUntil: 'networkidle0' })
    await says(site, 'pour « Panneau acoustique » est confirmé.')
    // Le montant est mis en forme à la française (espace insécable avant €).
    check((await site.evaluate(() => document.body.innerText)).replace(/\s/g, ' ').includes('Votre paiement de 99,80 € pour'), 'montant')
    const r = await visitor.get('/api/stripe/sessions/cs_test_session0001')
    check(!r.text.includes('jeanne') && !r.text.includes('Paris'), 'données personnelles sur la route publique : ' + r.text)
    await context.close()
  })

  await step('écran « Paiements » : liste, test distingué de la production, détail, lien vers Stripe', async () => {
    await page.goto(B + '/admin/payments', { waitUntil: 'domcontentloaded' })
    await says(page, 'Paiements de test : aucun argent n\'a circulé.')
    await page.waitForSelector('main li button')
    const rows = await page.$$eval('main li button', els => els.map(e => e.innerText.replace(/\s+/g, ' ')))
    check(rows.length === 2 && rows.some(r => r.includes('Panneau acoustique × 2') && r.includes('99,80') && r.includes('Payé')) && rows.some(r => r.includes('Échoué')), rows.join(' | '))
    await clickText(page, 'main li button', 'Payé')
    const detail = await page.$eval('[data-detail]', a => a.innerText)
    check(detail.includes('Jeanne Martin · jeanne@example.com') && detail.includes('12 rue des Lilas') && detail.includes('Test') && detail.includes('2 × 49,90'), detail)
    check(await page.$eval('[data-detail] a.btn-primary', a => a.href) === 'https://dashboard.stripe.com/test/payments/pi_test_1', 'lien Stripe')
    await t.shot(page, 'paiements-detail')
    // Largeur de téléphone : la liste puis le détail, l'un sous l'autre.
    await page.setViewport({ width: 390, height: 1400 }); await wait(300)
    await t.shot(page, 'paiements-telephone')
    await page.setViewport({ width: 1400, height: 1100 })
    await clickText(page, 'main [role=tab]', 'Vrais paiements'); await says(page, 'Aucun paiement pour l\'instant.')
  })
  await t.shot(page, 'paiements')
  await step('remboursement fait dans Stripe : le paiement passe à « Remboursé »', async () => {
    const r = await hook(evt('evt_6', 'charge.refunded', { id: 'ch_1', object: 'charge', payment_intent: 'pi_test_1', amount: 9980, amount_refunded: 9980 }))
    check(r.json.result === 'remboursement enregistré (9980)', r.text)
    const p = (await payments()).find(x => x.paymentIntent === 'pi_test_1')
    check(p.status === 'refunded' && p.refundedAmount === 9980, JSON.stringify(p))
  })

  await step('droits : l\'éditeur voit les paiements, pas les réglages ; le rédacteur et le visiteur rien', async () => {
    for (const [who, client] of [[{ name: 'Marc Petit', email: 'marc@example.com', role: 'editor' }, marc], [{ name: 'Lina Roux', email: 'lina@example.com', role: 'writer' }, lina]]) {
      const { link } = await claire.json('/api/cms/users', { method: 'POST', body: who })
      await visitor.post(link.replace(/^.*\/admin\/invite\//, '/api/cms/invite/'), { password: 'motdepasse-test-2' })
      check((await client.signIn(who.email, 'motdepasse-test-2')).status === 200, 'connexion refusée pour ' + who.name)
    }
    const codes = async client => (await Promise.all(['/api/cms/payments', '/api/cms/modules/stripe'].map(u => client.get(u)))).map(r => r.status).join()
    check(await codes(marc) === '200,403', 'éditeur : ' + await codes(marc))
    check(await codes(lina) === '403,403', 'rédacteur : ' + await codes(lina))
    check(await codes(visitor) === '401,401', 'visiteur : ' + await codes(visitor))
    check((await marc.call('/api/cms/modules/stripe', { method: 'PUT', body: { secrets: { secretKey: 'sk_live_x' } } })).status === 403, 'l\'éditeur change la clé')
    check((await marc.call('/api/cms/modules/stripe/test', { method: 'POST', body: {} })).status === 403, 'l\'éditeur vérifie la clé')
    const context = await t.newContext(); const writer = await t.newPage({ context })
    await login(writer, B, { email: 'lina@example.com', password: 'motdepasse-test-2' })
    check(!(await menuLabels(writer)).includes('Paiements'), 'le rédacteur voit « Paiements » dans le menu')
    await context.close()
  })

  await step('créations de paiement répétées : limitées par visiteur', async () => {
    const statuses = []
    for (let i = 0; i < 10; i++) statuses.push((await buy(ids.panel)).status)
    const refused = statuses.indexOf(429)
    // Deux sessions déjà créées par ce visiteur (adresse IP) : la limite de 10 est atteinte à la 9e.
    check(refused >= 6 && refused <= 9 && statuses.slice(refused).every(s => s === 429) && statuses.slice(0, refused).every(s => s === 200), statuses.join())
    check(/Trop de tentatives de paiement\. Réessayez dans \d+ minutes?\./.test((await buy(ids.panel)).json.message), 'message')
  })
}
