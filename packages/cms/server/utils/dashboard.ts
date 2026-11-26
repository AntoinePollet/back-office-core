import { and, count, desc, eq, gt, inArray, ne, sum } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { adminEntryPath } from '../../shared/admin-paths'
import { MODE_LABELS } from '../../shared/availability'
import type { CmsDefinition } from '../../shared/format'
import { audienceModules, canReadAudience } from '../cms-modules/audience'
import { newsletterCounts } from '../cms-modules/newsletter'

type User = Awaited<ReturnType<typeof requireUser>>

/** Une chose à faire, ou à savoir : une ligne de l'accueil du back-office, avec l'écran où la traiter. */
export type DashboardTask = { key: string; label: string; detail?: string; count?: number; to: string; level: 'todo' | 'warning' | 'info' }
/** Un contenu cité sur l'accueil. */
export type DashboardEntry = { type: string; typeLabel: string; id: string; title: string; status: string; at: string; by: string | null; mine: boolean; to: string }
export type DashboardFigure = { key: string; label: string; value: string; hint: string; to: string }
export type DashboardState = { key: string; label: string; value: string; level: 'ok' | 'warning' | 'error'; to: string }

const DAY = 86_400_000
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`

/**
 * L'accueil du back-office : ce qui attend la personne (demandes à valider, messages non lus, programmations en
 * échec…), les contenus sur lesquels elle travaille, et quelques chiffres. Chacun ne voit que ce à quoi il a droit ;
 * rien ici n'est une nouvelle donnée, tout renvoie à l'écran qui la détaille.
 */
export async function dashboard(event: H3Event, user: User) {
  const db = useDb(event)
  const { site } = cmsConfig
  const isAdmin = user.role === 'admin'
  const staff = isAdmin || user.role === 'editor'
  const defs = ([...Object.entries(cmsConfig.singletons ?? {}), ...Object.entries(cmsConfig.collections ?? {})] as [string, CmsDefinition][]).filter(([type]) => can(user, type, 'edit'))
  const types = defs.map(([type]) => type)
  const active = new Set((await activeModules(event)).map(m => m.id))
  const now = Date.now()
  const tasks: DashboardTask[] = []

  // ───── Contenus : modifiés récemment, et en attente de publication ─────
  const { entries, entryLocales } = schema
  const [recentDocs, waitingRows] = types.length
    ? await Promise.all([
        db.select().from(entries).where(inArray(entries.type, types)).orderBy(desc(entries.updatedAt)).limit(40),
        db.select({ id: entryLocales.entryId, type: entryLocales.type, status: entryLocales.status, updatedAt: entryLocales.updatedAt })
          .from(entryLocales).where(and(inArray(entryLocales.type, types), eq(entryLocales.locale, site.defaultLocale), ne(entryLocales.status, 'published')))
          .orderBy(desc(entryLocales.updatedAt)).limit(200),
      ])
    : [[], []]
  const waitingIds = [...new Set(waitingRows.map(r => r.id))]
  const waitingDocs = waitingIds.length ? await db.select().from(entries).where(inArray(entries.id, waitingIds.slice(0, 80))) : []
  const docs = new Map([...recentDocs, ...waitingDocs].map(d => [d.id, d]))
  const visible = (id: string) => { const d = docs.get(id); return !!d && ownsOrFree(user, d.type, d) }
  const recentIds = recentDocs.filter(d => visible(d.id)).slice(0, 8).map(d => d.id)
  // Sans brouillons, enregistrer c'est publier : un tel contenu n'attend jamais de publication.
  const waiting = waitingRows.filter(r => visible(r.id) && findDef(r.type)?.drafts !== false)
  const shownWaiting = waiting.slice(0, 6)

  const cited = [...new Set([...recentIds, ...shownWaiting.map(r => r.id)])]
  const [titles, statuses, authors] = await Promise.all([
    cited.length ? entryTitles(event, cited) : new Map<string, string>(),
    cited.length ? db.select({ id: entryLocales.entryId, status: entryLocales.status }).from(entryLocales).where(and(inArray(entryLocales.entryId, cited), eq(entryLocales.locale, site.defaultLocale))) : [],
    (() => {
      const ids = [...new Set(cited.map(id => docs.get(id)?.updatedBy).filter((id): id is string => !!id))]
      return ids.length ? db.select({ id: schema.user.id, name: schema.user.name }).from(schema.user).where(inArray(schema.user.id, ids)) : []
    })(),
  ])
  const statusOf = new Map(statuses.map(s => [s.id, s.status]))
  const nameOf = new Map(authors.map(a => [a.id, a.name]))
  const toEntry = (id: string, at: Date): DashboardEntry => {
    const doc = docs.get(id)!
    const def = getDef(doc.type)
    return {
      type: doc.type, typeLabel: def.label, id, title: def.kind === 'collection' ? titles.get(id) || 'Sans titre' : def.label,
      status: statusOf.get(id) ?? 'draft', at: at.toISOString(), by: doc.updatedBy ? nameOf.get(doc.updatedBy) ?? null : null, mine: doc.updatedBy === user.id,
      to: adminEntryPath(doc.type, id),
    }
  }

  // ───── À faire ─────
  const { reviewRequests, schedules } = schema
  const [reviews, scheduled] = await Promise.all([
    db.select().from(reviewRequests),
    db.select().from(schedules),
  ])
  const handle = reviews.filter(r => findDef(r.type) && can(user, r.type, 'publish') && r.requestedBy !== user.id).length
  const asked = reviews.filter(r => r.requestedBy === user.id).length
  if (handle) tasks.push({ key: 'reviews', level: 'todo', count: handle, label: plural(handle, 'demande de publication à valider', 'demandes de publication à valider'), to: '/admin/reviews' })
  if (asked) tasks.push({ key: 'my-reviews', level: 'info', count: asked, label: plural(asked, 'de vos demandes de publication attend une réponse', 'de vos demandes de publication attendent une réponse'), to: '/admin/reviews' })
  const mySchedules = scheduled.filter(s => findDef(s.type) && can(user, s.type, 'edit'))
  const failed = mySchedules.filter(s => s.failedAt).length
  const next = mySchedules.filter(s => !s.failedAt).sort((a, b) => a.at.getTime() - b.at.getTime())[0]
  if (failed) tasks.push({ key: 'schedule-failed', level: 'warning', count: failed, label: plural(failed, 'publication programmée a échoué', 'publications programmées ont échoué'), detail: 'Le contenu n\'a pas changé d\'état : voyez pourquoi, puis relancez ou annulez.', to: '/admin/scheduled' })
  const upcoming = mySchedules.length - failed
  if (upcoming && next) tasks.push({ key: 'scheduled', level: 'info', count: upcoming, label: plural(upcoming, 'publication programmée', 'publications programmées'), detail: `Prochaine : ${formatDay(next.at)}.`, to: '/admin/scheduled' })

  if (staff && active.has('forms')) {
    const { formSubmissions } = schema
    const [unread] = await db.select({ n: count() }).from(formSubmissions).where(eq(formSubmissions.read, false))
    if (unread?.n) tasks.push({ key: 'messages', level: 'todo', count: unread.n, label: plural(unread.n, 'message reçu non lu', 'messages reçus non lus'), to: '/admin/forms' })
  }
  if (staff) {
    const { notFound } = schema
    // Ce que cette instance a encore en mémoire est écrit d'abord, comme pour l'écran « Redirections ».
    await flushNotFound(event).catch(() => {})
    const lost = await db.select({ path: notFound.path, hits: notFound.hits }).from(notFound).where(gt(notFound.lastAt, new Date(now - 7 * DAY))).orderBy(desc(notFound.hits)).limit(50)
    if (lost.length) tasks.push({ key: 'not-found', level: 'info', count: lost.length, label: plural(lost.length, 'adresse introuvable demandée cette semaine', 'adresses introuvables demandées cette semaine'), detail: `La plus demandée : ${lost[0]!.path}. Une redirection peut y répondre.`, to: '/admin/redirections' })
  }

  // ───── État du site (administrateur) ─────
  const states: DashboardState[] = []
  if (isAdmin) {
    const [availability, backups, mail] = await Promise.all([
      readAvailability(event).catch(() => null),
      describeBackups(event).catch(() => null),
      mailStatus(event),
    ])
    const mode = availability?.mode ?? 'online'
    states.push({ key: 'availability', label: 'Disponibilité', value: mode === 'online' ? 'En ligne' : `Fermé au public (${MODE_LABELS[mode].toLowerCase()})`, level: mode === 'online' ? 'ok' : 'warning', to: '/admin/availability' })
    if (backups) states.push({ key: 'backups', label: 'Sauvegardes', value: backups.status.title, level: backups.status.level, to: '/admin/backups' })
    states.push({ key: 'mail', label: 'Envoi d\'e-mails', value: mail.configured ? `Réglé (${mail.module!.label})` : 'Non réglé : pas de lien de mot de passe ni de notification', level: mail.configured ? 'ok' : 'warning', to: mail.module ? `/admin/modules/${mail.module.id}` : '/admin/modules' })
    for (const definition of allModules()) {
      if (!active.has(definition.id) || definition.mail) continue
      const state = await describeModule(event, definition)
      if (!state.configured) tasks.push({ key: `module-${definition.id}`, level: 'warning', label: `Module « ${definition.label} » à régler`, detail: `Il manque : ${state.missing.join(', ')}.`, to: `/admin/modules/${definition.id}` })
    }
  }

  // ───── Chiffres des 30 derniers jours ─────
  const figures: DashboardFigure[] = []
  const since = new Date(now - 30 * DAY)
  if (staff && active.has('forms')) {
    const { formSubmissions } = schema
    const [received] = await db.select({ n: count() }).from(formSubmissions).where(gt(formSubmissions.createdAt, since))
    figures.push({ key: 'messages', label: 'Messages reçus', value: String(received?.n ?? 0), hint: '30 derniers jours', to: '/admin/forms' })
  }
  if (staff && active.has('stripe')) {
    const { payments } = schema
    const paid = await db.select({ currency: payments.currency, n: count(), total: sum(payments.amount), refunded: sum(payments.refundedAmount) }).from(payments)
      .where(and(gt(payments.createdAt, since), inArray(payments.status, ['paid', 'refunded']), eq(payments.livemode, true))).groupBy(payments.currency)
    const main = paid.sort((a, b) => b.n - a.n)[0]
    const amount = main ? (Number(main.total ?? 0) - Number(main.refunded ?? 0)) / 100 : 0
    figures.push({
      key: 'payments', label: 'Paiements', to: '/admin/payments', hint: `30 derniers jours · ${plural(main?.n ?? 0, 'paiement', 'paiements')}`,
      value: new Intl.NumberFormat('fr-FR', { style: 'currency', currency: (main?.currency ?? 'eur').toUpperCase(), maximumFractionDigits: amount % 1 ? 2 : 0 }).format(amount),
    })
  }
  if (staff && active.has('newsletter')) {
    const { newsletterSubscribers } = schema
    const [counts, [fresh]] = await Promise.all([
      newsletterCounts(event),
      db.select({ n: count() }).from(newsletterSubscribers).where(and(eq(newsletterSubscribers.status, 'confirmed'), gt(newsletterSubscribers.confirmedAt, since))),
    ])
    figures.push({ key: 'newsletter', label: 'Inscrits à la lettre', value: String(counts.confirmed), hint: `${fresh?.n ? `+${fresh.n}` : 'aucun nouveau'} en 30 jours`, to: '/admin/newsletter' })
  }

  return {
    tasks,
    states,
    figures,
    waiting: { total: waiting.length, items: shownWaiting.map(r => toEntry(r.id, r.updatedAt)) },
    recent: recentIds.map(id => toEntry(id, docs.get(id)!.updatedAt)),
    /** Collections où la personne peut créer un contenu. */
    create: defs.filter(([, def]) => def.kind === 'collection').map(([type, def]) => ({ type, label: (def as { labelSingular?: string }).labelSingular ?? def.label, to: `/admin/${type}/new` })),
    /** L'audience des sept derniers jours est disponible (lue à part : elle dépend d'un service externe). */
    audience: staff && canReadAudience(user) && (await audienceModules(event)).length > 0,
    health: types.length > 0,
  }
}

/** « demain à 9 h », « le 3 décembre à 14 h 30 », à l'heure du site. */
function formatDay(at: Date) {
  const timeZone = siteTimeZone()
  const day = (d: Date) => d.toLocaleDateString('fr-FR', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' })
  const time = at.toLocaleTimeString('fr-FR', { timeZone, hour: '2-digit', minute: '2-digit' })
  const now = new Date()
  if (day(at) === day(now)) return `aujourd'hui à ${time}`
  if (day(at) === day(new Date(now.getTime() + DAY))) return `demain à ${time}`
  return `le ${at.toLocaleDateString('fr-FR', { timeZone, day: 'numeric', month: 'long' })} à ${time}`
}
