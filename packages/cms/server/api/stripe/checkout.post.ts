import { and, eq } from 'drizzle-orm'
import {
  type CheckoutMetadata, checkQuantity, checkSellable, checkoutParams, encodeForm, safeReturnPath, sellableCollections, STRIPE_MAX_AMOUNT, withSessionId,
} from '../../../shared/stripe'
import type { AnyField } from '../../../shared/format'
import { stripeOptions, stripeRequest } from '../../cms-modules/stripe'

/** Sessions de paiement créées par visiteur (adresse IP) et par fenêtre de dix minutes. */
const MAX_PER_WINDOW = 10
const WINDOW_MS = 10 * 60_000

/**
 * Crée une session de paiement Stripe Checkout pour un produit du site (module `stripe`) et renvoie l'adresse
 * de la page de paiement. Route publique.
 *
 * Le visiteur n'envoie que la collection, l'identifiant du contenu et la quantité : le prix est relu ici, dans la
 * version **publiée** du contenu. Tout montant envoyé par le navigateur est ignoré.
 */
export default defineEventHandler(async (event) => {
  requireModule('stripe')
  if (Number(getRequestHeader(event, 'content-length') ?? 0) > 10_000) throw createError({ statusCode: 413, message: 'Demande trop longue.' })
  const body = await readBody<{ collection?: unknown; id?: unknown; quantity?: unknown; locale?: unknown; returnPath?: unknown }>(event).catch(() => null)

  const options = stripeOptions()
  const type = String(body?.collection ?? '')
  const sell = Object.hasOwn(sellableCollections(cmsConfig), type) ? sellableCollections(cmsConfig)[type]! : null
  if (!sell) throw createError({ statusCode: 404, message: 'Ce type de contenu n\'est pas en vente.' })
  // Sans quantité : un exemplaire. Toute autre valeur doit être un entier dans les limites de la collection.
  const quantity = body?.quantity === undefined ? 1 : body.quantity
  const quantityError = checkQuantity(quantity, sell)
  if (quantityError || typeof quantity !== 'number') throw createError({ statusCode: 422, message: quantityError ?? 'Quantité invalide.' })
  const locale = typeof body?.locale === 'string' && cmsConfig.site.locales.includes(body.locale) ? body.locale : cmsConfig.site.defaultLocale

  const limit = { key: `checkout:${clientIp(event)}`, max: MAX_PER_WINDOW }
  await assertRateLimit(event, [limit], minutes => `Trop de tentatives de paiement. Réessayez dans ${minutes} minute${minutes > 1 ? 's' : ''}.`)

  // Le contenu tel qu'il est publié dans cette langue. Un brouillon, un contenu retiré du site ou supprimé n'est pas vendable.
  const def = getDef(type)
  const db = useDb(event)
  const id = typeof body?.id === 'string' ? body.id.slice(0, 100) : ''
  const [entry] = id ? await db.select().from(schema.entries).where(and(eq(schema.entries.id, id), eq(schema.entries.type, type))) : []
  const [row] = entry ? await db.select().from(schema.entryLocales).where(and(eq(schema.entryLocales.entryId, id), eq(schema.entryLocales.locale, locale))) : []
  if (!entry || !row || row.published == null || entry.sharedPublished == null) throw createError({ statusCode: 404, message: 'Ce produit n\'existe pas ou n\'est plus en ligne.' })
  const product = toPublicEntry(def, entry, row) as Record<string, unknown>
  const image = sell.image ? { image: product[sell.image] } : {}
  if (sell.image) await resolveRefs(event, locale, [{ fields: { image: def.fields[sell.image] as AnyField }, values: image }])

  const sale = checkSellable(sell, product, options.currency)
  if (!sale.ok) throw createError({ statusCode: 422, message: sale.reason })
  if (sale.unitAmount * quantity > STRIPE_MAX_AMOUNT) throw createError({ statusCode: 422, message: 'Montant trop élevé pour un paiement en ligne.' })

  const settings = await moduleSettings(event, 'stripe')
  if (!settings.secretKey || !settings.webhookSecret) throw createError({ statusCode: 503, message: 'Le paiement en ligne n\'est pas encore configuré sur ce site.' })

  const titleField = def.kind === 'collection' ? def.titleField : ''
  const name = String(product[sell.name ?? titleField] ?? '') || String(product[titleField] ?? '') || 'Produit'
  const origin = getRequestURL(event).origin
  // L'image est vue par Stripe : il lui faut une adresse publique, en https (celle du site en production).
  const mediaUrl = (image.image as { url?: string } | null | undefined)?.url
  const imageUrl = mediaUrl ? new URL(mediaUrl, cmsConfig.site.url ?? origin).href : null
  const metadata: CheckoutMetadata = {
    cms_collection: type, cms_entry: id, cms_title: name.slice(0, 450), cms_quantity: String(quantity), cms_unit_amount: String(sale.unitAmount), cms_locale: locale,
  }
  const params = checkoutParams({
    currency: options.currency,
    unitAmount: sale.unitAmount,
    quantity,
    name,
    image: imageUrl?.startsWith('https://') ? imageUrl : null,
    successUrl: withSessionId(origin + options.successPath),
    cancelUrl: origin + (options.cancelPath ?? safeReturnPath(body?.returnPath) ?? '/'),
    locale,
    metadata,
    shippingCountries: options.shipping?.countries ?? null,
  })

  await hitRateLimit(event, [limit.key], WINDOW_MS)
  try {
    const session = await stripeRequest<{ id: string; url: string }>(event, settings.secretKey, '/v1/checkout/sessions', { method: 'POST', body: encodeForm(params) })
    if (!session.url) throw new Error('Stripe n\'a pas renvoyé d\'adresse de paiement.')
    return { url: session.url }
  }
  catch (error) {
    // Le détail (clé refusée, montant trop faible…) va dans le journal du serveur ; le visiteur reçoit un message simple.
    console.error('[stripe] création de la session refusée :', (error as Error).message)
    throw createError({ statusCode: 502, message: 'Le paiement n\'a pas pu être préparé. Réessayez dans un instant.' })
  }
})
