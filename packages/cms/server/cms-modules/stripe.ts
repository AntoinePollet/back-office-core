import { and, eq, inArray, sql } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { CHANNELS, channelOfRow } from '../../shared/attribution'
import {
  INTERVAL_LABELS, type PaymentFromSession, type PaymentStatus, RECURRING_INTERVALS, type RecurringInterval, type StripeConfig, STATUS_FROM,
  formatAmount, formatShipping, invoiceFromObject, keyMode, paymentFromSession, sellableCollections, statusFromEvent, subscriptionFromObject,
} from '../../shared/stripe'
import type { CmsModuleDefinition, TemplateContext } from '../utils/modules'
import { APPOINTMENTS } from '../../shared/appointments'
import { appointmentPaid } from './appointments'
import { conversionForLead } from './google-conversions'

/**
 * Paiement par Stripe Checkout (https://stripe.com).
 *
 * L'API de Stripe est appelée avec `fetch` (formulaire encodé), sans le SDK officiel : deux appels seulement
 * (créer une session, vérifier la clé), aucune dépendance de plus dans le Worker, et la vérification de signature
 * des webhooks s'écrit en quelques lignes de Web Crypto (voir shared/stripe.ts). La version de l'API est fixée
 * ci-dessous : une mise à jour de Stripe ne change pas la forme des réponses sans qu'on l'ait décidé.
 */
export const STRIPE_API_VERSION = '2026-10-28.endive'

/** Événements à cocher dans le tableau de bord Stripe pour le webhook. */
export const STRIPE_WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'charge.refunded',
  // Abonnements : échéances suivantes, échec d'un prélèvement, changement d'état, résiliation.
  'invoice.paid',
  'invoice.payment_failed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]

/** Adresse de l'API Stripe. Ne se change que pour les tests (variable NUXT_STRIPE_API_URL). */
const apiUrl = (event: H3Event) => String(useRuntimeConfig(event).stripeApiUrl).replace(/\/$/, '')

export const stripeOptions = () => moduleOptions<StripeConfig>('stripe')
export const webhookPath = '/api/stripe/webhook'

/** Appel à l'API de Stripe. Lève une erreur lisible (sans jamais la clé) si Stripe refuse. */
export async function stripeRequest<T>(event: H3Event, key: string, path: string, init: { method?: 'GET' | 'POST'; body?: string } = {}): Promise<T> {
  const response = await fetch(`${apiUrl(event)}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'authorization': `Bearer ${key}`,
      'stripe-version': STRIPE_API_VERSION,
      ...(init.body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: init.body,
    signal: AbortSignal.timeout(10_000),
  })
  const data = await response.json().catch(() => ({})) as T & { error?: { message?: string; type?: string } }
  if (!response.ok) {
    const error = new Error(`Stripe a répondu ${response.status}${data.error?.message ? ` : ${String(data.error.message).slice(0, 200)}` : ''}`) as Error & { status: number }
    error.status = response.status
    throw error
  }
  return data
}

const modeLabel = (livemode: boolean) => (livemode ? 'production' : 'test')

/** Variables d'un paiement proposées aux workflows. */
function paymentContext(p: Omit<PaymentFromSession, 'sessionId' | 'invoice' | 'subscription' | 'discountAmount'> & { id: string; sessionId: string; subscription?: string | null; discountAmount?: number }, origin: string): TemplateContext {
  return {
    payment: {
      product: p.title,
      quantity: String(p.quantity),
      amount: formatAmount(p.amount, p.currency),
      email: p.email ?? '',
      name: p.name ?? '',
      shipping: formatShipping(p.shipping),
      reference: p.paymentIntent ?? p.sessionId,
      mode: modeLabel(p.livemode),
      discount: p.discountAmount ? formatAmount(p.discountAmount, p.currency) : '',
      subscription: p.subscription ? 'oui' : 'non',
      adminUrl: `${origin}/admin/payments?payment=${p.id}`,
    },
    origin: { channel: CHANNELS[channelOfRow(p.origin)], campaign: p.origin?.campaign ?? '', term: p.origin?.term ?? '', source: p.origin?.source ?? p.origin?.referrer ?? '' },
  }
}

const EVENT_LABELS: Record<'payment.succeeded' | 'payment.failed', { label: string; done: string }> = {
  'payment.succeeded': { label: 'Un paiement est reçu', done: 'payé' },
  'payment.failed': { label: 'Un paiement différé échoue', done: 'paiement échoué' },
}

function paymentEvent(name: keyof typeof EVENT_LABELS, p: Parameters<typeof paymentContext>[0], origin: string) {
  const test = p.livemode ? '' : ' (test)'
  return {
    name,
    module: 'stripe',
    summary: `${EVENT_LABELS[name].label} : « ${p.title} » × ${p.quantity}, ${formatAmount(p.amount, p.currency)}${test}`,
    target: p.collection,
    context: paymentContext(p, origin),
  }
}

/** Paiement par Stripe Checkout : réglages, vérification de la clé, déclencheurs de workflow et écran « Paiements ». */
export const stripeModule: CmsModuleDefinition = {
  id: 'stripe',
  category: 'payment',
  needsCode: 'stripe({ collections: { boutique: { price: \'price\' } } })',
  label: 'Stripe',
  // Logo officiel de Stripe et sa couleur (tracé : Simple Icons).
  logo: { style: 'fill', color: '#635BFF', paths: ['M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.594-7.305h.003z'] },
  description: 'Paiement en ligne des produits du site, sur une page de paiement sécurisée de Stripe. Le prix vient toujours du back-office.',
  adminPage: { to: '/admin/payments', label: 'Paiements' },
  settings: [
    {
      key: 'secretKey', label: 'Clé d\'API', type: 'secret', required: true,
      help: 'Dans le tableau de bord Stripe : « Développeurs » → « Clés API » → « Créer une clé limitée ». Donnez-lui un nom (« Site »), '
        + 'le droit « Écriture » sur « Checkout Sessions » et rien d\'autre, puis copiez-la. Elle commence par « rk_test_ » (essais) ou « rk_live_ » (vrais paiements). '
        + 'Pour télécharger les factures depuis « Paiements », ajoutez « Lecture » sur « Invoices » ; pour résilier un abonnement d\'ici, « Écriture » sur « Subscriptions ». '
        + 'La « Clé secrète » (sk_…) fonctionne aussi, mais donne tous les droits sur le compte : à éviter.',
      placeholder: 'rk_live_…',
    },
    {
      key: 'webhookSecret', label: 'Secret de signature du webhook', type: 'secret', required: true,
      help: 'C\'est lui qui prouve qu\'un paiement annoncé vient bien de Stripe. Créez d\'abord le webhook (adresse et événements ci-dessous), '
        + 'puis, sur sa page, « Secret de signature » → « Révéler ». Il commence par « whsec_ ». Le mode test et le mode production ont chacun leur webhook et leur secret.',
      placeholder: 'whsec_…',
    },
  ],
  details: (event) => [
    {
      label: 'Adresse du webhook',
      value: `${linkBase(event)}${webhookPath}`,
      help: 'Dans Stripe : « Développeurs » → « Webhooks » (Workbench) → « Créer une destination d\'événements » → « Votre compte », '
        + 'format « Instantané » (snapshot), dernière version de l\'API ; type « Endpoint de webhook » ; collez cette adresse.',
    },
    { label: 'Événements à cocher', value: STRIPE_WEBHOOK_EVENTS.join('\n'), help: 'Paiement terminé, paiement différé réussi ou échoué, remboursement ; les quatre derniers ne servent qu\'aux abonnements.' },
  ],

  async test(event, settings) {
    const key = settings.secretKey ?? ''
    const mode = keyMode(key)
    if (mode === 'publishable') throw new Error('C\'est la clé publiable (pk_…) : il faut une clé limitée (rk_…) ou la clé secrète (sk_…).')
    if (!mode) throw new Error('Cette clé ne ressemble pas à une clé d\'API Stripe : elle commence par rk_test_, rk_live_, sk_test_ ou sk_live_.')
    if (!/^whsec_/.test(settings.webhookSecret ?? '')) throw new Error('Le secret du webhook doit commencer par « whsec_ ».')
    try {
      // Lister une session suffit à vérifier la clé et son droit sur les sessions Checkout ; rien n'est créé.
      await stripeRequest(event, key, '/v1/checkout/sessions?limit=1')
    }
    catch (error) {
      const status = (error as { status?: number }).status
      if (status === 401) throw new Error('Stripe ne reconnaît pas cette clé d\'API.')
      if (status === 403) throw new Error('Cette clé limitée n\'a pas le droit « Checkout Sessions » : modifiez-la dans Stripe (droit « Écriture »).')
      throw error
    }
    return mode === 'test'
      ? 'Connexion à Stripe réussie. Clé de TEST : les paiements sont simulés, aucun argent ne circule (cartes de test de Stripe).'
      : 'Connexion à Stripe réussie. Clé de PRODUCTION : les paiements sont réels.'
  },

  workflowEvents: () => {
    const targets = Object.keys(sellableCollections(cmsConfig)).map(key => ({ key, label: cmsConfig.collections?.[key]?.label ?? key }))
    const variables = [
      { key: 'payment.product', label: 'Produit acheté' },
      { key: 'payment.quantity', label: 'Quantité' },
      { key: 'payment.amount', label: 'Montant payé' },
      { key: 'payment.email', label: 'E-mail de l\'acheteur' },
      { key: 'payment.name', label: 'Nom de l\'acheteur' },
      { key: 'payment.shipping', label: 'Adresse de livraison' },
      { key: 'payment.reference', label: 'Référence Stripe' },
      { key: 'payment.mode', label: 'Mode : test ou production' },
      { key: 'payment.discount', label: 'Remise obtenue par un code promo' },
      { key: 'payment.subscription', label: 'Échéance d\'un abonnement : oui ou non' },
      { key: 'payment.adminUrl', label: 'Adresse du paiement dans le back-office' },
      { key: 'origin.channel', label: 'Provenance : canal (Google Ads, e-mail, moteur de recherche…)' },
      { key: 'origin.campaign', label: 'Provenance : nom de la campagne' },
      { key: 'origin.term', label: 'Provenance : mot-clé de l\'annonce' },
      { key: 'origin.source', label: 'Provenance : source (utm_source ou site d\'où vient l\'acheteur)' },
    ]
    const sample = (name: keyof typeof EVENT_LABELS) => (target?: string) => paymentEvent(name, {
      id: 'exemple', sessionId: 'cs_test_exemple', paymentIntent: 'pi_exemple', collection: target ?? targets[0]?.key ?? '', entryId: 'exemple',
      title: 'Produit d\'exemple', quantity: 2, unitAmount: 4990, amount: 9980, currency: stripeOptions().currency ?? 'eur',
      email: 'acheteur@example.com', name: 'Jeanne Martin', livemode: false,
      origin: { channel: 'google-ads', source: 'google', medium: 'cpc', campaign: 'printemps', term: 'avocat lyon' },
      shipping: { name: 'Jeanne Martin', line1: '12 rue des Lilas', line2: null, postalCode: '75011', city: 'Paris', state: null, country: 'FR' },
    }, '')
    const payments = (['payment.succeeded', 'payment.failed'] as const).map(name => ({
      name, label: EVENT_LABELS[name].label, targets, targetsLabel: 'Pour quels produits', variables, sample: sample(name),
    }))
    // Abonnements et stock : seulement si une collection s'en sert.
    const sellable = Object.entries(sellableCollections(cmsConfig))
    const pick = (test: (key: string) => boolean) => targets.filter(t => test(t.key))
    const recurring = pick(key => !!sellableCollections(cmsConfig)[key]?.recurring)
    const stocked = pick(key => !!sellableCollections(cmsConfig)[key]?.stock)
    const subscriptionSample = (name: keyof typeof SUBSCRIPTION_EVENTS) => (target?: string) => subscriptionEvent(name, {
      id: 'exemple', subscriptionId: 'sub_exemple', collection: target ?? recurring[0]?.key ?? '', entryId: 'exemple', title: 'Offre d\'exemple', amount: 2900,
      currency: stripeOptions().currency ?? 'eur', interval: sellable.find(([, c]) => c.recurring)?.[1].recurring ?? 'month', status: 'active', email: 'abonne@example.com', name: 'Jeanne Martin',
      livemode: false, currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000), cancelAtPeriodEnd: false, canceledAt: null, origin: null, createdAt: new Date(), updatedAt: new Date(),
    }, '')
    return [
      ...payments,
      ...(recurring.length
        ? (Object.keys(SUBSCRIPTION_EVENTS) as (keyof typeof SUBSCRIPTION_EVENTS)[]).map(name => ({
            name, label: SUBSCRIPTION_EVENTS[name], targets: recurring, targetsLabel: 'Pour quelles offres', variables: SUBSCRIPTION_VARIABLES, sample: subscriptionSample(name),
          }))
        : []),
      ...(stocked.length
        ? [{
            name: 'product.out_of_stock', label: 'Un produit est épuisé', targets: stocked, targetsLabel: 'Pour quels produits',
            variables: [{ key: 'product.title', label: 'Nom du produit' }, { key: 'product.adminUrl', label: 'Adresse du produit dans le back-office' }],
            sample: (target?: string) => stockEvent(target ?? stocked[0]?.key ?? '', 'exemple', 'Produit d\'exemple', ''),
          }]
        : []),
    ]
  },
}

// ───────────── Abonnements et stock : événements de workflow ─────────────

type SubscriptionRow = typeof schema.subscriptions.$inferSelect

const SUBSCRIPTION_EVENTS = {
  'subscription.started': 'Un abonnement est souscrit',
  'subscription.payment_failed': 'Le prélèvement d\'un abonnement échoue',
  'subscription.canceled': 'Un abonnement prend fin',
} as const
const SUBSCRIPTION_VARIABLES = [
  { key: 'subscription.offer', label: 'Offre souscrite' },
  { key: 'subscription.amount', label: 'Montant de chaque échéance' },
  { key: 'subscription.interval', label: 'Périodicité (par mois, par an…)' },
  { key: 'subscription.email', label: 'E-mail de l\'abonné' },
  { key: 'subscription.name', label: 'Nom de l\'abonné' },
  { key: 'subscription.reference', label: 'Référence Stripe' },
  { key: 'subscription.mode', label: 'Mode : test ou production' },
  { key: 'subscription.adminUrl', label: 'Adresse de l\'abonnement dans le back-office' },
]

function subscriptionEvent(name: keyof typeof SUBSCRIPTION_EVENTS, s: SubscriptionRow, origin: string) {
  const amount = `${formatAmount(s.amount, s.currency)} ${INTERVAL_LABELS[s.interval]}`
  return {
    name, module: 'stripe', target: s.collection,
    summary: `${SUBSCRIPTION_EVENTS[name]} : « ${s.title} », ${amount}${s.livemode ? '' : ' (test)'}`,
    context: {
      subscription: {
        offer: s.title, amount: formatAmount(s.amount, s.currency), interval: INTERVAL_LABELS[s.interval], email: s.email ?? '', name: s.name ?? '',
        reference: s.subscriptionId, mode: modeLabel(s.livemode), adminUrl: `${origin}/admin/payments?subscription=${s.id}`,
      },
      origin: { channel: CHANNELS[channelOfRow(s.origin)], campaign: s.origin?.campaign ?? '' },
    },
  }
}

const stockEvent = (collection: string, entryId: string, title: string, origin: string) => ({
  name: 'product.out_of_stock', module: 'stripe', target: collection, summary: `Un produit est épuisé : « ${title} »`,
  context: { product: { title, adminUrl: `${origin}/admin/${collection}/${entryId}` } },
})

/**
 * Diminue le stock d'un produit vendu (champ `stock` de sa collection), dans le brouillon comme dans la version en
 * ligne, sans descendre sous zéro. L'opération est faite par la base en une seule requête : deux paiements
 * simultanés ne se marchent pas dessus. Sans effet si le stock n'est pas suivi (champ absent ou vide).
 */
async function decrementStock(event: H3Event, collection: string, entryId: string, quantity: number, title: string) {
  const field = sellableCollections(cmsConfig)[collection]?.stock
  if (!field || !/^[a-z][a-zA-Z0-9]*$/.test(field)) return
  const { entries } = schema
  const path = sql.raw(`'$.${field}'`)
  const left = (column: typeof entries.sharedDraft | typeof entries.sharedPublished) => sql`case when json_type(${column}, ${path}) in ('integer', 'real') then json_set(${column}, ${path}, max(0, json_extract(${column}, ${path}) - ${quantity})) else ${column} end`
  const [row] = await useDb(event).update(entries).set({ sharedDraft: left(entries.sharedDraft) as never, sharedPublished: left(entries.sharedPublished) as never })
    .where(and(eq(entries.id, entryId), eq(entries.type, collection))).returning({ published: entries.sharedPublished })
  const now = (row?.published as Record<string, unknown> | null | undefined)?.[field]
  if (typeof now !== 'number') return
  // Le stock est affiché par le site : la page ne doit pas rester en retard.
  await purgeSiteCache(event).catch(() => false)
  if (now <= 0) emitCmsEvents(event, [stockEvent(collection, entryId, title, linkBase(event))])
}

// ───────────── Enregistrement des paiements (webhook) ─────────────

type PaymentRow = typeof schema.payments.$inferSelect

/**
 * Applique un événement Stripe signé. Idempotent : un même événement reçu deux fois (Stripe le fait parfois) ne crée
 * qu'une ligne, grâce à la référence unique de la session, et ne déclenche les workflows qu'au changement de statut.
 * L'ordre d'arrivée n'importe pas : un statut final (payé, échoué, remboursé) ne revient jamais en arrière.
 * Renvoie ce qui a été fait, pour le journal et les tests.
 */
export async function applyStripeEvent(event: H3Event, stripeEvent: { type?: string; data?: { object?: Record<string, any> } }): Promise<string> {
  const type = String(stripeEvent.type ?? '')
  const object = stripeEvent.data?.object ?? {}
  if (type === 'charge.refunded') return applyRefund(event, object)
  if (type === 'invoice.paid' || type === 'invoice.payment_failed') return applyInvoice(event, type, object)
  if (type === 'customer.subscription.updated' || type === 'customer.subscription.deleted') return applySubscription(event, type, object)
  const status = statusFromEvent(type, object)
  if (!status) return 'ignoré'
  const found = paymentFromSession(object)
  if (!found) return 'ignoré : session sans produit du site'
  const db = useDb(event)
  const now = new Date()
  // Vrai paiement réussi, venu d'une annonce Google avec l'accord de l'acheteur : à signaler à Google Ads.
  const conversion = status === 'paid' && found.livemode ? await conversionForLead(event, 'payment', found.origin) : null
  const row = { id: crypto.randomUUID(), ...found, conversion, refundedAmount: 0, status, createdAt: now, updatedAt: now }
  const [inserted] = await db.insert(schema.payments).values(row).onConflictDoNothing({ target: schema.payments.sessionId }).returning()
  let changed: PaymentRow | undefined = inserted
  if (!inserted) {
    const from = STATUS_FROM[status]
    if (from.length) {
      ;[changed] = await db.update(schema.payments)
        .set({ status, paymentIntent: found.paymentIntent, email: found.email, name: found.name, shipping: found.shipping, amount: found.amount, invoice: found.invoice, discountAmount: found.discountAmount, updatedAt: now, ...(conversion ? { conversion } : {}) })
        .where(and(eq(schema.payments.sessionId, found.sessionId), inArray(schema.payments.status, from))).returning()
    }
  }
  if (!changed) return 'déjà enregistré'
  // Paiement réussi : le stock du produit diminue, et un abonnement souscrit est enregistré.
  if (changed.status === 'paid') {
    await decrementStock(event, changed.collection, changed.entryId, changed.quantity, changed.title).catch(error => console.error('[stripe] stock non mis à jour', error))
    if (changed.subscription) await startSubscription(event, changed, object).catch(error => console.error('[stripe] abonnement non enregistré', error))
  }
  // Acompte d'un rendez-vous (module `appointments`) : c'est ce paiement qui le confirme.
  const appointment = changed.status === 'paid' && changed.collection === APPOINTMENTS.paymentCollection ? await appointmentPaid(event, changed.entryId) : null
  if (changed.status === 'paid' || changed.status === 'failed') {
    const name = changed.status === 'paid' ? 'payment.succeeded' : 'payment.failed'
    emitCmsEvents(event, [paymentEvent(name, { ...changed, shipping: changed.shipping ?? null }, linkBase(event))])
  }
  return `${inserted ? `enregistré (${status})` : `mis à jour (${status})`}${appointment ? ` ; rendez-vous : ${appointment}` : ''}`
}

/** Remboursement fait dans le tableau de bord Stripe : montant remboursé, et statut « remboursé » s'il est total. */
async function applyRefund(event: H3Event, charge: Record<string, any>) {
  const intent = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id
  if (!intent) return 'ignoré : remboursement sans paiement'
  const refunded = Number(charge.amount_refunded) || 0
  const total = refunded >= (Number(charge.amount) || 0)
  const set: Partial<PaymentRow> = { refundedAmount: refunded, updatedAt: new Date(), ...(total ? { status: 'refunded' as PaymentStatus } : {}) }
  const [row] = await useDb(event).update(schema.payments).set(set)
    // Seul un paiement réussi peut être remboursé (un remboursement partiel peut être suivi d'un autre).
    .where(and(eq(schema.payments.paymentIntent, intent), inArray(schema.payments.status, ['paid', 'refunded']))).returning()
  return row ? `remboursement enregistré (${refunded})` : 'ignoré : paiement inconnu'
}

// ───────────── Abonnements (webhook) ─────────────

/** Première échéance payée : l'abonnement est enregistré. Idempotent, grâce à la référence unique de l'abonnement. */
async function startSubscription(event: H3Event, payment: PaymentRow, session: Record<string, any>) {
  const interval = String(session.metadata?.cms_interval ?? sellableCollections(cmsConfig)[payment.collection]?.recurring ?? 'month')
  const now = new Date()
  const row: SubscriptionRow = {
    id: crypto.randomUUID(), subscriptionId: payment.subscription!, collection: payment.collection, entryId: payment.entryId, title: payment.title,
    // Le montant d'une échéance est le prix hors remise : un code promo ne vaut souvent que pour la première.
    amount: payment.unitAmount * payment.quantity, currency: payment.currency,
    interval: (RECURRING_INTERVALS as readonly string[]).includes(interval) ? interval as RecurringInterval : 'month',
    status: 'active', email: payment.email, name: payment.name, livemode: payment.livemode, currentPeriodEnd: null, cancelAtPeriodEnd: false, canceledAt: null,
    origin: payment.origin, createdAt: now, updatedAt: now,
  }
  const [inserted] = await useDb(event).insert(schema.subscriptions).values(row).onConflictDoNothing({ target: schema.subscriptions.subscriptionId }).returning()
  if (inserted) emitCmsEvents(event, [subscriptionEvent('subscription.started', inserted, linkBase(event))])
}

/**
 * Facture d'un abonnement. Payée : une échéance suivante devient un paiement (la première l'est déjà, par la session
 * de paiement). Impayée : l'abonnement est marqué en retard ; Stripe retente de lui-même, puis résilie.
 */
async function applyInvoice(event: H3Event, type: string, object: Record<string, any>) {
  const invoice = invoiceFromObject(object)
  if (!invoice) return 'ignoré : facture sans abonnement'
  const db = useDb(event)
  const { subscriptions: s, payments: p } = schema
  const [subscription] = await db.select().from(s).where(eq(s.subscriptionId, invoice.subscriptionId))
  if (!subscription) return 'ignoré : abonnement inconnu'
  const now = new Date()
  const origin = linkBase(event)
  if (type === 'invoice.payment_failed') {
    const [late] = await db.update(s).set({ status: 'past_due', updatedAt: now }).where(and(eq(s.id, subscription.id), inArray(s.status, ['active', 'trialing']))).returning()
    if (late) emitCmsEvents(event, [subscriptionEvent('subscription.payment_failed', late, origin)])
    return late ? 'abonnement en retard de paiement' : 'déjà enregistré'
  }
  await db.update(s).set({ status: subscription.status === 'canceled' ? 'canceled' : 'active', updatedAt: now, ...(invoice.periodEnd ? { currentPeriodEnd: new Date(invoice.periodEnd) } : {}) }).where(eq(s.id, subscription.id))
  if (invoice.reason === 'subscription_create') return 'première échéance : déjà enregistrée avec la session'
  if (!invoice.amount) return 'ignoré : facture à zéro'
  const row: PaymentRow = {
    id: crypto.randomUUID(), sessionId: invoice.invoiceId, paymentIntent: invoice.paymentIntent, collection: subscription.collection, entryId: subscription.entryId,
    title: subscription.title, quantity: 1, unitAmount: invoice.amount, amount: invoice.amount, refundedAmount: 0, currency: invoice.currency || subscription.currency,
    email: invoice.email ?? subscription.email, name: invoice.name ?? subscription.name, shipping: null, status: 'paid', livemode: invoice.livemode,
    origin: subscription.origin, conversion: null, invoice: invoice.invoiceId, subscription: invoice.subscriptionId, discountAmount: 0, createdAt: now, updatedAt: now,
  }
  const [inserted] = await db.insert(p).values(row).onConflictDoNothing({ target: p.sessionId }).returning()
  if (!inserted) return 'déjà enregistré'
  emitCmsEvents(event, [paymentEvent('payment.succeeded', { ...inserted, shipping: null }, origin)])
  return 'échéance enregistrée (paid)'
}

/** État d'un abonnement d'après Stripe : en cours, en retard, résiliation demandée, fin. Un abonnement résilié le reste. */
async function applySubscription(event: H3Event, type: string, object: Record<string, any>) {
  const found = subscriptionFromObject(type === 'customer.subscription.deleted' ? { ...object, status: 'canceled' } : object)
  if (!found) return 'ignoré : abonnement illisible'
  const db = useDb(event)
  const { subscriptions: s } = schema
  const [before] = await db.select().from(s).where(eq(s.subscriptionId, found.subscriptionId))
  if (!before) return 'ignoré : abonnement inconnu'
  if (before.status === 'canceled') return 'déjà résilié'
  const now = new Date()
  const [after] = await db.update(s).set({
    status: found.status, cancelAtPeriodEnd: found.status === 'canceled' ? false : found.cancelAtPeriodEnd, updatedAt: now,
    ...(found.currentPeriodEnd ? { currentPeriodEnd: new Date(found.currentPeriodEnd) } : {}),
    ...(found.status === 'canceled' ? { canceledAt: new Date(found.canceledAt ?? now.getTime()) } : {}),
  }).where(eq(s.id, before.id)).returning()
  if (after?.status === 'canceled') emitCmsEvents(event, [subscriptionEvent('subscription.canceled', after, linkBase(event))])
  return `abonnement mis à jour (${found.status}${found.cancelAtPeriodEnd && found.status !== 'canceled' ? ', résiliation demandée' : ''})`
}

// ───────────── Back-office : facture, résiliation ─────────────

type Actor = { id: string; name?: string | null; email?: string | null }

/** Explique le refus de Stripe pour une clé limitée à qui il manque un droit. */
function keyRefusal(error: unknown, right: string): never {
  const status = (error as { status?: number }).status
  if (status === 401 || status === 403) throw createError({ statusCode: 502, message: `Stripe refuse : la clé d'API du module n'a pas le droit ${right}. Ajoutez-le à la clé limitée dans Stripe (« Développeurs » → « Clés API »).` })
  if (status === 404) throw createError({ statusCode: 404, message: 'Stripe ne trouve plus cet élément.' })
  console.error('[stripe]', (error as Error).message)
  throw createError({ statusCode: 502, message: 'Stripe n\'a pas répondu comme attendu. Réessayez dans un instant.' })
}

/** Adresse du PDF de la facture d'un paiement, demandée à Stripe à l'instant (elle n'est valable qu'un temps). */
export async function invoicePdfUrl(event: H3Event, paymentId: string) {
  const [payment] = await useDb(event).select().from(schema.payments).where(eq(schema.payments.id, paymentId))
  if (!payment) throw createError({ statusCode: 404, message: 'Paiement introuvable.' })
  if (!payment.invoice) throw createError({ statusCode: 404, message: 'Ce paiement n\'a pas de facture Stripe.' })
  const { secretKey } = await moduleSettings(event, 'stripe')
  if (!secretKey) throw createError({ statusCode: 503, message: 'La clé d\'API Stripe n\'est pas réglée.' })
  const invoice = await stripeRequest<{ invoice_pdf?: string | null; hosted_invoice_url?: string | null }>(event, secretKey, `/v1/invoices/${encodeURIComponent(payment.invoice)}`).catch(error => keyRefusal(error, '« Lecture » sur « Invoices »'))
  const url = invoice.invoice_pdf ?? invoice.hosted_invoice_url
  if (!url || !/^https?:\/\//.test(url)) throw createError({ statusCode: 404, message: 'Stripe n\'a pas (encore) de PDF pour cette facture.' })
  return url
}

/**
 * Demande à Stripe de résilier un abonnement à la fin de la période déjà payée (l'abonné en profite jusque-là, rien
 * n'est remboursé). Un remboursement ou une résiliation immédiate se font dans le tableau de bord Stripe.
 */
export async function cancelSubscription(event: H3Event, user: Actor, id: string) {
  const db = useDb(event)
  const { subscriptions: s } = schema
  const [row] = await db.select().from(s).where(eq(s.id, id))
  if (!row) throw createError({ statusCode: 404, message: 'Abonnement introuvable.' })
  if (row.status === 'canceled') throw createError({ statusCode: 409, message: 'Cet abonnement a déjà pris fin.' })
  if (row.cancelAtPeriodEnd) return row
  const { secretKey } = await moduleSettings(event, 'stripe')
  if (!secretKey) throw createError({ statusCode: 503, message: 'La clé d\'API Stripe n\'est pas réglée.' })
  const answer = await stripeRequest<Record<string, any>>(event, secretKey, `/v1/subscriptions/${encodeURIComponent(row.subscriptionId)}`, { method: 'POST', body: 'cancel_at_period_end=true' })
    .catch(error => keyRefusal(error, '« Écriture » sur « Subscriptions »'))
  const fresh = subscriptionFromObject(answer)
  const [saved] = await db.update(s).set({ cancelAtPeriodEnd: true, updatedAt: new Date(), ...(fresh?.currentPeriodEnd ? { currentPeriodEnd: new Date(fresh.currentPeriodEnd) } : {}) }).where(eq(s.id, row.id)).returning()
  logActivity(event, {
    action: 'stripe.subscription_cancel', category: 'settings', actor: user, target: { kind: 'stripe', id: row.id },
    phrase: `a demandé la résiliation de l'abonnement « ${row.title} » (${formatAmount(row.amount, row.currency)} ${INTERVAL_LABELS[row.interval]}) à la fin de la période payée`,
  })
  return saved!
}

// ───────────── Droits ─────────────

/** Les paiements contiennent des données personnelles : seuls l'administrateur et l'éditeur les voient. */
export const canReadPayments = (user: { role: string }) => user.role === 'admin' || user.role === 'editor'

export async function requirePaymentsAccess(event: H3Event) {
  await requireModule(event, 'stripe')
  const user = await requireUser(event)
  if (!canReadPayments(user)) throw createError({ statusCode: 403, message: 'Les paiements sont réservés aux administrateurs et aux éditeurs.' })
  return user
}
