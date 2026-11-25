import { and, eq, inArray } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { CHANNELS, channelOfRow } from '../../shared/attribution'
import {
  type PaymentFromSession, type PaymentStatus, type StripeConfig, STATUS_FROM,
  formatAmount, formatShipping, keyMode, paymentFromSession, sellableCollections, statusFromEvent,
} from '../../shared/stripe'
import type { CmsModuleDefinition, TemplateContext } from '../utils/modules'
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
function paymentContext(p: Omit<PaymentFromSession, 'sessionId'> & { id: string; sessionId: string }, origin: string): TemplateContext {
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
      value: `${getRequestURL(event).origin}${webhookPath}`,
      help: 'Dans Stripe : « Développeurs » → « Webhooks » (Workbench) → « Créer une destination d\'événements » → « Votre compte », '
        + 'format « Instantané » (snapshot), dernière version de l\'API ; type « Endpoint de webhook » ; collez cette adresse.',
    },
    { label: 'Événements à cocher', value: STRIPE_WEBHOOK_EVENTS.join('\n'), help: 'Paiement terminé, paiement différé réussi ou échoué, remboursement.' },
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
    return (['payment.succeeded', 'payment.failed'] as const).map(name => ({
      name, label: EVENT_LABELS[name].label, targets, targetsLabel: 'Pour quels produits', variables, sample: sample(name),
    }))
  },
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
        .set({ status, paymentIntent: found.paymentIntent, email: found.email, name: found.name, shipping: found.shipping, amount: found.amount, updatedAt: now, ...(conversion ? { conversion } : {}) })
        .where(and(eq(schema.payments.sessionId, found.sessionId), inArray(schema.payments.status, from))).returning()
    }
  }
  if (!changed) return 'déjà enregistré'
  if (changed.status === 'paid' || changed.status === 'failed') {
    const name = changed.status === 'paid' ? 'payment.succeeded' : 'payment.failed'
    emitCmsEvents(event, [paymentEvent(name, { ...changed, shipping: changed.shipping ?? null }, getRequestURL(event).origin)])
  }
  return inserted ? `enregistré (${status})` : `mis à jour (${status})`
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

// ───────────── Droits ─────────────

/** Les paiements contiennent des données personnelles : seuls l'administrateur et l'éditeur les voient. */
export const canReadPayments = (user: { role: string }) => user.role === 'admin' || user.role === 'editor'

export async function requirePaymentsAccess(event: H3Event) {
  await requireModule(event, 'stripe')
  const user = await requireUser(event)
  if (!canReadPayments(user)) throw createError({ statusCode: 403, message: 'Les paiements sont réservés aux administrateurs et aux éditeurs.' })
  return user
}
