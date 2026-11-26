import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { test } from 'node:test'
import { collection, defineCms, f, singleton } from './format.ts'
import {
  STATUS_FROM, checkQuantity, checkSellable, checkStock, checkoutParams, dashboardUrl, encodeForm, formatAmount, formatShipping, invoiceFromObject, keyMode,
  paymentFromSession, subscriptionFromObject, safeReturnPath, sellableCollections, signStripePayload, statusFromEvent, stripe, stripeLocale,
  toMinorUnits, verifyStripeSignature, withSessionId,
} from './stripe.ts'

const site = { name: 'Test', locales: ['fr', 'en'] as const, defaultLocale: 'fr' }
const products = collection({
  label: 'Produits', titleField: 'title',
  fields: {
    title: f.text({ label: 'Nom', required: true }),
    label: f.text({ label: 'Nom commercial' }),
    price: f.number({ label: 'Prix', min: 0 }),
    localPrice: f.number({ label: 'Prix local', localized: true }),
    image: f.image({ label: 'Photo' }),
    onSale: f.boolean({ label: 'En vente' }),
    note: f.textarea({ label: 'Note' }),
  },
})
const config = (s: ReturnType<typeof stripe>) => defineCms({ site, collections: { products }, singletons: { home: singleton({ label: 'Accueil', fields: { t: f.text({ label: 'T' }) } }) }, modules: [s] })

test('stripe() : déclaration valide, valeurs par défaut, et la vérification ne reste pas dans la configuration publiée', () => {
  const cfg = config(stripe({ collections: { products: { price: 'price', name: 'label', image: 'image', available: 'onSale' } } }))
  const mod = cfg.modules[0]!
  assert.equal(mod.id, 'stripe')
  assert.deepEqual(mod.options, { collections: { products: { price: 'price', name: 'label', image: 'image', available: 'onSale' } }, currency: 'eur', shipping: null, successPath: '/merci', cancelPath: null, promoCodes: false, invoices: false })
  assert.equal('check' in mod, false)
  assert.deepEqual(Object.keys(sellableCollections(cfg)), ['products'])
  assert.deepEqual(sellableCollections({}), {})
})

test('stripe() refuse une déclaration mal écrite, avec un message qui dit où', () => {
  const bad = (s: () => ReturnType<typeof stripe>, re: RegExp) => assert.throws(() => config(s()), re)
  // Sans collection vendable, le module ne sert qu'aux acomptes des rendez-vous : c'est accepté.
  assert.deepEqual(stripe().options.collections, {})
  assert.deepEqual(config(stripe({ collections: {} })).modules[0].options.collections, {})
  bad(() => stripe({ collections: { articles: { price: 'price' } } }), /collections\.articles : la collection « articles » n'existe pas/)
  bad(() => stripe({ collections: { home: { price: 't' } } } as never), /page unique/)
  bad(() => stripe({ collections: { products: { price: 'prix' } } }), /collections\.products\.price : le champ « prix » n'existe pas/)
  bad(() => stripe({ collections: { products: { price: 'title' } } }), /price : le champ « title » doit être un nombre \(f\.number\) \(il est de type text\)/)
  bad(() => stripe({ collections: { products: { price: 'localPrice' } } }), /même dans toutes les langues/)
  bad(() => stripe({ collections: { products: { price: 'price', name: 'note' } } }), /name : .* doit être un texte/)
  bad(() => stripe({ collections: { products: { price: 'price', image: 'title' } } }), /image : .* doit être une image/)
  bad(() => stripe({ collections: { products: { price: 'price', available: 'price' } } }), /available : .* doit être un interrupteur/)
  bad(() => stripe({ collections: { products: { price: 'price', maxQuantity: 0 } } }), /maxQuantity/)
  bad(() => stripe({ collections: { products: { price: 'price', maxQuantity: 1000 } } }), /maxQuantity/)
  bad(() => stripe({ collections: { products: { price: 'price' } }, currency: 'EUR' }), /currency/)
  bad(() => stripe({ collections: { products: { price: 'price' } }, currency: 'kwd' }), /trois décimales/)
  bad(() => stripe({ collections: { products: { price: 'price' } }, shipping: { countries: ['fr'] } }), /shipping\.countries/)
  bad(() => stripe({ collections: { products: { price: 'price' } }, successPath: 'https://ailleurs.example' }), /successPath/)
  bad(() => stripe({ collections: { products: { price: 'price' } }, cancelPath: '//ailleurs.example' }), /cancelPath/)
  // Une collection nommée « payments » prendrait la place de l'écran des paiements.
  assert.throws(() => defineCms({ site, collections: { payments: products } }), /payments : identifiant réservé/)
})

test('prix saisi en euros → centimes pour Stripe, sans erreur d\'arrondi', () => {
  assert.equal(toMinorUnits(149.9, 'eur'), 14990)
  assert.equal(toMinorUnits(19.99, 'eur'), 1999)
  assert.equal(toMinorUnits(0.1 + 0.2, 'eur'), 30)
  assert.equal(toMinorUnits(1, 'eur'), 100)
  assert.equal(toMinorUnits(1500, 'jpy'), 1500)
  for (const v of [null, undefined, '', '12', 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(toMinorUnits(v, 'eur'), null, String(v))
  // Plus de décimales que la devise n'en a : prix mal saisi, pas vendable.
  assert.equal(toMinorUnits(14.999, 'eur'), null)
  assert.equal(toMinorUnits(10.5, 'jpy'), null)
  assert.equal(formatAmount(14990, 'eur').replace(/\s/g, ' '), '149,90 €')
  assert.match(formatAmount(1500, 'jpy').replace(/\s/g, ' '), /^1 500 (JPY|¥|JP¥)$/)
})

test('vendable ou non : prix vide, interrupteur « en vente », quantité', () => {
  const sell = { price: 'price', available: 'onSale', maxQuantity: 5 }
  assert.deepEqual(checkSellable(sell, { price: 49.9, onSale: true }, 'eur'), { ok: true, unitAmount: 4990 })
  assert.equal(checkSellable(sell, { price: 49.9, onSale: false }, 'eur').ok, false)
  assert.match((checkSellable(sell, { price: null, onSale: true }, 'eur') as { reason: string }).reason, /pas de prix/)
  assert.equal(checkSellable({ price: 'price' }, { price: 10 }, 'eur').ok, true)
  assert.equal(checkQuantity(1, sell), null)
  assert.equal(checkQuantity(5, sell), null)
  for (const q of [0, 6, 1.5, -1, '2', null, 1e9]) assert.match(checkQuantity(q, sell)!, /entre 1 et 5/, String(q))
  assert.match(checkQuantity(11, { price: 'p' })!, /entre 1 et 10/)
})

test('requête de création de la session Checkout', () => {
  const metadata = { cms_collection: 'products', cms_entry: 'abc', cms_title: 'Panneau', cms_quantity: '2', cms_unit_amount: '4990', cms_locale: 'fr' }
  const pairs = checkoutParams({
    currency: 'eur', unitAmount: 4990, quantity: 2, name: 'Panneau acoustique', image: 'https://site.fr/media/a.jpg',
    successUrl: withSessionId('https://site.fr/merci'), cancelUrl: 'https://site.fr/boutique', locale: 'fr', metadata, shippingCountries: ['FR', 'BE'],
  })
  const p = Object.fromEntries(pairs)
  assert.equal(p.mode, 'payment')
  assert.equal(p['line_items[0][price_data][unit_amount]'], '4990')
  assert.equal(p['line_items[0][price_data][currency]'], 'eur')
  assert.equal(p['line_items[0][quantity]'], '2')
  assert.equal(p['line_items[0][price_data][product_data][name]'], 'Panneau acoustique')
  assert.equal(p['line_items[0][price_data][product_data][images][0]'], 'https://site.fr/media/a.jpg')
  assert.equal(p.success_url, 'https://site.fr/merci?session_id={CHECKOUT_SESSION_ID}')
  assert.equal(p.cancel_url, 'https://site.fr/boutique')
  assert.equal(p.locale, 'fr')
  assert.equal(p['metadata[cms_entry]'], 'abc')
  assert.equal(p['payment_intent_data[metadata][cms_collection]'], 'products')
  assert.equal(p['shipping_address_collection[allowed_countries][1]'], 'BE')
  // Les moyens de paiement se règlent dans le tableau de bord Stripe, pas dans le code.
  assert.equal(pairs.some(([k]) => k.startsWith('payment_method_types')), false)
  const noImage = Object.fromEntries(checkoutParams({ currency: 'eur', unitAmount: 100, quantity: 1, name: 'x', image: null, successUrl: 's', cancelUrl: 'c', locale: 'pt-BR', metadata, shippingCountries: null }))
  assert.equal('line_items[0][price_data][product_data][images][0]' in noImage, false)
  assert.equal(Object.keys(noImage).some(k => k.startsWith('shipping')), false)
  assert.equal(noImage.locale, 'pt-BR')
  assert.equal(stripeLocale('br'), 'auto')
  assert.equal(stripeLocale('de-CH'), 'de')
  assert.equal(encodeForm([['a[b]', 'x y&{z}']]), 'a%5Bb%5D=x%20y%26%7Bz%7D')
  assert.equal(withSessionId('https://s.fr/merci?x=1'), 'https://s.fr/merci?x=1&session_id={CHECKOUT_SESSION_ID}')
  // Adresse de retour envoyée par le site : un chemin du site, jamais une autre adresse.
  assert.equal(safeReturnPath('/boutique?x=1'), '/boutique?x=1')
  for (const v of ['https://pirate.example', '//pirate.example', '/\\pirate.example', 'boutique', null, 3]) assert.equal(safeReturnPath(v), null, String(v))
})

test('clé de test, de production ou publiable', () => {
  assert.equal(keyMode('rk_test_abc'), 'test')
  assert.equal(keyMode('sk_live_abc'), 'live')
  assert.equal(keyMode('pk_live_abc'), 'publishable')
  assert.equal(keyMode('xkeysib-abc'), null)
})

test('signature du webhook : vecteurs calculés indépendamment (node:crypto), date, schémas ignorés', async () => {
  const secret = 'whsec_test_secret'
  const body = '{"id":"evt_1","type":"checkout.session.completed"}'
  const t = 1_800_000_000
  const expected = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')
  assert.equal(await signStripePayload(body, secret, t), `t=${t},v1=${expected}`)
  assert.deepEqual(await verifyStripeSignature(body, `t=${t},v1=${expected}`, secret, t + 10), { ok: true })
  // Plusieurs signatures (secret en cours de renouvellement), entrées inconnues et v0 ignorés.
  assert.deepEqual(await verifyStripeSignature(body, `t=${t},v0=${expected},v1=${'0'.repeat(64)},v1=${expected},destination=we_1`, secret, t), { ok: true })
  const refused = async (header: string | null, now = t, b = body, s = secret) => {
    const r = await verifyStripeSignature(b, header, s, now)
    assert.equal(r.ok, false, String(header))
    return (r as { reason: string }).reason
  }
  assert.match(await refused(null), /absent/)
  assert.match(await refused('nimporte quoi'), /illisible/)
  assert.match(await refused(`t=${t},v0=${expected}`), /illisible/)
  assert.match(await refused(`t=${t},v1=${expected}`, t + 301), /trop ancien/)
  assert.match(await refused(`t=${t},v1=${expected}`, t - 301), /trop ancien/)
  assert.match(await refused(`t=${t},v1=${expected}`, t, body + ' '), /signature invalide/)
  assert.match(await refused(`t=${t},v1=${expected}`, t, body, 'whsec_autre'), /signature invalide/)
  assert.match(await refused(`t=${t + 1},v1=${expected}`, t), /signature invalide/)
  assert.match(await refused(`t=${t},v1=${expected.toUpperCase()}`), /signature invalide/)
})

test('session reçue par le webhook : produit, montant, acheteur, livraison (deux versions d\'API), statut', () => {
  const session = {
    id: 'cs_test_1', object: 'checkout.session', amount_total: 9980, currency: 'eur', livemode: false, payment_intent: 'pi_1', payment_status: 'paid',
    customer_details: { email: 'jeanne@example.com', name: 'Jeanne Martin' },
    collected_information: { shipping_details: { name: 'Jeanne Martin', address: { line1: '12 rue des Lilas', line2: null, postal_code: '75011', city: 'Paris', state: null, country: 'FR' } } },
    metadata: { cms_collection: 'products', cms_entry: 'abc', cms_title: 'Panneau', cms_quantity: '2', cms_unit_amount: '4990', cms_locale: 'fr' },
  }
  const p = paymentFromSession(session)!
  assert.deepEqual({ ...p, shipping: undefined }, {
    sessionId: 'cs_test_1', paymentIntent: 'pi_1', collection: 'products', entryId: 'abc', title: 'Panneau', quantity: 2, unitAmount: 4990,
    amount: 9980, currency: 'eur', email: 'jeanne@example.com', name: 'Jeanne Martin', shipping: undefined, livemode: false, origin: null,
    invoice: null, subscription: null, discountAmount: 0,
  })
  // Provenance de l'acheteur : relue dans les métadonnées, contrôlée, canal recalculé.
  const ad = paymentFromSession({ ...session, metadata: { ...session.metadata, cms_o_source: 'google', cms_o_medium: 'cpc', cms_o_campaign: 'printemps', cms_o_click: 'gclid', cms_o_click_id: 'x1' } })!
  assert.deepEqual(ad.origin, { source: 'google', medium: 'cpc', campaign: 'printemps', click: 'gclid', clickId: 'x1', channel: 'google-ads' })
  assert.equal(formatShipping(p.shipping), 'Jeanne Martin\n12 rue des Lilas\n75011 Paris\nFR')
  const old = { ...session, collected_information: undefined, shipping_details: session.collected_information.shipping_details }
  assert.equal(paymentFromSession(old)!.shipping!.city, 'Paris')
  assert.equal(paymentFromSession({ ...session, metadata: {} }), null)
  assert.equal(statusFromEvent('checkout.session.completed', session), 'paid')
  assert.equal(statusFromEvent('checkout.session.completed', { ...session, payment_status: 'unpaid' }), 'pending')
  assert.equal(statusFromEvent('checkout.session.async_payment_succeeded', session), 'paid')
  assert.equal(statusFromEvent('checkout.session.async_payment_failed', session), 'failed')
  assert.equal(statusFromEvent('checkout.session.expired', session), null)
  // Un statut final ne revient jamais en arrière : rejouer « terminé, en attente » après « payé » ne change rien.
  assert.deepEqual(STATUS_FROM.pending, [])
  assert.deepEqual(STATUS_FROM.paid, ['pending'])
  assert.equal(dashboardUrl({ paymentIntent: 'pi_1', sessionId: 'cs', livemode: false }), 'https://dashboard.stripe.com/test/payments/pi_1')
  assert.equal(dashboardUrl({ paymentIntent: 'pi_1', sessionId: 'cs', livemode: true }), 'https://dashboard.stripe.com/payments/pi_1')
})

// ───────────────────────── Abonnements, codes promo, factures, stock ─────────────────────────

test('stripe() : abonnement, stock, codes promo et factures déclarés ; écritures refusées', () => {
  const options = stripe({ collections: { products: { price: 'price', recurring: 'month', stock: 'price' } }, promoCodes: true, invoices: true }).options
  assert.deepEqual([options.promoCodes, options.invoices, options.collections.products.recurring], [true, true, 'month'])
  assert.deepEqual([stripe().options.promoCodes, stripe().options.invoices], [false, false])
  assert.throws(() => stripe({ collections: { products: { price: 'price', recurring: 'day' as never } } }), /recurring/)
  assert.throws(() => stripe({ collections: { products: { price: 'price', stock: '' } } }), /stock/)
  assert.throws(() => config(stripe({ collections: { products: { price: 'price', stock: 'label' } } })), /stock : le champ « label » doit être un nombre/)
})

test('stock : illimité s\'il n\'est pas suivi ou pas saisi, refus au-delà', () => {
  const sell = { price: 'price', stock: 'stock' }
  assert.equal(checkStock({ price: 'price' }, { stock: 0 }, 1), null)
  assert.equal(checkStock(sell, { stock: null }, 3), null)
  assert.equal(checkStock(sell, { stock: 3 }, 3), null)
  assert.equal(checkStock(sell, { stock: 2 }, 3), 'Il n\'en reste que 2.')
  assert.equal(checkStock(sell, { stock: 0 }, 1), 'Ce produit est épuisé.')
})

test('session : abonnement (périodicité, métadonnées sur l\'abonnement), code promo, facture d\'un paiement en une fois', () => {
  const input = { currency: 'eur', unitAmount: 2900, quantity: 1, name: 'Offre', image: null, successUrl: 'https://s/merci', cancelUrl: 'https://s/', locale: 'fr', metadata: { cms_collection: 'plans', cms_entry: 'e1', cms_title: 'Offre', cms_quantity: '1', cms_unit_amount: '2900', cms_locale: 'fr', cms_interval: 'month' }, shippingCountries: null }
  const once = Object.fromEntries(checkoutParams({ ...input, promoCodes: true, invoices: true }))
  assert.deepEqual([once.mode, once.allow_promotion_codes, once['invoice_creation[enabled]'], once['payment_intent_data[metadata][cms_entry]']], ['payment', 'true', 'true', 'e1'])
  assert.equal(once['line_items[0][price_data][recurring][interval]'], undefined)
  const recurring = Object.fromEntries(checkoutParams({ ...input, recurring: 'month', invoices: true }))
  assert.deepEqual([recurring.mode, recurring['line_items[0][price_data][recurring][interval]'], recurring['subscription_data[metadata][cms_entry]'], recurring['subscription_data[metadata][cms_interval]']], ['subscription', 'month', 'e1', 'month'])
  // Stripe refuse ces deux réglages pour un abonnement (il a toujours ses factures, et pas de paiement isolé).
  assert.ok(!('invoice_creation[enabled]' in recurring) && !Object.keys(recurring).some(k => k.startsWith('payment_intent_data')))
  assert.equal(Object.fromEntries(checkoutParams({ ...input, recurring: 'year', promoCodes: true })).allow_promotion_codes, 'true')
})

test('session payée : facture, abonnement et remise relevés', () => {
  const p = paymentFromSession({ id: 'cs_test_1', amount_total: 2610, currency: 'eur', metadata: { cms_collection: 'plans', cms_entry: 'e1' }, invoice: 'in_1', subscription: { id: 'sub_1' }, total_details: { amount_discount: 290 } })!
  assert.deepEqual([p.invoice, p.subscription, p.discountAmount, p.amount], ['in_1', 'sub_1', 290, 2610])
  const plain = paymentFromSession({ id: 'cs_test_2', amount_total: 100, currency: 'eur', metadata: { cms_collection: 'products', cms_entry: 'e2' } })!
  assert.deepEqual([plain.invoice, plain.subscription, plain.discountAmount], [null, null, 0])
})

test('abonnement et facture lus aux deux endroits possibles selon la version de l\'API', () => {
  assert.deepEqual(subscriptionFromObject({ id: 'sub_1', status: 'active', cancel_at_period_end: true, current_period_end: 1_800_000_000 }), { subscriptionId: 'sub_1', status: 'active', cancelAtPeriodEnd: true, currentPeriodEnd: 1_800_000_000_000, canceledAt: null })
  assert.deepEqual(subscriptionFromObject({ id: 'sub_1', status: 'canceled', canceled_at: 1_700_000_000, items: { data: [{ current_period_end: 1_800_000_000 }] } }), { subscriptionId: 'sub_1', status: 'canceled', cancelAtPeriodEnd: false, currentPeriodEnd: 1_800_000_000_000, canceledAt: 1_700_000_000_000 })
  assert.equal(subscriptionFromObject({ id: 'sub_1', status: 'inconnu' }), null)
  assert.equal(subscriptionFromObject({ status: 'active' }), null)
  const old = invoiceFromObject({ id: 'in_2', subscription: 'sub_1', billing_reason: 'subscription_cycle', amount_paid: 2900, currency: 'EUR', customer_email: 'a@b.fr', payment_intent: 'pi_2', livemode: true, lines: { data: [{ period: { end: 1_800_000_000 } }] } })!
  assert.deepEqual(old, { invoiceId: 'in_2', subscriptionId: 'sub_1', reason: 'subscription_cycle', amount: 2900, currency: 'eur', email: 'a@b.fr', name: null, paymentIntent: 'pi_2', livemode: true, periodEnd: 1_800_000_000_000 })
  assert.equal(invoiceFromObject({ id: 'in_3', parent: { subscription_details: { subscription: 'sub_9' } } })!.subscriptionId, 'sub_9')
  assert.equal(invoiceFromObject({ id: 'in_4' }), null)
  assert.equal(dashboardUrl({ paymentIntent: null, sessionId: 'in_2', livemode: true }), 'https://dashboard.stripe.com/invoices/in_2')
})
