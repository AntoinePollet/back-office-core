import { and, count, desc, eq, lt } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { CHANNELS, type StoredOrigin, channelOfRow } from '../../shared/attribution'
import type { NewsletterOptions } from '../../shared/modules'
import { NEWSLETTER, type NewsletterPage, confirmationEmail, newsletterPageHtml } from '../../shared/newsletter'
import type { CmsTheme } from '../../shared/theme'
import type { NewsletterSync } from '../database/schema'
import type { CmsModuleDefinition } from '../utils/modules'

type Subscriber = typeof schema.newsletterSubscribers.$inferSelect

/** Lettre d'information : inscriptions confirmées par e-mail, listées dans le back-office et reportées chez Brevo ou Resend. */
export const newsletterModule: CmsModuleDefinition = {
  id: 'newsletter',
  category: 'forms',
  label: 'Lettre d\'information',
  // Icône « journal » de Lucide.
  logo: { style: 'stroke', color: 'currentColor', paths: ['M15 18h-5', 'M18 14h-8', 'M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-4 0v-9a2 2 0 0 1 2-2h2', 'M10 6h8v4h-8z'] },
  description: 'Inscription à la lettre d\'information, confirmée par e-mail : les inscrits sont listés dans « Lettre d\'information » et peuvent être reportés dans une liste Brevo ou une audience Resend.',
  adminPage: { to: '/admin/newsletter', label: 'Lettre d\'information' },
  settings: [
    {
      key: 'list', label: 'Liste où reporter les inscrits', type: 'text', placeholder: '12',
      help: 'Facultatif. Avec Brevo : le numéro de la liste (Contacts → Listes, colonne « ID »). Avec Resend : l\'identifiant de l\'audience. Chaque inscription confirmée y est ajoutée, chaque désinscription retirée. Vide : les inscrits restent seulement dans le back-office.',
    },
  ],

  async test(event, settings) {
    const mail = await mailStatus(event)
    if (!mail.configured) throw new Error('Aucun envoi d\'e-mails n\'est réglé sur ce site (module Brevo ou Resend) : l\'e-mail de confirmation ne peut pas partir, les inscriptions sont refusées.')
    if (!settings.list) return `Les e-mails de confirmation partent par ${mail.module!.label}. Aucune liste désignée : les inscrits restent dans le back-office.`
    const provider = await contactsProvider(event)
    if (!provider) throw new Error(`${mail.module!.label} ne sait pas tenir de liste de contacts.`)
    const name = await provider.contacts.check(event, provider.settings, settings.list)
    return `Les e-mails de confirmation partent par ${provider.label}, et les inscrits sont reportés dans la liste « ${name} ».`
  },

  workflowEvents: () => {
    const variables = [
      { key: 'subscriber.email', label: 'Adresse e-mail de l\'inscrit' },
      { key: 'subscriber.locale', label: 'Langue de l\'inscription' },
      { key: 'subscriber.source', label: 'Page du site où l\'inscription a été faite' },
      { key: 'subscriber.unsubscribeUrl', label: 'Lien de désinscription de cette personne' },
      { key: 'subscriber.adminUrl', label: 'Adresse de la liste dans le back-office' },
      { key: 'origin.channel', label: 'Provenance : canal (Google Ads, e-mail, moteur de recherche…)' },
      { key: 'origin.campaign', label: 'Provenance : nom de la campagne' },
    ]
    const sample = (summary: string) => () => ({
      summary,
      context: {
        subscriber: { email: 'visiteur@example.com', locale: cmsConfig.site.defaultLocale, source: '/', unsubscribeUrl: 'https://exemple.fr/api/newsletter/unsubscribe?id=exemple&t=exemple', adminUrl: 'https://exemple.fr/admin/newsletter' },
        origin: { channel: CHANNELS['google-ads'], campaign: 'printemps' },
      },
    })
    return [
      { name: 'newsletter.subscribed', label: 'Quelqu\'un confirme son inscription à la lettre d\'information', variables, sample: sample('visiteur@example.com s\'est inscrit à la lettre d\'information') },
      { name: 'newsletter.unsubscribed', label: 'Quelqu\'un se désinscrit de la lettre d\'information', variables, sample: sample('visiteur@example.com s\'est désinscrit de la lettre d\'information') },
    ]
  },
}

// ───────────── Liens signés ─────────────

/**
 * Signature d'un lien envoyé par e-mail : elle dépend du secret du site, de l'inscrit et de l'usage du lien. Rien
 * n'est donc à garder en base, et le lien de désinscription d'un inscrit peut être redonné à tout moment (export,
 * workflows). Le lien de confirmation dépend aussi de la date de la demande : une nouvelle demande périme l'ancien.
 */
async function sign(event: H3Event, purpose: string, id: string) {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(cmsSiteSecret(event)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`newsletter:${purpose}:${id}`)))
  return btoa(String.fromCharCode(...mac)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 32)
}

/** Comparaison qui ne s'arrête pas au premier caractère différent. */
function sameSignature(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const confirmPurpose = (row: Pick<Subscriber, 'createdAt'>) => `confirm:${row.createdAt.getTime()}`
const link = async (event: H3Event, route: 'confirm' | 'unsubscribe', row: Pick<Subscriber, 'id' | 'createdAt'>) =>
  `${getRequestURL(event).origin}/api/newsletter/${route}?id=${row.id}&t=${await sign(event, route === 'confirm' ? confirmPurpose(row) : 'leave', row.id)}`

/** Lien de désinscription d'un inscrit : toujours le même, tant que le secret du site ne change pas. */
export const unsubscribeUrl = (event: H3Event, row: Pick<Subscriber, 'id' | 'createdAt'>) => link(event, 'unsubscribe', row)

/** L'inscrit que désigne un lien reçu par e-mail, ou null si le lien est faux, périmé, ou si l'inscrit n'existe plus. */
export async function subscriberFromLink(event: H3Event, route: 'confirm' | 'unsubscribe') {
  const query = getQuery(event)
  const id = String(query.id ?? ''), given = String(query.t ?? '')
  if (!/^[0-9a-f-]{36}$/.test(id) || !given) return null
  const [row] = await useDb(event).select().from(schema.newsletterSubscribers).where(eq(schema.newsletterSubscribers.id, id))
  if (!row) return null
  return sameSignature(given, await sign(event, route === 'confirm' ? confirmPurpose(row) : 'leave', row.id)) ? row : null
}

// ───────────── Pages et e-mails ─────────────

const options = () => moduleOptions<NewsletterOptions>('newsletter')

async function siteTheme(event: H3Event) {
  const [row] = await useDb(event).select().from(schema.settings).where(eq(schema.settings.key, 'theme'))
  return (row?.value as CmsTheme | undefined) ?? null
}

/**
 * Réponse à un visiteur qui suit un lien de la lettre : la page du site réglée dans `newsletter({ … })` si elle
 * existe pour ce cas, sinon une page du core. Jamais gardée en cache, jamais indexée.
 */
export async function sendNewsletterPage(event: H3Event, page: NewsletterPage, locale: string) {
  const { site } = cmsConfig
  const prefix = locale === site.defaultLocale || !site.locales.includes(locale) ? '' : `/${locale}`
  const target = page.kind === 'confirmed' || page.kind === 'already' ? options().confirmedPath : page.kind === 'left' ? options().unsubscribedPath : undefined
  setResponseHeaders(event, { 'cache-control': NO_CACHE, 'x-robots-tag': 'noindex' })
  if (target) return sendRedirect(event, prefix + target, 303)
  if (page.kind === 'invalid') setResponseStatus(event, 410)
  setResponseHeader(event, 'content-type', 'text/html; charset=utf-8')
  return newsletterPageHtml(page, { siteName: site.name, locale, theme: await siteTheme(event), home: prefix || '/' })
}

async function sendConfirmation(event: H3Event, row: Subscriber) {
  const theme = await siteTheme(event)
  const mail = confirmationEmail({ siteName: cmsConfig.site.name, locale: row.locale, confirmUrl: await link(event, 'confirm', row), color: theme?.primary })
  await sendEmail(event, { to: [row.email], ...mail })
}

// ───────────── Liste du service d'envoi ─────────────

/** Ajoute ou retire un inscrit de la liste désignée dans les réglages. Null : aucune liste à tenir. Ne lève pas d'erreur. */
async function pushToList(event: H3Event, row: Pick<Subscriber, 'email'>, action: 'add' | 'remove'): Promise<NewsletterSync | null> {
  const { list } = await moduleSettings(event, 'newsletter')
  if (!list) return null
  const provider = await contactsProvider(event)
  if (!provider) return { provider: '', ok: false, detail: 'Aucun service d\'envoi d\'e-mails réglé qui tienne une liste de contacts.', at: Date.now() }
  try {
    await provider.contacts[action](event, provider.settings, list, row.email)
    return { provider: provider.label, ok: true, detail: '', at: Date.now() }
  }
  catch (error) {
    return { provider: provider.label, ok: false, detail: String((error as Error).message).slice(0, 300), at: Date.now() }
  }
}

async function syncRow(event: H3Event, row: Subscriber, action: 'add' | 'remove') {
  const sync = await pushToList(event, row, action)
  if (sync) await useDb(event).update(schema.newsletterSubscribers).set({ sync }).where(eq(schema.newsletterSubscribers.id, row.id))
  return sync
}

/**
 * Rattrapage : reporte dans la liste les inscrits confirmés qui n'y sont pas encore (liste désignée après coup,
 * service en panne au moment de la confirmation). Quelques-uns par appel ; `remaining` dit s'il en reste.
 */
export async function syncPending(event: H3Event) {
  const db = useDb(event)
  const { newsletterSubscribers: t } = schema
  const { list } = await moduleSettings(event, 'newsletter')
  if (!list) throw createError({ statusCode: 400, message: 'Aucune liste n\'est désignée dans les réglages du module.' })
  const confirmed = await db.select().from(t).where(eq(t.status, 'confirmed'))
  const todo = confirmed.filter(r => !r.sync?.ok)
  const batch = todo.slice(0, NEWSLETTER.syncBatch)
  let done = 0, failed = 0
  let error = ''
  for (const row of batch) {
    const sync = await syncRow(event, row, 'add')
    if (sync?.ok) done++
    else { failed++; error ||= sync?.detail ?? '' }
    // Les trois premiers refusés (clé, liste inconnue) : inutile d'insister sur les suivants.
    if (failed === 3 && !done) break
  }
  return { done, failed, error, remaining: todo.length - done - failed }
}

// ───────────── Inscription, confirmation, désinscription ─────────────

function subscriberEvent(event: H3Event, name: 'newsletter.subscribed' | 'newsletter.unsubscribed', row: Subscriber, leave: string) {
  const origin = getRequestURL(event).origin
  return {
    name, module: 'newsletter',
    summary: `${row.email} s'est ${name === 'newsletter.subscribed' ? 'inscrit à' : 'désinscrit de'} la lettre d'information`,
    context: {
      subscriber: { email: row.email, locale: row.locale, source: row.source ?? '', unsubscribeUrl: leave, adminUrl: `${origin}/admin/newsletter` },
      origin: { channel: CHANNELS[channelOfRow(row.origin)], campaign: row.origin?.campaign ?? '' },
    },
  }
}

/**
 * Enregistre une demande d'inscription et envoie l'e-mail de confirmation. La réponse au visiteur est la même que
 * l'adresse soit nouvelle, déjà inscrite ou en attente : on ne peut pas s'en servir pour savoir qui est inscrit.
 * Lève une erreur seulement si l'e-mail n'a pas pu partir.
 */
export async function requestSubscription(event: H3Event, input: { email: string; locale: string; source: string | null; origin: StoredOrigin | null }) {
  const db = useDb(event)
  const { newsletterSubscribers: t } = schema
  const now = new Date()
  // Ménage : une demande jamais confirmée ne reste pas en base.
  await db.delete(t).where(and(eq(t.status, 'pending'), lt(t.createdAt, new Date(now.getTime() - NEWSLETTER.pendingDays * 86_400_000))))

  const [known] = await db.select().from(t).where(eq(t.email, input.email))
  if (known?.status === 'confirmed') return
  // Déjà en attente, e-mail envoyé il y a peu : pas un second envoi coup sur coup à la même adresse.
  if (known?.status === 'pending' && known.confirmationSentAt && now.getTime() - known.confirmationSentAt.getTime() < NEWSLETTER.resendAfterMs) return

  const fresh = { locale: input.locale, status: 'pending' as const, source: input.source, origin: input.origin, createdAt: now, confirmationSentAt: now, confirmedAt: null, unsubscribedAt: null, sync: null }
  const row: Subscriber = known ? { ...known, ...fresh } : { id: crypto.randomUUID(), email: input.email, ...fresh }
  if (known) await db.update(t).set(fresh).where(eq(t.id, known.id))
  else await db.insert(t).values(row)
  await sendConfirmation(event, row)
}

/** Confirme une inscription en attente. Renvoie la page à afficher. */
export async function confirmSubscription(event: H3Event, row: Subscriber): Promise<NewsletterPage> {
  if (row.status === 'confirmed') return { kind: 'already' }
  if (row.status !== 'pending') return { kind: 'invalid' }
  const db = useDb(event)
  const { newsletterSubscribers: t } = schema
  const confirmedAt = new Date()
  // Deux clics simultanés (ou un lecteur d'e-mails qui ouvre le lien avant la personne) : un seul compte.
  const changed = await db.update(t).set({ status: 'confirmed', confirmedAt }).where(and(eq(t.id, row.id), eq(t.status, 'pending'))).returning({ id: t.id })
  if (!changed.length) return { kind: 'already' }
  const confirmed: Subscriber = { ...row, status: 'confirmed', confirmedAt }
  event.waitUntil(syncRow(event, confirmed, 'add').catch(error => console.error('[cms] lettre d\'information : report dans la liste impossible', error)))
  emitCmsEvents(event, [subscriberEvent(event, 'newsletter.subscribed', confirmed, await unsubscribeUrl(event, confirmed))])
  return { kind: 'confirmed' }
}

/** Désinscrit quelqu'un (par son lien, ou depuis le back-office) et le retire de la liste du service d'envoi. */
export async function unsubscribe(event: H3Event, row: Subscriber) {
  if (row.status === 'unsubscribed') return
  const db = useDb(event)
  const { newsletterSubscribers: t } = schema
  const wasConfirmed = row.status === 'confirmed'
  const unsubscribedAt = new Date()
  await db.update(t).set({ status: 'unsubscribed', unsubscribedAt, sync: null }).where(eq(t.id, row.id))
  if (!wasConfirmed) return
  const left: Subscriber = { ...row, status: 'unsubscribed', unsubscribedAt }
  event.waitUntil(syncRow(event, left, 'remove').catch(error => console.error('[cms] lettre d\'information : retrait de la liste impossible', error)))
  emitCmsEvents(event, [subscriberEvent(event, 'newsletter.unsubscribed', left, await unsubscribeUrl(event, left))])
}

/** Efface un inscrit (demande d'effacement de ses données) et le retire de la liste du service d'envoi. */
export async function eraseSubscriber(event: H3Event, row: Subscriber) {
  await useDb(event).delete(schema.newsletterSubscribers).where(eq(schema.newsletterSubscribers.id, row.id))
  if (row.status === 'confirmed') event.waitUntil(pushToList(event, row, 'remove').catch(() => null))
}

// ───────────── Back-office ─────────────

/** La liste des inscrits contient des adresses e-mail : seuls l'administrateur et l'éditeur la lisent. */
export async function requireNewsletterAccess(event: H3Event) {
  await requireModule(event, 'newsletter')
  const user = await requireUser(event)
  if (user.role !== 'admin' && user.role !== 'editor') throw createError({ statusCode: 403, message: 'La liste des inscrits est réservée aux administrateurs et aux éditeurs.' })
  return user
}

export async function findSubscriber(event: H3Event, id: string) {
  const [row] = await useDb(event).select().from(schema.newsletterSubscribers).where(eq(schema.newsletterSubscribers.id, id))
  if (!row) throw createError({ statusCode: 404, message: 'Inscrit introuvable.' })
  return row
}

export async function newsletterCounts(event: H3Event) {
  const { newsletterSubscribers: t } = schema
  const rows = await useDb(event).select({ status: t.status, n: count() }).from(t).groupBy(t.status)
  const of = (status: string) => rows.find(r => r.status === status)?.n ?? 0
  return { confirmed: of('confirmed'), pending: of('pending'), unsubscribed: of('unsubscribed') }
}

/** Ce que l'écran « Lettre d'information » affiche. */
export async function describeNewsletter(event: H3Event) {
  const db = useDb(event)
  const { newsletterSubscribers: t } = schema
  const [subscribers, counts, mail, settings, provider] = await Promise.all([
    db.select().from(t).orderBy(desc(t.createdAt)).limit(NEWSLETTER.listMax),
    newsletterCounts(event),
    mailStatus(event),
    moduleSettings(event, 'newsletter'),
    contactsProvider(event),
  ])
  // Inscrits confirmés qui ne sont pas (encore) dans la liste du service d'envoi : tous comptés, pas seulement ceux affichés.
  const unsynced = settings.list ? (await db.select({ sync: t.sync }).from(t).where(eq(t.status, 'confirmed'))).filter(r => !r.sync?.ok).length : 0
  return {
    subscribers, counts, max: NEWSLETTER.listMax, pendingDays: NEWSLETTER.pendingDays,
    /** Sans envoi d'e-mails réglé, l'e-mail de confirmation ne part pas : les inscriptions sont refusées. */
    mail,
    /** Liste du service d'envoi : désignée ou non, par quel service, et combien d'inscrits n'y sont pas encore. */
    list: { set: !!settings.list, provider: provider?.label ?? null, unsynced },
  }
}

/** Tous les inscrits, par paquets (la réponse d'une requête D1 est limitée en taille), pour l'export. */
export async function allSubscribers(event: H3Event) {
  const db = useDb(event)
  const { newsletterSubscribers: t } = schema
  const out: Subscriber[] = []
  for (let offset = 0; ; offset += 1000) {
    const chunk = await db.select().from(t).orderBy(desc(t.createdAt), t.id).limit(1000).offset(offset)
    out.push(...chunk)
    if (chunk.length < 1000) break
  }
  return out
}
