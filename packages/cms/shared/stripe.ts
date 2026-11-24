/**
 * Paiement Stripe : partie déclarative (ce qu'on écrit dans `cms.config.ts`) et logique pure, sans Nuxt,
 * partagée par le serveur, le back-office et les tests.
 *
 *   import { stripe } from 'backoffice-core/modules'
 *
 *   modules: [
 *     stripe({
 *       collections: { products: { price: 'price', image: 'image', available: 'onSale' } },
 *       currency: 'eur',
 *     }),
 *   ]
 *
 * Le montant payé vient toujours du back-office : le site n'envoie que « quel contenu, combien d'exemplaires »,
 * le serveur relit le prix publié. Le paiement n'est tenu pour réussi qu'à réception de l'événement signé de Stripe.
 */
import { type StoredOrigin, originFromMetadata } from './attribution'

// ───────────────────────── Déclaration ─────────────────────────

/** Une collection vendable : quels champs donnent le prix, le nom et l'image. */
export type SellableCollection = {
  /** Champ nombre qui porte le prix unitaire, saisi en euros (ou dans la devise du site) avec décimales : 149.9. Vide = pas en vente. */
  price: string
  /** Champ texte qui nomme le produit sur la page de paiement. Défaut : le `titleField` de la collection. */
  name?: string
  /** Champ image montré sur la page de paiement. */
  image?: string
  /** Interrupteur « En vente » : décoché, le produit n'est pas vendable, même avec un prix. */
  available?: string
  /** Quantité maximale par paiement. Défaut : 10. */
  maxQuantity?: number
}

export type StripeOptions<K extends string = string> = {
  /** Collections vendables, par identifiant de collection : `{ products: { price: 'price' } }`. */
  collections: Record<K, SellableCollection>
  /** Devise des prix, code ISO en minuscules. Défaut : 'eur'. */
  currency?: string
  /** Demande l'adresse de livraison, dans ces pays (codes ISO à deux lettres) : `{ countries: ['FR', 'BE'] }`. */
  shipping?: { countries: readonly string[] }
  /** Page du site où Stripe renvoie l'acheteur après le paiement. Défaut : '/merci'. */
  successPath?: string
  /** Page où Stripe renvoie l'acheteur qui abandonne. Défaut : la page d'où il est parti, sinon l'accueil. */
  cancelPath?: string
}

export const STRIPE_DEFAULTS = { currency: 'eur', successPath: '/merci', maxQuantity: 10 } as const
/** Plafond de la quantité réglable, pour qu'une faute de frappe dans la configuration ne fasse pas vendre 10 000 exemplaires d'un coup. */
const MAX_QUANTITY_LIMIT = 99

/** Devises sans centimes (le montant envoyé à Stripe est l'unité elle-même). Liste de Stripe. */
const ZERO_DECIMAL = ['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf']
/** Devises à trois décimales : Stripe y impose des montants arrondis à la dizaine. Non prises en charge. */
const THREE_DECIMAL = ['bhd', 'jod', 'kwd', 'omr', 'tnd']
/** Montant maximal d'un paiement Checkout, en plus petite unité (999 999,99 €). */
export const STRIPE_MAX_AMOUNT = 99_999_999

const fail = (message: string): never => { throw new Error(`Configuration invalide :\n  - stripe() : ${message}`) }
const isPath = (p: unknown) => typeof p === 'string' && p.startsWith('/') && !p.startsWith('//') && !/[\s\\]/.test(p)

/**
 * Paiement d'un produit à prix fixe par Stripe Checkout (page de paiement hébergée par Stripe).
 * Ce qui ne dépend que des options est vérifié ici ; ce qui dépend des collections (champs existants, types)
 * l'est par `defineCms`, grâce à `check`.
 */
export function stripe<const K extends string>(options: StripeOptions<K>) {
  const collections = (options?.collections ?? {}) as Record<string, SellableCollection>
  if (!Object.keys(collections).length) fail('aucune collection vendable (option collections)')
  for (const [key, c] of Object.entries(collections)) {
    if (!c || typeof c.price !== 'string' || !c.price) fail(`collections.${key} : indiquez le champ du prix (price: 'price')`)
    const max = c.maxQuantity
    if (max !== undefined && (!Number.isInteger(max) || max < 1 || max > MAX_QUANTITY_LIMIT)) fail(`collections.${key}.maxQuantity : un nombre entier entre 1 et ${MAX_QUANTITY_LIMIT}`)
  }
  const currency = options.currency ?? STRIPE_DEFAULTS.currency
  if (!/^[a-z]{3}$/.test(currency)) fail(`currency : code de devise en trois lettres minuscules attendu ('eur'), reçu « ${currency} »`)
  if (THREE_DECIMAL.includes(currency)) fail(`currency : la devise « ${currency} » (trois décimales) n'est pas prise en charge`)
  if (options.shipping) {
    const countries = options.shipping.countries
    if (!Array.isArray(countries) || !countries.length || !countries.every(c => /^[A-Z]{2}$/.test(c))) fail('shipping.countries : liste de codes pays à deux lettres majuscules attendue ([\'FR\', \'BE\'])')
  }
  if (options.successPath !== undefined && !isPath(options.successPath)) fail('successPath : une adresse du site, qui commence par / (\'/merci\')')
  if (options.cancelPath !== undefined && !isPath(options.cancelPath)) fail('cancelPath : une adresse du site, qui commence par /')
  return {
    id: 'stripe' as const,
    options: {
      collections: options.collections,
      currency,
      shipping: options.shipping ? { countries: [...options.shipping.countries] } : null,
      successPath: options.successPath ?? STRIPE_DEFAULTS.successPath,
      cancelPath: options.cancelPath ?? null,
    },
    /** Appelé par `defineCms` : vérifie les collections et les champs désignés. Retiré de la configuration publiée. */
    check: (config: ConfigLike) => checkStripe(collections, config),
  }
}

/** Options du module telles qu'elles sont enregistrées dans la configuration (valeurs par défaut appliquées). */
export type StripeConfig = ReturnType<typeof stripe>['options']

type FieldLike = { type: string; localized?: boolean; label?: string }
type ConfigLike = {
  collections?: Record<string, { titleField?: string; fields: Record<string, FieldLike> }>
  singletons?: Record<string, unknown>
}

/** Erreurs de la déclaration au regard des collections du site. */
export function checkStripe(collections: Record<string, SellableCollection>, config: ConfigLike): string[] {
  const errors: string[] = []
  for (const [key, c] of Object.entries(collections)) {
    const at = `stripe() : collections.${key}`
    const def = config.collections?.[key]
    if (!def) {
      errors.push(config.singletons?.[key] ? `${at} : « ${key} » est une page unique, seule une collection peut être vendue` : `${at} : la collection « ${key} » n'existe pas`)
      continue
    }
    const want = (option: string, name: string | undefined, type: string, what: string) => {
      if (name === undefined) return
      const field = def.fields[name]
      if (!field) errors.push(`${at}.${option} : le champ « ${name} » n'existe pas dans la collection`)
      else if (field.type !== type) errors.push(`${at}.${option} : le champ « ${name} » doit être ${what} (il est de type ${field.type})`)
      return field
    }
    const price = want('price', c.price, 'number', 'un nombre (f.number)')
    if (price?.type === 'number' && price.localized) errors.push(`${at}.price : le prix doit être le même dans toutes les langues (retirez localized: true)`)
    want('name', c.name, 'text', 'un texte (f.text)')
    want('image', c.image, 'image', 'une image (f.image)')
    want('available', c.available, 'boolean', 'un interrupteur (f.boolean)')
  }
  return errors
}

/** Collections vendables déclarées par le module `stripe`, ou un objet vide. */
export function sellableCollections(config: { modules?: readonly { id: string; options?: Record<string, unknown> }[] }) {
  return ((config.modules?.find(m => m.id === 'stripe')?.options?.collections ?? {}) as Record<string, SellableCollection>)
}

/** Les collections vendables, déduites de cms.config.ts : premier argument de `checkout()`. `never` sans module stripe. */
export type InferSellable<C> = C extends { modules: readonly (infer M)[] }
  ? M extends { id: 'stripe'; options: { collections: infer S } } ? keyof S & string : never
  : never

// ───────────────────────── Montants ─────────────────────────

/** Nombre de décimales de la devise chez Stripe : 0 (yen) ou 2 (euro). */
export const currencyDecimals = (currency: string) => (ZERO_DECIMAL.includes(currency.toLowerCase()) ? 0 : 2)

/**
 * Prix saisi dans le back-office (149.9) → montant en plus petite unité pour Stripe (14990 centimes).
 * null si ce n'est pas un prix vendable : vide, nul, négatif, ou plus de décimales que la devise n'en a (14.999 €).
 */
export function toMinorUnits(price: unknown, currency: string): number | null {
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null
  const factor = 10 ** currencyDecimals(currency)
  const minor = Math.round(price * factor)
  // 19.99 * 100 vaut 1998.9999999999998 : on arrondit, puis on refuse ce qui n'était pas un nombre de centimes.
  if (Math.abs(minor - price * factor) > 1e-6 || minor <= 0) return null
  return minor
}

/** Montant en plus petite unité → texte lisible : 14990, 'eur' → « 149,90 € ». */
export function formatAmount(minor: number, currency: string, locale = 'fr-FR') {
  const decimals = currencyDecimals(currency)
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: currency.toUpperCase(), minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(minor / 10 ** decimals)
  }
  catch {
    return `${(minor / 10 ** decimals).toFixed(decimals)} ${currency.toUpperCase()}`
  }
}

// ───────────────────────── Vendable ou non ─────────────────────────

export type SaleCheck = { ok: true; unitAmount: number } | { ok: false; reason: string }

/**
 * Un contenu publié (valeurs telles que le site les reçoit) peut-il être vendu, et à quel prix unitaire ?
 * La quantité est vérifiée à part (`checkQuantity`).
 */
export function checkSellable(sell: SellableCollection, values: Record<string, unknown>, currency: string): SaleCheck {
  if (sell.available && values[sell.available] !== true) return { ok: false, reason: 'Ce produit n\'est pas en vente pour le moment.' }
  const unitAmount = toMinorUnits(values[sell.price], currency)
  if (unitAmount === null) return { ok: false, reason: 'Ce produit n\'a pas de prix : il ne peut pas être payé en ligne.' }
  return { ok: true, unitAmount }
}

/** Quantité demandée par le visiteur : un entier entre 1 et le maximum de la collection. Renvoie un message d'erreur ou null. */
export function checkQuantity(quantity: unknown, sell: SellableCollection): string | null {
  const max = sell.maxQuantity ?? STRIPE_DEFAULTS.maxQuantity
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > max) return `La quantité doit être un nombre entier entre 1 et ${max}.`
  return null
}

// ───────────────────────── Session Checkout ─────────────────────────

/** Langues de la page de paiement de Stripe : celle du site si Stripe la connaît, sinon celle du navigateur. */
const STRIPE_LOCALES = ['bg', 'cs', 'da', 'de', 'el', 'en', 'en-GB', 'es', 'es-419', 'et', 'fi', 'fil', 'fr', 'fr-CA', 'hr', 'hu', 'id', 'it', 'ja', 'ko', 'lt', 'lv', 'ms', 'mt', 'nb', 'nl', 'pl', 'pt', 'pt-BR', 'ro', 'ru', 'sk', 'sl', 'sv', 'th', 'tr', 'vi', 'zh', 'zh-HK', 'zh-TW']
export const stripeLocale = (locale: string) => (STRIPE_LOCALES.includes(locale) ? locale : STRIPE_LOCALES.includes(locale.split('-')[0]!) ? locale.split('-')[0]! : 'auto')

/** Métadonnées posées sur la session et le paiement : c'est ainsi que le webhook retrouve le produit. */
/** Métadonnées de la session : le produit, et la provenance de l'acheteur (`cms_o_*`, voir `shared/attribution.ts`). */
export type CheckoutMetadata = { cms_collection: string; cms_entry: string; cms_title: string; cms_quantity: string; cms_unit_amount: string; cms_locale: string } & { [key: `cms_o_${string}`]: string }

export type CheckoutInput = {
  currency: string
  unitAmount: number
  quantity: number
  name: string
  /** Adresse publique (https) de l'image du produit, ou null. */
  image: string | null
  successUrl: string
  cancelUrl: string
  locale: string
  metadata: CheckoutMetadata
  shippingCountries: readonly string[] | null
}

/**
 * Paramètres de création d'une session Checkout (POST /v1/checkout/sessions), en paires prêtes à encoder.
 * Pas de `payment_method_types` : les moyens de paiement se choisissent dans le tableau de bord Stripe.
 */
export function checkoutParams(input: CheckoutInput): [string, string][] {
  const p: [string, string][] = [
    ['mode', 'payment'],
    ['line_items[0][quantity]', String(input.quantity)],
    ['line_items[0][price_data][currency]', input.currency],
    ['line_items[0][price_data][unit_amount]', String(input.unitAmount)],
    ['line_items[0][price_data][product_data][name]', input.name.slice(0, 250)],
  ]
  if (input.image) p.push(['line_items[0][price_data][product_data][images][0]', input.image])
  p.push(
    ['success_url', input.successUrl],
    ['cancel_url', input.cancelUrl],
    ['locale', stripeLocale(input.locale)],
    // Identifiant de suivi des sessions créées par ce module, visible dans le tableau de bord Stripe.
    ['integration_identifier', 'backoffice-core-checkout-pqwhxzrk'],
    ['client_reference_id', `${input.metadata.cms_collection}:${input.metadata.cms_entry}`.slice(0, 200)],
  )
  for (const [key, value] of Object.entries(input.metadata)) {
    p.push([`metadata[${key}]`, value], [`payment_intent_data[metadata][${key}]`, value])
  }
  input.shippingCountries?.forEach((country, i) => p.push([`shipping_address_collection[allowed_countries][${i}]`, country]))
  return p
}

/** Corps de requête « formulaire encodé », comme l'attend l'API de Stripe. */
export const encodeForm = (pairs: [string, string][]) => pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')

/** Ajoute `session_id={CHECKOUT_SESSION_ID}` à l'adresse de succès : Stripe y met l'identifiant de la session. */
export const withSessionId = (url: string) => `${url}${url.includes('?') ? '&' : '?'}session_id={CHECKOUT_SESSION_ID}`

/** Une adresse de retour envoyée par le site : un chemin du site seulement (jamais une autre adresse), sinon null. */
export const safeReturnPath = (path: unknown) => (isPath(path) && String(path).length <= 500 ? String(path) : null)

/** Clé de test ou de production, d'après son préfixe. `publishable` : la clé publiable, qui ne convient pas ici. */
export function keyMode(key: string): 'test' | 'live' | 'publishable' | null {
  if (/^pk_(test|live)_/.test(key)) return 'publishable'
  const match = /^(sk|rk)_(test|live)_/.exec(key)
  return match ? (match[2] as 'test' | 'live') : null
}

// ───────────────────────── Webhook ─────────────────────────

/** Écart toléré entre la date de signature d'un événement et l'heure du serveur (secondes) : contre le rejeu. */
export const WEBHOOK_TOLERANCE_S = 300
const encoder = new TextEncoder()

async function hmacHex(secret: string, message: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)))
  return [...mac].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Comparaison en temps constant : le temps de réponse ne révèle pas combien de caractères sont justes. */
function sameText(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** En-tête `Stripe-Signature` d'un corps, pour les tests : `t=…,v1=…`. */
export async function signStripePayload(body: string, secret: string, timestamp: number) {
  return `t=${timestamp},v1=${await hmacHex(secret, `${timestamp}.${body}`)}`
}

/**
 * Vérifie la signature d'un événement envoyé par Stripe (en-tête `Stripe-Signature`), comme le décrit
 * https://docs.stripe.com/webhooks#verify-manually : HMAC-SHA256 de « horodatage.corps brut » avec le secret du webhook,
 * comparé à chaque signature `v1` (il y en a deux pendant le renouvellement d'un secret). Les autres schémas sont ignorés.
 */
export async function verifyStripeSignature(body: string, header: string | null | undefined, secret: string, now = Date.now() / 1000, tolerance = WEBHOOK_TOLERANCE_S): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!header) return { ok: false, reason: 'en-tête Stripe-Signature absent' }
  let timestamp = Number.NaN
  const signatures: string[] = []
  for (const part of header.split(',')) {
    const at = part.indexOf('=')
    const [key, value] = [part.slice(0, at).trim(), part.slice(at + 1).trim()]
    if (key === 't') timestamp = /^\d+$/.test(value) ? Number(value) : Number.NaN
    if (key === 'v1' && value) signatures.push(value)
  }
  if (!Number.isFinite(timestamp) || !signatures.length) return { ok: false, reason: 'en-tête Stripe-Signature illisible' }
  if (Math.abs(now - timestamp) > tolerance) return { ok: false, reason: 'événement trop ancien (ou horloge décalée)' }
  const expected = await hmacHex(secret, `${timestamp}.${body}`)
  return signatures.some(s => sameText(s, expected)) ? { ok: true } : { ok: false, reason: 'signature invalide' }
}

export type PaymentStatus = 'paid' | 'pending' | 'failed' | 'refunded'

/** Ce qu'on garde d'une session Checkout terminée. */
export type PaymentFromSession = {
  sessionId: string
  paymentIntent: string | null
  collection: string
  entryId: string
  title: string
  quantity: number
  unitAmount: number
  amount: number
  currency: string
  email: string | null
  name: string | null
  shipping: ShippingAddress | null
  livemode: boolean
  /** D'où venait l'acheteur, lu dans les métadonnées de la session. */
  origin: StoredOrigin | null
}

export type ShippingAddress = { name: string | null; line1: string | null; line2: string | null; postalCode: string | null; city: string | null; state: string | null; country: string | null }

type Obj = Record<string, any>
const str = (v: unknown) => (typeof v === 'string' && v ? v : null)

/**
 * Lit une session Checkout reçue par le webhook. null si elle ne vient pas de ce site (pas nos métadonnées) :
 * le même compte Stripe peut servir à d'autres ventes.
 * L'adresse de livraison est lue aux deux endroits possibles selon la version d'API du webhook
 * (`collected_information.shipping_details` depuis 2025, `shipping_details` avant).
 */
export function paymentFromSession(session: Obj): PaymentFromSession | null {
  const meta = (session?.metadata ?? {}) as Partial<CheckoutMetadata>
  if (!str(session?.id) || !meta.cms_collection || !meta.cms_entry) return null
  const ship = session.collected_information?.shipping_details ?? session.shipping_details ?? null
  const address = ship?.address ?? null
  const quantity = Number(meta.cms_quantity)
  return {
    sessionId: session.id,
    paymentIntent: str(typeof session.payment_intent === 'object' ? session.payment_intent?.id : session.payment_intent),
    collection: meta.cms_collection,
    entryId: meta.cms_entry,
    title: meta.cms_title ?? '',
    quantity: Number.isInteger(quantity) && quantity > 0 ? quantity : 1,
    unitAmount: Number(meta.cms_unit_amount) || 0,
    amount: Number(session.amount_total) || 0,
    currency: String(session.currency ?? '').toLowerCase(),
    email: str(session.customer_details?.email) ?? str(session.customer_email),
    name: str(session.customer_details?.name) ?? str(ship?.name),
    shipping: address
      ? { name: str(ship?.name), line1: str(address.line1), line2: str(address.line2), postalCode: str(address.postal_code), city: str(address.city), state: str(address.state), country: str(address.country) }
      : null,
    livemode: session.livemode === true,
    origin: originFromMetadata(session?.metadata),
  }
}

/**
 * État d'un paiement d'après l'événement reçu :
 * - `checkout.session.completed` : payé, ou en attente pour un moyen de paiement différé (virement, prélèvement…) ;
 * - `checkout.session.async_payment_succeeded` / `…_failed` : issue d'un paiement différé.
 */
export function statusFromEvent(type: string, session: Obj): PaymentStatus | null {
  if (type === 'checkout.session.async_payment_succeeded') return 'paid'
  if (type === 'checkout.session.async_payment_failed') return 'failed'
  if (type === 'checkout.session.completed') return session?.payment_status === 'unpaid' ? 'pending' : 'paid'
  return null
}

/** Statuts depuis lesquels on peut passer au statut donné : un état final ne revient jamais en arrière. */
export const STATUS_FROM: Record<PaymentStatus, PaymentStatus[]> = {
  pending: [],
  paid: ['pending'],
  failed: ['pending'],
  refunded: ['paid'],
}

/** Adresse de livraison sur plusieurs lignes, pour l'écran et les e-mails. */
export const formatShipping = (s: ShippingAddress | null) =>
  (s ? [s.name, s.line1, s.line2, [s.postalCode, s.city].filter(Boolean).join(' '), s.state, s.country].filter(Boolean).join('\n') : '')

/** Lien vers le paiement dans le tableau de bord Stripe (mode test ou production). */
export const dashboardUrl = (p: { paymentIntent: string | null; sessionId: string; livemode: boolean }) =>
  `https://dashboard.stripe.com/${p.livemode ? '' : 'test/'}${p.paymentIntent ? `payments/${p.paymentIntent}` : `checkout/sessions/${p.sessionId}`}`
