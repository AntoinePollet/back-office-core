// Stripe étendu : code promo et facture PDF d'un achat, stock qui diminue à chaque vente, abonnements (souscription,
// échéances suivantes, prélèvement en échec, résiliation), écran « Paiements », page du site.
import { createHmac } from 'node:crypto'
import { check, clickText, login, says, until } from '../lib/harness.mjs'

export const meta = {
  title: 'Stripe étendu : codes promo, factures, stock, abonnements',
  mock: true,
  env: ({ mock }) => ({ NUXT_STRIPE_API_URL: `${mock}/stripe` }),
}

const KEY = 'rk_test_cle-limitee-du-site-4242'
const WHSEC = 'whsec_secret-du-webhook-de-test'

export default async function (t) {
  const { B, M, step, calls } = t
  const page = await t.newPage()
  const claire = t.http(), marc = t.http(), lina = t.http(), visitor = t.http(), stripe = t.http()
  const sessionCalls = () => calls().filter(c => c.url === '/stripe/v1/checkout/sessions')
  const hook = (type, object, id = `evt_${Math.random().toString(36).slice(2)}`) => {
    const body = JSON.stringify({ id, object: 'event', type, livemode: false, data: { object } }), now = Math.floor(Date.now() / 1000)
    return stripe.call('/api/stripe/webhook', { method: 'POST', body, headers: { 'content-type': 'application/json', 'stripe-signature': `t=${now},v1=${createHmac('sha256', WHSEC).update(`${now}.${body}`).digest('hex')}` } })
  }
  let ip = 20
  const buy = (collection, id, extra = {}) => visitor.call('/api/stripe/checkout', { method: 'POST', headers: { 'cf-connecting-ip': `203.0.113.${ip}`, 'x-forwarded-for': `203.0.113.${ip++}` }, body: { collection, id, quantity: 1, ...extra } })
  /** La session terminée telle que Stripe l'annonce, d'après la demande réellement faite par le site. */
  const session = (n, extra = {}) => {
    const sent = sessionCalls()[n - 1].body
    const metadata = Object.fromEntries(Object.entries(sent).filter(([k]) => k.startsWith('metadata[')).map(([k, v]) => [k.slice(9, -1), v]))
    return {
      id: `cs_test_session000${n}`, object: 'checkout.session', mode: sent.mode, livemode: false, currency: 'eur', status: 'complete', payment_status: 'paid',
      amount_total: Number(sent['line_items[0][price_data][unit_amount]']) * Number(sent['line_items[0][quantity]']), payment_intent: sent.mode === 'payment' ? `pi_test_${n}` : null,
      customer_details: { email: 'jeanne@example.com', name: 'Jeanne Martin' }, metadata, ...extra,
    }
  }
  const data = async (client = claire) => client.json('/api/cms/payments')
  const stockOf = async id => [(await visitor.json('/api/content/products'))].flatMap(r => r.items ?? r).find(p => p.id === id)?.stock
  const ids = {}

  await step('préparation : produits avec et sans stock, offre d\'abonnement, module réglé, comptes', async () => {
    await login(page, B)
    check((await claire.signIn(t.admin.email, t.admin.password)).status === 200, 'connexion refusée')
    const create = async (type, values) => (await claire.json(`/api/cms/entries/${type}`, { method: 'POST', body: { values, publish: ['fr'] } })).id
    ids.panel = await create('products', { title: 'Panneau acoustique', price: 10, onSale: true, stock: 2 })
    ids.guide = await create('products', { title: 'Guide pratique', price: 15, onSale: true })
    ids.plan = await create('plans', { title: 'Veille juridique', description: 'Une note par mois.', price: 29 })
    await claire.json('/api/cms/modules/stripe', { method: 'PUT', body: { secrets: { secretKey: KEY, webhookSecret: WHSEC } } })
    for (const [who, client] of [[{ name: 'Marc Petit', email: 'marc@example.com', role: 'editor' }, marc], [{ name: 'Lina Roux', email: 'lina@example.com', role: 'writer' }, lina]]) {
      const { link } = await claire.json('/api/cms/users', { method: 'POST', body: who })
      await visitor.post(link.replace(/^.*\/admin\/invite\//, '/api/cms/invite/'), { password: 'motdepasse-test-2' })
      check((await client.signIn(who.email, 'motdepasse-test-2')).status === 200, 'connexion refusée pour ' + who.name)
    }
    // Les événements d'abonnement font partie de ceux à cocher dans Stripe.
    const details = (await claire.json('/api/cms/modules/stripe')).details.find(d => d.label === 'Événements à cocher').value
    check(details.includes('invoice.paid') && details.includes('customer.subscription.deleted'), details)
  })

  await step('achat en une fois : champ « Code promo » et facture demandés à Stripe', async () => {
    const r = await buy('products', ids.guide)
    check(r.status === 200 && r.json.url.endsWith('cs_test_session0001'), `${r.status} ${r.text}`)
    const sent = sessionCalls()[0].body
    check(sent.mode === 'payment' && sent.allow_promotion_codes === 'true' && sent['invoice_creation[enabled]'] === 'true' && sent['payment_intent_data[metadata][cms_entry]'] === ids.guide, JSON.stringify(sent))
    check(!('line_items[0][price_data][recurring][interval]' in sent) && !Object.keys(sent).some(k => k.startsWith('subscription_data')), 'réglages d\'abonnement sur un achat en une fois')
  })

  await step('code promo et facture : remise relevée, PDF de la facture ouvert depuis le back-office, droits', async () => {
    // Le visiteur a saisi un code promo de 20 % : Stripe annonce le montant payé et la remise.
    const r = await hook('checkout.session.completed', session(1, { amount_total: 1200, total_details: { amount_discount: 300 }, invoice: 'in_guide_1' }))
    check(r.status === 200 && r.json.result === 'enregistré (paid)', `${r.status} ${r.text}`)
    const [p] = (await data()).payments
    check(p.amount === 1200 && p.discountAmount === 300 && p.unitAmount === 1500 && p.invoice === 'in_guide_1' && p.subscription === null, JSON.stringify(p))
    ids.guidePayment = p.id
    const pdf = await claire.get(`/api/cms/payments/${p.id}/invoice`)
    check(pdf.status === 302 && pdf.headers.get('location') === `${M}/stripe/pdf/in_guide_1.pdf`, `${pdf.status} ${pdf.headers.get('location')}`)
    check(calls().some(c => c.url === '/stripe/v1/invoices/in_guide_1' && c.key === KEY), 'facture non demandée à Stripe')
    const codes = [(await marc.get(`/api/cms/payments/${p.id}/invoice`)).status, (await lina.get(`/api/cms/payments/${p.id}/invoice`)).status, (await visitor.get(`/api/cms/payments/${p.id}/invoice`)).status, (await claire.get('/api/cms/payments/inconnu/invoice')).status]
    check(codes.join() === '302,403,401,404', codes.join())
    // Une clé limitée sans le droit « Invoices » : le refus est expliqué.
    await claire.json('/api/cms/modules/stripe', { method: 'PUT', body: { secrets: { secretKey: 'rk_test_sans-factures' } } })
    const refused = await claire.get(`/api/cms/payments/${p.id}/invoice`)
    check(refused.status === 502 && /« Lecture » sur « Invoices »/.test(refused.json.message), `${refused.status} ${refused.text}`)
    await claire.json('/api/cms/modules/stripe', { method: 'PUT', body: { secrets: { secretKey: KEY } } })
  })

  await step('stock : achat refusé au-delà, diminué par le paiement (brouillon et version en ligne), produit épuisé', async () => {
    await claire.json('/api/cms/workflows', { method: 'POST', body: { name: 'Prévenir quand un produit est épuisé', trigger: { event: 'product.out_of_stock', types: ['products'] }, actions: [{ kind: 'webhook', url: `${M}/epuise` }] } })
    const before = sessionCalls().length
    const many = await buy('products', ids.panel, { quantity: 3 })
    check(many.status === 409 && many.json.message === 'Il n\'en reste que 2.' && sessionCalls().length === before, `${many.status} ${many.text}`)
    const two = await buy('products', ids.panel, { quantity: 2 })
    check(two.status === 200, two.text)
    // Tant que Stripe n'a rien confirmé, le stock ne bouge pas.
    check(await stockOf(ids.panel) === 2, 'stock diminué avant le paiement')
    const paid = await hook('checkout.session.completed', session(2), 'evt_panneau')
    check(paid.json.result === 'enregistré (paid)', paid.text)
    await until(async () => await stockOf(ids.panel) === 0, 'stock de la version en ligne')
    check((await claire.json(`/api/cms/entries/products/${ids.panel}`)).shared.stock === 0, 'stock du brouillon')
    // Le même événement reçu deux fois ne diminue le stock qu'une fois ; un produit sans stock suivi reste illimité.
    check((await hook('checkout.session.completed', session(2), 'evt_panneau')).json.result === 'déjà enregistré', 'événement rejoué traité')
    check(await stockOf(ids.guide) === null && await stockOf(ids.panel) === 0, 'stock d\'un autre produit touché')
    const out = await buy('products', ids.panel)
    check(out.status === 409 && out.json.message === 'Ce produit est épuisé.', `${out.status} ${out.text}`)
    const sent = await until(() => calls().find(c => c.url === '/epuise'), 'workflow « produit épuisé »')
    check(sent.body.product.title === 'Panneau acoustique' && sent.body.product.adminUrl === `${B}/admin/products/${ids.panel}`, JSON.stringify(sent.body))
    // Réapprovisionné dans le back-office : de nouveau en vente.
    await claire.json(`/api/cms/entries/products/${ids.panel}`, { method: 'PUT', body: { values: { stock: 5 }, publish: ['fr'] } })
    check((await buy('products', ids.panel)).status === 200, 'achat refusé après réapprovisionnement')
  })

  await step('abonnement : page de paiement en mode abonnement, périodicité et métadonnées portées par l\'abonnement', async () => {
    const before = sessionCalls().length
    const r = await buy('plans', ids.plan)
    check(r.status === 200, `${r.status} ${r.text}`)
    ids.planSession = before + 1
    const sent = sessionCalls()[before].body
    check(sent.mode === 'subscription' && sent['line_items[0][price_data][recurring][interval]'] === 'month' && sent['line_items[0][price_data][unit_amount]'] === '2900', JSON.stringify(sent))
    check(sent['subscription_data[metadata][cms_entry]'] === ids.plan && sent['metadata[cms_interval]'] === 'month' && sent.allow_promotion_codes === 'true', JSON.stringify(sent))
    // Stripe refuse ces réglages en mode abonnement.
    check(!('invoice_creation[enabled]' in sent) && !Object.keys(sent).some(k => k.startsWith('payment_intent_data')), 'réglages de paiement isolé sur un abonnement')
    check((await buy('plans', ids.plan, { quantity: 2 })).status === 422, 'deux abonnements d\'un coup acceptés')
  })

  await step('souscription confirmée : premier paiement, abonnement en cours, workflow ; la première facture ne compte pas deux fois', async () => {
    await claire.json('/api/cms/workflows', { method: 'POST', body: { name: 'Nouvel abonné', trigger: { event: 'subscription.started' }, actions: [{ kind: 'webhook', url: `${M}/abonne` }] } })
    await claire.json('/api/cms/workflows', { method: 'POST', body: { name: 'Prélèvement en échec', trigger: { event: 'subscription.payment_failed' }, actions: [{ kind: 'webhook', url: `${M}/echec-prelevement` }] } })
    await claire.json('/api/cms/workflows', { method: 'POST', body: { name: 'Fin d\'abonnement', trigger: { event: 'subscription.canceled' }, actions: [{ kind: 'webhook', url: `${M}/fin-abonnement` }] } })
    const r = await hook('checkout.session.completed', session(ids.planSession, { subscription: 'sub_veille_1', invoice: 'in_veille_1' }), 'evt_souscription')
    check(r.json.result === 'enregistré (paid)', r.text)
    let d = await data()
    const first = d.payments.find(p => p.subscription === 'sub_veille_1')
    check(first.amount === 2900 && first.title === 'Veille juridique' && first.collection === 'plans' && first.invoice === 'in_veille_1', JSON.stringify(first))
    const [sub] = d.subscriptions
    check(d.subscriptions.length === 1 && sub.subscriptionId === 'sub_veille_1' && sub.status === 'active' && sub.amount === 2900 && sub.interval === 'month' && sub.email === 'jeanne@example.com' && sub.title === 'Veille juridique' && sub.cancelAtPeriodEnd === false, JSON.stringify(sub))
    ids.sub = sub.id
    const sent = await until(() => calls().find(c => c.url === '/abonne'), 'workflow « abonnement souscrit »')
    const v = sent.body.subscription
    check(v.offer === 'Veille juridique' && v.amount.replace(/\s/g, ' ') === '29,00 €' && v.interval === 'par mois' && v.email === 'jeanne@example.com' && v.reference === 'sub_veille_1' && v.adminUrl === `${B}/admin/payments?subscription=${sub.id}`, JSON.stringify(v))
    // Stripe annonce aussi la première facture : elle est déjà comptée.
    const invoice = { id: 'in_veille_1', object: 'invoice', subscription: 'sub_veille_1', billing_reason: 'subscription_create', amount_paid: 2900, currency: 'eur', customer_email: 'jeanne@example.com', livemode: false, lines: { data: [{ period: { end: 1_900_000_000 } }] } }
    check(/première échéance/.test((await hook('invoice.paid', invoice)).json.result), 'première facture mal reconnue')
    check((await hook('checkout.session.completed', session(ids.planSession, { subscription: 'sub_veille_1', invoice: 'in_veille_1' }), 'evt_souscription')).json.result === 'déjà enregistré', 'souscription rejouée')
    d = await data()
    check(d.payments.filter(p => p.subscription === 'sub_veille_1').length === 1 && d.subscriptions.length === 1 && calls().filter(c => c.url === '/abonne').length === 1, 'souscription comptée deux fois')
    check(new Date(d.subscriptions[0].currentPeriodEnd).getTime() === 1_900_000_000_000, 'date de la prochaine échéance')
  })

  await step('échéance suivante : un nouveau paiement, une seule fois ; facture d\'un abonnement inconnu ignorée', async () => {
    const cycle = { id: 'in_veille_2', object: 'invoice', parent: { subscription_details: { subscription: 'sub_veille_1' } }, billing_reason: 'subscription_cycle', amount_paid: 2900, currency: 'eur', customer_email: 'jeanne@example.com', customer_name: 'Jeanne Martin', payment_intent: 'pi_veille_2', livemode: false, lines: { data: [{ period: { end: 1_902_600_000 } }] } }
    const r = await hook('invoice.paid', cycle)
    check(r.json.result === 'échéance enregistrée (paid)', r.text)
    check((await hook('invoice.paid', cycle)).json.result === 'déjà enregistré', 'échéance rejouée')
    const d = await data()
    const renewals = d.payments.filter(p => p.subscription === 'sub_veille_1')
    const second = renewals.find(p => p.sessionId === 'in_veille_2')
    check(renewals.length === 2 && second.amount === 2900 && second.status === 'paid' && second.invoice === 'in_veille_2' && second.title === 'Veille juridique' && second.paymentIntent === 'pi_veille_2' && second.email === 'jeanne@example.com', JSON.stringify(second))
    check(new Date(d.subscriptions[0].currentPeriodEnd).getTime() === 1_902_600_000_000, 'échéance non repoussée')
    check(/abonnement inconnu/.test((await hook('invoice.paid', { ...cycle, id: 'in_autre', parent: { subscription_details: { subscription: 'sub_autre_site' } } })).json.result), 'facture d\'un autre site enregistrée')
    check(/sans abonnement/.test((await hook('invoice.paid', { id: 'in_seule', amount_paid: 100 })).json.result), 'facture sans abonnement enregistrée')
  })

  await step('prélèvement en échec : abonnement en retard, workflow ; paiement régularisé : de nouveau en cours', async () => {
    const failed = { id: 'in_veille_3', object: 'invoice', subscription: 'sub_veille_1', billing_reason: 'subscription_cycle', amount_paid: 0, currency: 'eur', livemode: false }
    check((await hook('invoice.payment_failed', failed)).json.result === 'abonnement en retard de paiement', 'échec non enregistré')
    check((await data()).subscriptions[0].status === 'past_due', 'état de l\'abonnement')
    const sent = await until(() => calls().find(c => c.url === '/echec-prelevement'), 'workflow « prélèvement en échec »')
    check(sent.body.subscription.email === 'jeanne@example.com', JSON.stringify(sent.body))
    check((await hook('invoice.payment_failed', failed)).json.result === 'déjà enregistré' && calls().filter(c => c.url === '/echec-prelevement').length === 1, 'échec compté deux fois')
    await hook('invoice.paid', { ...failed, amount_paid: 2900, payment_intent: 'pi_veille_3', lines: { data: [{ period: { end: 1_905_200_000 } }] } })
    const d = await data()
    check(d.subscriptions[0].status === 'active' && d.payments.filter(p => p.subscription === 'sub_veille_1').length === 3, 'abonnement non régularisé')
  })

  await step('résiliation à l\'échéance par l\'administrateur seulement ; fin annoncée par Stripe ; un abonnement résilié le reste', async () => {
    const cancel = client => client.call(`/api/cms/subscriptions/${ids.sub}/cancel`, { method: 'POST' })
    check((await cancel(marc)).status === 403 && (await cancel(lina)).status === 403 && (await cancel(visitor)).status === 401, 'résiliation par qui n\'y a pas droit')
    // Clé limitée sans le droit « Subscriptions » : refus expliqué, rien n'est changé.
    await claire.json('/api/cms/modules/stripe', { method: 'PUT', body: { secrets: { secretKey: 'rk_test_sans-factures' } } })
    const refused = await cancel(claire)
    check(refused.status === 502 && /« Écriture » sur « Subscriptions »/.test(refused.json.message) && (await data()).subscriptions[0].cancelAtPeriodEnd === false, `${refused.status} ${refused.text}`)
    await claire.json('/api/cms/modules/stripe', { method: 'PUT', body: { secrets: { secretKey: KEY } } })
    const done = await cancel(claire)
    check(done.status === 200 && done.json.cancelAtPeriodEnd === true && done.json.status === 'active', done.text)
    const sent = calls().filter(c => c.url === '/stripe/v1/subscriptions/sub_veille_1').pop()
    check(sent.key === KEY && sent.body.cancel_at_period_end === 'true', JSON.stringify(sent))
    // Demandée deux fois : Stripe n'est pas rappelé.
    const count = calls().filter(c => c.url === '/stripe/v1/subscriptions/sub_veille_1').length
    check((await cancel(claire)).status === 200 && calls().filter(c => c.url === '/stripe/v1/subscriptions/sub_veille_1').length === count, 'Stripe rappelé pour une résiliation déjà demandée')
    check(JSON.stringify(await claire.json('/api/cms/activity')).includes('a demandé la résiliation de l\'abonnement « Veille juridique »'), 'journal d\'activité')
    check((await hook('customer.subscription.updated', { id: 'sub_veille_1', status: 'active', cancel_at_period_end: true, items: { data: [{ current_period_end: 1_905_200_000 }] } })).json.result === 'abonnement mis à jour (active, résiliation demandée)', 'mise à jour')
    check(!calls().some(c => c.url === '/fin-abonnement'), 'fin annoncée avant l\'heure')
    const ended = await hook('customer.subscription.deleted', { id: 'sub_veille_1', status: 'canceled', canceled_at: 1_905_200_000 })
    check(ended.json.result === 'abonnement mis à jour (canceled)', ended.text)
    const [sub] = (await data()).subscriptions
    check(sub.status === 'canceled' && sub.cancelAtPeriodEnd === false && new Date(sub.canceledAt).getTime() === 1_905_200_000_000, JSON.stringify(sub))
    await until(() => calls().some(c => c.url === '/fin-abonnement'), 'workflow « fin d\'abonnement »')
    check((await hook('customer.subscription.updated', { id: 'sub_veille_1', status: 'active' })).json.result === 'déjà résilié' && (await cancel(claire)).status === 409, 'abonnement résilié rouvert')
    check(/abonnement inconnu/.test((await hook('customer.subscription.deleted', { id: 'sub_autre_site', status: 'canceled' })).json.result), 'abonnement d\'un autre site')
  })

  await step('écran « Paiements » : abonnements, remise et facture d\'un paiement ; site : produit épuisé, bouton « S\'abonner »', async () => {
    // Un second abonnement, en cours, pour le bouton « Résilier ».
    await buy('plans', ids.plan)
    await hook('checkout.session.completed', session(sessionCalls().length, { subscription: 'sub_veille_2', invoice: 'in_veille_b', customer_details: { email: 'paul@example.com', name: 'Paul Tardif' } }))
    await page.goto(`${B}/admin/payments?payment=${ids.guidePayment}`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('[data-subscriptions]')
    const rows = await page.$$eval('[data-subscription]', trs => trs.map(tr => `${tr.dataset.subscription}:${tr.dataset.status}:${!!tr.querySelector('[data-subscription-cancel]')}`))
    check(rows.join() === 'sub_veille_2:active:true,sub_veille_1:canceled:false', rows.join())
    await says(page, 'par mois')
    check((await page.$eval('[data-detail-discount]', el => el.textContent)).replace(/\s/g, ' ') === '3,00 €', 'remise absente du détail')
    check((await page.$eval('[data-detail-invoice]', el => el.getAttribute('href'))) === `/api/cms/payments/${ids.guidePayment}/invoice`, 'bouton de facture')
    // La question de confirmation est acceptée par le lanceur.
    await page.click('[data-subscription-cancel]')
    await says(page, 'Résiliation demandée à Stripe')
    await page.waitForSelector('[data-subscription="sub_veille_2"] [data-subscription-ending]')
    check(!(await page.$('[data-subscription="sub_veille_2"] [data-subscription-cancel]')), 'bouton « Résilier » encore affiché')
    await page.setViewport({ width: 390, height: 800 })
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'l\'écran déborde sur téléphone')
    await page.setViewport({ width: 1280, height: 900 })

    await claire.json(`/api/cms/entries/products/${ids.panel}`, { method: 'PUT', body: { values: { stock: 0 }, publish: ['fr'] } })
    const site = await t.newPage({ context: await t.newContext() })
    await site.goto(B + '/boutique', { waitUntil: 'networkidle0' })
    check(await site.$eval('[data-product="Panneau acoustique"]', el => !!el.querySelector('[data-product-out]') && !el.querySelector('button')), 'produit épuisé encore achetable')
    const before = sessionCalls().length
    await Promise.all([site.waitForNavigation(), clickText(site, '[data-plan="Veille juridique"] button', 'S\'abonner')])
    check(site.url() === `${M}/stripe/checkout/cs_test_session000${before + 1}` && sessionCalls()[before].body.mode === 'subscription', site.url())
    await site.close()
  })
}
