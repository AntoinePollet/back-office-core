// Publication programmée (packages/cms/shared/schedule.ts, server/utils/schedule.ts, composant CmsSchedule, écran /admin/scheduled).
// Le temps est avancé en reculant la date prévue dans la base (sqlite3), puis le déclencheur planifié de Cloudflare
// est joué par /_cms/dev-scheduled, qui passe par le même chemin qu'en production.
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { config } from '../lib/config.mjs'
import { check, clickText, login, menuLabels, says, until, wait } from '../lib/harness.mjs'
import { hasSqlite, runSql } from '../lib/sqlite.mjs'

const MARC = { name: 'Marc Petit', email: 'marc@example.com', password: 'mot-de-passe-de-marc', role: 'editor' }
const LINA = { name: 'Lina Roux', email: 'lina@example.com', password: 'mot-de-passe-de-lina', role: 'writer' }
const CRON = '*/5 * * * *'
const PARIS = 'Europe/Paris'

export const meta = {
  title: 'publication programmée : mise en ligne, retrait, fuseau, exécution, repli, échecs, droits, écrans',
  mock: true,
  // En local il n'y a pas de cache à vider : chaque purge est déclarée échouée, ce qui prouve qu'elle est tentée.
  env: () => ({ CMS_DEV_SIMULATE_PURGE_FAILURE: '1' }),
}

/** Fichier de la base locale du serveur de test, pour simuler le temps qui passe. Null si introuvable. */
function databaseFile() {
  const find = (dir) => {
    if (!existsSync(dir)) return null
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { const hit = find(full); if (hit) return hit }
      else if (entry.name.endsWith('.sqlite') && !entry.name.includes('metadata')) return full
    }
    return null
  }
  return find(config.tmpDir)
}

/** Date (AAAA-MM-JJ) dans `days` jours, à Paris, et sa lecture en clair (« le 3 décembre »). */
function parisDay(days) {
  const at = new Date(Date.now() + days * 86_400_000)
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: PARIS, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at).map(p => [p.type, p.value]))
  const month = new Intl.DateTimeFormat('fr-FR', { timeZone: PARIS, month: 'long' }).format(at)
  const year = Number(parts.year) === new Date().getFullYear() ? '' : ` ${parts.year}`
  return { date: `${parts.year}-${parts.month}-${parts.day}`, text: `le ${Number(parts.day) === 1 ? '1er' : Number(parts.day)} ${month}${year}` }
}

export default async function (t) {
  const { step, admin, B, M, info, calls } = t
  const claire = t.http(), marc = t.http(), lina = t.http(), visitor = t.http()
  const page = await t.newPage()
  const ids = {}
  const S = '/api/cms/entries/services'
  const day = parisDay(3), later = parisDay(10)
  const file = () => databaseFile()

  const service = (title, extra = {}) => ({ values: { title, excerpt: 'Résumé.', audience: 'companies', onQuote: false, fromPrice: 150 }, ...extra })
  const create = async (client, title, extra) => (await client.json(S, { method: 'POST', body: service(title, extra) })).id
  const schedule = (client, id, body, type = 'services') => client.put(`/api/cms/entries/${type}/${id}/schedule`, body)
  const planned = async (id, type = 'services') => (await claire.json(`/api/cms/entries/${type}/${id}`)).schedules
  const online = async (slug, locale = 'fr') => (await visitor.get(`/api/content/services/${slug}?locale=${locale}`)).status === 200
  const sitemap = async () => (await visitor.get('/sitemap.xml')).text
  /** Fait arriver l'heure prévue : recule la date en base d'un contenu (toutes ses programmations, ou une action). */
  const due = (id, { action, ago = 60_000 } = {}) => {
    runSql(file(), `update cms_schedules set at = ${Date.now() - ago} where entry_id = '${id}'${action ? ` and action = '${action}'` : ''}`)
  }
  /** Joue le déclencheur planifié fréquent, comme Cloudflare toutes les 5 minutes. */
  const tick = (cron = CRON) => visitor.json('/_cms/dev-scheduled', { method: 'POST', body: { cron, scheduledTime: Date.now() } })
  const journal = async () => (await claire.json('/api/cms/activity?limit=100')).items
  const logged = test => until(async () => (await journal()).find(l => (typeof test === 'string' ? l.summary === test : test.test(l.summary))), 'ligne du journal : ' + test)
  const runs = async () => claire.json('/api/cms/workflow-runs')
  const revisions = id => claire.json(`${S}/${id}/revisions`)

  let sqlite = true
  await step('préparation : comptes, workflows, outil sqlite3', async () => {
    check((await claire.signIn(admin.email, admin.password)).status === 200, 'connexion de l\'administratrice refusée')
    for (const [who, client] of [[MARC, marc], [LINA, lina]]) {
      const { id, link } = await claire.json('/api/cms/users', { method: 'POST', body: { name: who.name, email: who.email, role: who.role } })
      who.id = id
      check((await visitor.post(link.replace(/^.*\/admin\/invite\//, '/api/cms/invite/'), { password: who.password })).status === 200, 'mot de passe refusé pour ' + who.name)
      check((await client.signIn(who.email, who.password)).status === 200, 'connexion refusée pour ' + who.name)
    }
    const catalog = (await claire.json('/api/cms/workflows')).events
    const failed = catalog.find(e => e.name === 'schedule.failed')
    check(failed?.label === 'Une publication programmée a échoué', 'déclencheur proposé : ' + JSON.stringify(failed))
    check(failed.variables.some(v => v.key === 'schedule.error') && failed.targets.some(x => x.key === 'services') && !failed.targets.some(x => x.key === 'categories'), 'variables et cibles : ' + JSON.stringify(failed))
    for (const event of ['entry.published', 'entry.unpublished', 'schedule.failed'])
      await claire.json('/api/cms/workflows', { method: 'POST', body: { name: 'Suivi ' + event, trigger: { event, types: [] }, actions: [{ kind: 'webhook', url: `${M}/suivi` }] } })
    sqlite = hasSqlite()
    check(sqlite, 'l\'outil sqlite3 est nécessaire à cette suite (il sert à faire arriver l\'heure prévue)')
  })
  if (!sqlite) return

  await step('programmer une mise en ligne : heure de Paris, instant en base, rien sur le site, journal', async () => {
    ids.noel = await create(claire, 'Offre de Noël')
    const r = await schedule(claire, ids.noel, { action: 'publish', date: day.date, time: '09:00' })
    check(r.status === 200, `statut ${r.status} ${r.text.slice(0, 200)}`)
    const [s] = r.json.schedules
    check(r.json.schedules.length === 1 && s.locale === 'fr' && s.action === 'publish' && s.by === 'Claire Durand' && !s.failedAt, JSON.stringify(r.json.schedules))
    // 9 h à Paris : 8 h en heure universelle l'hiver, 7 h l'été.
    const hour = new Date(s.at).getUTCHours()
    check(s.at.endsWith(':00:00.000Z') && (hour === 8 || hour === 7), 'instant enregistré : ' + s.at)
    check(new Intl.DateTimeFormat('fr-FR', { timeZone: PARIS, hour: '2-digit', minute: '2-digit' }).format(new Date(s.at)) === '09:00', 'heure à Paris : ' + s.at)
    check(r.json.trigger === 'missing', 'aucun déclencheur fréquent n\'est encore passé : ' + r.json.trigger)
    check(!(await online('offre-de-noel')), 'le brouillon programmé ne doit pas être en ligne')
    check(!(await sitemap()).includes('offre-de-noel'), 'le brouillon programmé ne doit pas être au plan du site')
    const doc = await claire.json(`${S}/${ids.noel}`)
    check(doc.locales.fr.status === 'draft' && doc.schedules.length === 1, 'le formulaire reçoit la programmation')
    const item = (await claire.json(S)).find(i => i.id === ids.noel)
    check(item.scheduled.length === 1 && item.scheduled[0].action === 'publish' && item.scheduled[0].failed === false, 'liste : ' + JSON.stringify(item.scheduled))
    await logged(`Claire Durand a programmé la mise en ligne de « Offre de Noël » (Services, français) pour ${day.text} à 9 h 00 (heure de Paris)`)
  })

  await step('refus : heure passée ou qui n\'existe pas, instant sans décalage, contenu incomplet, rien à faire, sans brouillons', async () => {
    const no = async (id, body, status, pattern, type) => {
      const r = await schedule(claire, id, body, type)
      check(r.status === status && pattern.test(r.json?.message ?? ''), `attendu ${status} ${pattern} : ${r.status} ${r.text.slice(0, 200)}`)
      return r
    }
    await no(ids.noel, { action: 'publish', date: '2020-01-01', time: '09:00' }, 400, /déjà passée \(heure de Paris\)/)
    await no(ids.noel, { action: 'publish', date: '2027-03-28', time: '02:30' }, 400, /n'existe pas ce jour-là/)
    await no(ids.noel, { action: 'publish', at: `${day.date}T09:00` }, 400, /décalage/)
    await no(ids.noel, { action: 'publish', date: day.date }, 400, /Indiquez l'heure/)
    await no(ids.noel, { action: 'later', date: day.date, time: '09:00' }, 400, /publish/)
    await no(ids.noel, { action: 'publish', date: day.date, time: '09:00', locales: ['de'] }, 400, /langues du site/)
    await no(ids.noel, { action: 'publish', date: day.date, time: '09:00', locales: ['en'] }, 400, /Anglais : Il n'y a encore rien dans cette langue/)
    // Un retrait à la même heure que la mise en ligne, ou avant elle alors que le contenu n'est pas en ligne.
    await no(ids.noel, { action: 'unpublish', date: day.date, time: '09:00' }, 400, /même heure/)
    await no(ids.noel, { action: 'unpublish', date: day.date, time: '08:00' }, 400, /pas en ligne/)
    // Mêmes vérifications qu'une publication : un brouillon incomplet ne se programme pas, et les champs sont désignés.
    ids.incomplete = (await claire.json(S, { method: 'POST', body: { values: { title: 'Incomplet' } } })).id
    const r = await no(ids.incomplete, { action: 'publish', date: day.date, time: '09:00' }, 422, /à corriger avant de programmer/)
    check(r.json.data.errors.fr.fromPrice, 'champs en défaut : ' + JSON.stringify(r.json.data))
    check((await planned(ids.incomplete)).length === 0, 'rien ne doit être programmé')
    // Déjà en ligne, sans modification en attente : rien à mettre en ligne.
    ids.live = await create(claire, 'Droit social', { publish: ['fr'] })
    await no(ids.live, { action: 'publish', date: day.date, time: '09:00' }, 400, /déjà en ligne/)
    // Sans brouillons, enregistrer c'est publier : la programmation n'est pas proposée.
    const cat = await claire.json('/api/cms/entries/categories', { method: 'POST', body: { values: { name: 'Conseil' } } })
    await no(cat.id, { action: 'publish', date: day.date, time: '09:00' }, 400, /n'a pas de brouillon/, 'categories')
    check((await schedule(claire, 'inconnu', { action: 'publish', date: day.date, time: '09:00' })).status === 404, 'contenu inconnu')
  })

  await step('avant l\'heure, le déclencheur ne fait rien ; à l\'heure, le contenu apparaît (API, page, plan du site)', async () => {
    const before = (await journal()).length
    await tick()
    check(!(await online('offre-de-noel')) && (await planned(ids.noel)).length === 1, 'rien ne doit se passer avant l\'heure')
    due(ids.noel)
    await tick()
    const r = await visitor.get('/api/content/services/offre-de-noel')
    check(r.status === 200 && r.json.title === 'Offre de Noël' && r.json.status === 'published', `API : ${r.status} ${r.text.slice(0, 200)}`)
    check(Math.abs(Date.now() - new Date(r.json.publishedAt).getTime()) < 60_000, 'date de publication : ' + r.json.publishedAt)
    check((await visitor.json('/api/content/services')).some(s => s.title === 'Offre de Noël'), 'liste publique')
    const html = await visitor.get('/services/offre-de-noel')
    check(html.status === 200 && html.text.includes('Offre de Noël'), 'page du site : ' + html.status)
    check((await sitemap()).includes('/services/offre-de-noel'), 'plan du site')
    check((await planned(ids.noel)).length === 0, 'la programmation exécutée disparaît')
    check((await claire.json(S)).find(i => i.id === ids.noel).scheduled.length === 0, 'la liste n\'affiche plus « Programmé »')
    check((await journal()).length > before, 'le journal a bougé')
  })

  await step('exécution : historique, journal (purge du cache tentée), événement de workflow au nom de qui a programmé', async () => {
    const [last] = await revisions(ids.noel)
    check(last.origin === 'schedule' && last.author === 'Claire Durand' && last.published.join() === 'fr', 'historique : ' + JSON.stringify(last))
    // La purge est simulée en échec : la ligne le dit, ce qui prouve qu'elle a été tentée à l'exécution.
    const line = await logged('Mise en ligne automatique de « Offre de Noël » (Services, français), programmée par Claire Durand. Le cache du site n\'a pas pu être vidé : le site peut mettre jusqu\'à une heure à le montrer')
    check(line.actorName === null && line.category === 'content' && line.action === 'schedule.published', 'ligne automatique : ' + JSON.stringify(line))
    check(!(await journal()).some(l => l.summary === 'Claire Durand a publié « Offre de Noël » (Services, français)'), 'pas de seconde ligne « a publié »')
    const run = await until(async () => (await runs()).find(r => r.event === 'entry.published' && r.summary.includes('Offre de Noël')), 'workflow « publié »')
    check(run.status === 'success', 'workflow : ' + JSON.stringify(run))
    const hook = await until(() => calls().find(c => c.url === '/suivi' && c.body?.entry?.title === 'Offre de Noël'), 'appel du workflow')
    check(hook.body.user.email === admin.email && hook.body.entry.url.endsWith('/services/offre-de-noel') && hook.body.event.name === 'entry.published', 'données : ' + JSON.stringify(hook.body))
    // Le déclencheur fréquent est noté : l'interface peut promettre l'heure.
    check((await claire.json('/api/cms/schedules')).trigger === 'ok', 'déclencheur vu')
  })

  await step('le déclencheur fréquent ne refait pas la sauvegarde de nuit ; celui de la nuit traite aussi les publications', async () => {
    // Premier passage : aucune sauvegarde n'existait, le déclencheur fréquent a rattrapé ce retard. Les suivants n'en refont pas.
    const count = async () => (await claire.json('/api/cms/backups')).items.length
    const n = await count()
    check(n === 1, 'sauvegardes après les premiers passages : ' + n)
    await tick()
    await tick()
    check(await count() === n, 'pas de nouvelle sauvegarde à chaque passage')
    ids.night = await create(claire, 'Publié par la tâche de nuit')
    check((await schedule(claire, ids.night, { action: 'publish', date: day.date, time: '03:00' })).status === 200, 'programmation')
    due(ids.night)
    await tick('17 3 * * *')
    check(await online('publie-par-la-tache-de-nuit'), 'un site resté à un seul déclencheur de nuit publie quand même, à son passage')
  })

  await step('modification entre-temps : c\'est le brouillon de l\'heure dite qui part ; une rédactrice ne peut plus le modifier', async () => {
    ids.rentree = await create(marc, 'Offre de rentrée')
    check((await schedule(marc, ids.rentree, { action: 'publish', date: day.date, time: '14:30' })).status === 200, 'programmation par l\'éditeur')
    // Lina peut préparer des brouillons mais pas publier : modifier ce contenu reviendrait à publier sans relecture.
    const refused = await lina.put(`${S}/${ids.rentree}`, { values: { title: 'Offre modifiée par Lina' } })
    check(refused.status === 403 && /programmée .* à 14 h 30 \(heure de Paris\) par Marc Petit/.test(refused.json.message), `rédactrice : ${refused.status} ${refused.text.slice(0, 300)}`)
    // Un enregistrement qui ne change rien n'est pas refusé.
    check((await lina.put(`${S}/${ids.rentree}`, { values: { title: 'Offre de rentrée' } })).status === 200, 'enregistrement sans changement')
    // Claire peut publier : elle corrige le brouillon, la programmation reste.
    await claire.json(`${S}/${ids.rentree}`, { method: 'PUT', body: { values: { title: 'Offre de rentrée 2027', excerpt: 'Corrigé la veille.' } } })
    check((await planned(ids.rentree)).length === 1, 'la programmation survit à une modification')
    due(ids.rentree)
    await tick()
    const r = await visitor.get('/api/content/services/offre-de-rentree')
    check(r.status === 200 && r.json.title === 'Offre de rentrée 2027' && r.json.excerpt === 'Corrigé la veille.', `le brouillon modifié est en ligne : ${r.status} ${r.text.slice(0, 200)}`)
    const hook = await until(() => calls().find(c => c.url === '/suivi' && c.body?.entry?.title === 'Offre de rentrée 2027'), 'appel du workflow')
    check(hook.body.user.email === MARC.email, 'auteur de l\'événement : ' + hook.body.user.email)
    await logged('Mise en ligne automatique de « Offre de rentrée 2027 » (Services, français), programmée par Marc Petit. Le cache du site n\'a pas pu être vidé : le site peut mettre jusqu\'à une heure à le montrer')
    check((await revisions(ids.rentree))[0].author === 'Marc Petit', 'auteur de la version')
    // Après l'exécution, la rédactrice peut de nouveau préparer un brouillon.
    check((await lina.put(`${S}/${ids.rentree}`, { values: { excerpt: 'Proposition de Lina.' } })).status === 200, 'la rédactrice modifie de nouveau')
  })

  await step('modifications en attente d\'un contenu publié, et page unique : programmées puis mises en ligne', async () => {
    await claire.json(`${S}/${ids.live}`, { method: 'PUT', body: { values: { excerpt: 'Nouveau résumé, pour janvier.' } } })
    check((await claire.json(`${S}/${ids.live}`)).locales.fr.status === 'changed', 'modifications en attente')
    check((await schedule(claire, ids.live, { action: 'publish', date: day.date, time: '08:00' })).status === 200, 'programmation des modifications')
    await claire.json('/api/cms/entries/home/home', { method: 'PUT', body: { values: { heroTitle: 'Bienvenue' }, publish: ['fr'] } })
    await claire.json('/api/cms/entries/home/home', { method: 'PUT', body: { values: { heroTitle: 'Bonne année' } } })
    const r = await schedule(claire, 'home', { action: 'publish', date: day.date, time: '00:00' }, 'home')
    check(r.status === 200 && r.json.schedules.length === 1, `page unique : ${r.status} ${r.text.slice(0, 200)}`)
    check((await visitor.json('/api/content/services/droit-social')).excerpt === 'Résumé.' && (await visitor.json('/api/content/home')).heroTitle === 'Bienvenue', 'le site ne change pas avant l\'heure')
    due(ids.live)
    due('home')
    await tick()
    check((await visitor.json('/api/content/services/droit-social')).excerpt === 'Nouveau résumé, pour janvier.', 'modifications en ligne')
    check((await visitor.json('/api/content/home')).heroTitle === 'Bonne année', 'page unique en ligne')
    await logged(/^Mise en ligne automatique de la page « Accueil » \(français\), programmée par Claire Durand/)
  })

  await step('retrait programmé : le contenu quitte le site à l\'heure, le brouillon reste', async () => {
    const r = await schedule(claire, ids.noel, { action: 'unpublish', date: later.date, time: '18:00' })
    check(r.status === 200 && r.json.schedules[0].action === 'unpublish', `statut ${r.status} ${r.text.slice(0, 200)}`)
    await logged(`Claire Durand a programmé le retrait du site de « Offre de Noël » (Services, français) pour ${later.text} à 18 h 00 (heure de Paris)`)
    check((await claire.json(S)).find(i => i.id === ids.noel).scheduled[0].action === 'unpublish', 'liste')
    await tick()
    check(await online('offre-de-noel'), 'toujours en ligne avant l\'heure')
    due(ids.noel)
    await tick()
    check(!(await online('offre-de-noel')), 'retiré de l\'API')
    check((await visitor.get('/services/offre-de-noel')).status === 404, 'page 404')
    check(!(await sitemap()).includes('offre-de-noel'), 'retiré du plan du site')
    const doc = await claire.json(`${S}/${ids.noel}`)
    check(doc.locales.fr.status === 'draft' && doc.locales.fr.values.title === 'Offre de Noël' && doc.schedules.length === 0, 'le brouillon reste, sans programmation')
    const [last] = await revisions(ids.noel)
    check(last.origin === 'schedule' && last.unpublished.join() === 'fr', 'historique : ' + JSON.stringify(last))
    await logged(/^Retrait automatique du site de « Offre de Noël » \(Services, français\), programmé par Claire Durand/)
    const run = await until(async () => (await runs()).find(x => x.event === 'entry.unpublished' && x.summary.includes('Offre de Noël')), 'workflow « retiré »')
    check(run.status === 'success', JSON.stringify(run))
  })

  await step('une offre : mise en ligne puis retrait programmés ensemble, exécutés dans l\'ordre', async () => {
    ids.soldes = await create(claire, 'Soldes')
    check((await schedule(claire, ids.soldes, { action: 'publish', date: day.date, time: '09:00' })).status === 200, 'mise en ligne')
    const r = await schedule(claire, ids.soldes, { action: 'unpublish', date: later.date, time: '09:00' })
    check(r.status === 200 && r.json.schedules.map(s => s.action).join() === 'publish,unpublish', `retrait après la mise en ligne : ${r.status} ${r.text.slice(0, 200)}`)
    due(ids.soldes, { action: 'publish' })
    await tick()
    check(await online('soldes') && (await planned(ids.soldes)).map(s => s.action).join() === 'unpublish', 'en ligne, retrait encore prévu')
    due(ids.soldes)
    await tick()
    check(!(await online('soldes')) && (await planned(ids.soldes)).length === 0, 'retiré')
    // Les deux échéances passées d'un coup (déclencheur en retard) : l'ordre des dates est respecté.
    ids.flash = await create(claire, 'Vente flash')
    await schedule(claire, ids.flash, { action: 'publish', date: day.date, time: '09:00' })
    await schedule(claire, ids.flash, { action: 'unpublish', date: later.date, time: '09:00' })
    due(ids.flash, { action: 'publish', ago: 120_000 })
    due(ids.flash, { action: 'unpublish', ago: 60_000 })
    await tick()
    const list = await revisions(ids.flash)
    check(!(await online('vente-flash')) && list[0].unpublished.join() === 'fr' && list[1].published.join() === 'fr', 'ordre : ' + JSON.stringify(list.map(x => [x.published, x.unpublished])))
  })

  await step('modifier l\'heure, annuler ; publier à la main répond à la programmation', async () => {
    ids.cancel = await create(claire, 'À annuler')
    await schedule(claire, ids.cancel, { action: 'publish', date: day.date, time: '09:00' })
    const moved = await schedule(marc, ids.cancel, { action: 'publish', date: later.date, time: '10:15' })
    check(moved.status === 200 && moved.json.schedules.length === 1 && moved.json.schedules[0].by === 'Marc Petit', 'une seule programmation, déplacée : ' + moved.text.slice(0, 200))
    await logged(`Marc Petit a reprogrammé la mise en ligne de « À annuler » (Services, français) pour ${later.text} à 10 h 15 (heure de Paris)`)
    const r = await claire.del(`${S}/${ids.cancel}/schedule?action=publish`)
    check(r.status === 200 && r.json.cancelled === 1 && r.json.schedules.length === 0, `annulation : ${r.status} ${r.text.slice(0, 200)}`)
    await logged(`Claire Durand a annulé la mise en ligne programmée de « À annuler » (Services, français), prévue ${later.text} à 10 h 15 (heure de Paris)`)
    await tick()
    check(!(await online('a-annuler')), 'rien n\'est publié après une annulation')
    // Publier à la main : la mise en ligne programmée n'a plus d'objet.
    await schedule(claire, ids.cancel, { action: 'publish', date: day.date, time: '09:00' })
    const saved = await claire.json(`${S}/${ids.cancel}`, { method: 'PUT', body: { values: {}, publish: ['fr'] } })
    check(saved.schedules.length === 0 && saved.locales.fr.status === 'published', 'publication à la main : ' + JSON.stringify(saved.schedules))
    // Retirer à la main : le retrait programmé n'a plus d'objet.
    await schedule(claire, ids.cancel, { action: 'unpublish', date: day.date, time: '09:00' })
    const out = await claire.json(`${S}/${ids.cancel}`, { method: 'PUT', body: { unpublish: ['fr'] } })
    check(out.schedules.length === 0, 'retrait à la main : ' + JSON.stringify(out.schedules))
  })

  await step('contenu devenu invalide : rien n\'est publié, l\'échec est lisible (formulaire, liste, journal, workflow)', async () => {
    ids.broken = await create(claire, 'Devenu incomplet')
    await schedule(claire, ids.broken, { action: 'publish', date: day.date, time: '09:00' })
    await claire.json(`${S}/${ids.broken}`, { method: 'PUT', body: { values: { fromPrice: null } } })
    due(ids.broken)
    await tick()
    check(!(await online('devenu-incomplet')), 'un contenu incomplet ne doit pas être publié')
    const [s] = await planned(ids.broken)
    check(s?.failedAt && /^Le contenu n'est plus complet\. « Tarif à partir de » : Ce champ est obligatoire\. Corrigez/.test(s.error) && /Corrigez, puis publiez ou reprogrammez\.$/.test(s.error), 'échec enregistré : ' + JSON.stringify(s))
    info(s.error)
    check((await claire.json(S)).find(i => i.id === ids.broken).scheduled[0].failed === true, 'liste : en échec')
    const line = await logged(/^La mise en ligne programmée de « Devenu incomplet » \(Services, français\) par Claire Durand a échoué : Le contenu n'est plus complet\. « Tarif à partir de »/)
    check(line.actorName === null && line.action === 'schedule.failed', JSON.stringify(line))
    const run = await until(async () => (await runs()).find(x => x.event === 'schedule.failed'), 'workflow « une publication programmée a échoué »')
    check(run.status === 'success' && run.summary === 'La mise en ligne programmée de « Devenu incomplet » (Services, français) a échoué', JSON.stringify(run))
    const hook = calls().find(c => c.url === '/suivi' && c.body?.schedule)
    check(hook.body.schedule.action === 'mise en ligne' && hook.body.schedule.by === 'Claire Durand' && /Tarif/.test(hook.body.schedule.error) && hook.body.schedule.date.includes('heure de Paris') && hook.body.entry.adminUrl.includes(`/admin/services/${ids.broken}`), 'données : ' + JSON.stringify(hook.body))
    // Un échec n'est pas retenté tout seul.
    const before = (await runs()).length
    await tick()
    check((await runs()).length === before && (await planned(ids.broken))[0].failedAt === s.failedAt, 'pas de nouvelle tentative')
    // Corriger puis reprogrammer remplace l'échec ; ici on l'écarte.
    const r = await claire.del(`${S}/${ids.broken}/schedule`)
    check(r.json.cancelled === 1 && r.json.schedules.length === 0, 'écarter : ' + r.text.slice(0, 200))
    await logged('Claire Durand a écarté la mise en ligne programmée de « Devenu incomplet » (Services, français), qui avait échoué')
  })

  await step('droits au moment d\'exécuter : qui a programmé ne peut plus publier, ou son compte n\'existe plus', async () => {
    ids.rights = await create(marc, 'Programmé par Marc')
    ids.gone = await create(marc, 'Compte supprimé')
    await schedule(marc, ids.rights, { action: 'publish', date: day.date, time: '09:00' })
    check((await claire.call(`/api/cms/users/${MARC.id}`, { method: 'PATCH', body: { role: 'writer' } })).status === 200, 'changement de rôle')
    due(ids.rights)
    await tick()
    check(!(await online('programme-par-marc')), 'pas de publication sans le droit de publier')
    const [s] = await planned(ids.rights)
    check(s.failedAt && s.error === 'Marc Petit, qui avait programmé, n\'a plus le droit de publier ce contenu. Publiez à la main, ou reprogrammez.', 'échec : ' + JSON.stringify(s))
    // Devenu rédacteur, Marc ne peut plus programmer ni annuler.
    check((await schedule(marc, ids.gone, { action: 'publish', date: day.date, time: '09:00' })).status === 403, 'programmer sans droit de publier')
    check((await marc.del(`${S}/${ids.rights}/schedule`)).status === 403, 'annuler sans droit de publier')
    // Claire reprogramme à son nom : l'échec est remplacé.
    const again = await schedule(claire, ids.rights, { action: 'publish', date: day.date, time: '09:00' })
    check(again.json.schedules.length === 1 && !again.json.schedules[0].failedAt && again.json.schedules[0].by === 'Claire Durand', 'reprogrammé : ' + again.text.slice(0, 200))
    await claire.json(`${S}/${ids.rights}/schedule`, { method: 'DELETE' })

    check((await claire.call(`/api/cms/users/${MARC.id}`, { method: 'PATCH', body: { role: 'editor' } })).status === 200, 'retour au rôle éditeur')
    await schedule(marc, ids.gone, { action: 'publish', date: day.date, time: '09:00' })
    check((await claire.del(`/api/cms/users/${MARC.id}`)).status === 200, 'suppression du compte')
    due(ids.gone)
    await tick()
    const [g] = await planned(ids.gone)
    check(!(await online('compte-supprime')) && g.failedAt && /^Le compte de Marc Petit, qui avait programmé, n'existe plus\./.test(g.error), 'échec : ' + JSON.stringify(g))
    await claire.json(`${S}/${ids.gone}/schedule`, { method: 'DELETE' })
  })

  await step('droits : une rédactrice ne programme pas ; visiteur et route interne refusés', async () => {
    ids.lina = await create(claire, 'Brouillon de Lina')
    const r = await schedule(lina, ids.lina, { action: 'publish', date: day.date, time: '09:00' })
    check(r.status === 403 && /pas le publier/.test(r.json.message), `rédactrice : ${r.status} ${r.text.slice(0, 200)}`)
    check((await lina.del(`${S}/${ids.lina}/schedule`)).status === 403, 'annulation par la rédactrice')
    check((await visitor.put(`${S}/${ids.lina}/schedule`, { action: 'publish', date: day.date, time: '09:00' })).status === 401, 'visiteur')
    check((await visitor.get('/api/cms/schedules')).status === 401, 'liste : visiteur')
    check((await visitor.post('/_cms/scheduled', { cron: CRON })).status === 404, 'la route interne n\'existe pas pour l\'extérieur')
    // Elle voit en revanche ce qui est programmé sur les contenus qu'elle peut ouvrir, sans pouvoir y toucher.
    await schedule(claire, ids.lina, { action: 'publish', date: later.date, time: '09:00' })
    const mine = (await lina.json('/api/cms/schedules')).items.find(i => i.id === ids.lina)
    check(mine && mine.canManage === false && mine.title === 'Brouillon de Lina' && mine.by === 'Claire Durand', 'vu par la rédactrice : ' + JSON.stringify(mine))
  })

  await step('deux langues : programmées ensemble, publiées ensemble ; une langue devenue invalide n\'empêche pas l\'autre', async () => {
    const both = title => service(title, { translations: { en: { values: { title: title + ' (EN)', excerpt: 'Summary.' } } } })
    ids.duo = (await claire.json(S, { method: 'POST', body: both('Deux langues') })).id
    const r = await schedule(claire, ids.duo, { action: 'publish', date: day.date, time: '09:00' })
    check(r.status === 200 && r.json.schedules.map(s => s.locale).sort().join() === 'en,fr', 'les deux langues par défaut : ' + r.text.slice(0, 300))
    await logged(`Claire Durand a programmé la mise en ligne de « Deux langues » (Services, français et anglais) pour ${day.text} à 9 h 00 (heure de Paris)`)
    due(ids.duo)
    await tick()
    check(await online('deux-langues') && await online('deux-langues-en', 'en'), 'les deux langues sont en ligne')
    const [last] = await revisions(ids.duo)
    check(last.published.slice().sort().join() === 'en,fr' && last.origin === 'schedule', 'une seule version pour les deux langues : ' + JSON.stringify(last))
    await logged(/^Mise en ligne automatique de « Deux langues » \(Services, français et anglais\), programmée par Claire Durand/)
    const map = await sitemap()
    check(map.includes('/services/deux-langues') && map.includes('/en/services/deux-langues-en'), 'plan du site dans les deux langues')

    // Une seule langue programmée : l'autre reste en brouillon.
    ids.solo = (await claire.json(S, { method: 'POST', body: both('Une langue') })).id
    const one = await schedule(claire, ids.solo, { action: 'publish', date: day.date, time: '09:00', locales: ['en'] })
    check(one.json.schedules.length === 1 && one.json.schedules[0].locale === 'en', 'une langue : ' + one.text.slice(0, 200))
    due(ids.solo)
    await tick()
    check(await online('une-langue-en', 'en') && !(await online('une-langue')), 'seul l\'anglais est en ligne')

    // L'anglais devient incomplet après la programmation : le français part en ligne, l'anglais échoue.
    ids.half = (await claire.json(S, { method: 'POST', body: both('À moitié') })).id
    await schedule(claire, ids.half, { action: 'publish', date: day.date, time: '09:00' })
    await claire.json(`${S}/${ids.half}`, { method: 'PUT', body: { locale: 'en', values: { title: null } } })
    due(ids.half)
    await tick()
    const left = await planned(ids.half)
    check(await online('a-moitie') && !(await online('a-moitie-en', 'en')), 'français en ligne, anglais non')
    check(left.length === 1 && left[0].locale === 'en' && /« Titre » : Ce champ est obligatoire \(anglais\)/.test(left[0].error), 'échec de l\'anglais seulement : ' + JSON.stringify(left))
    await claire.json(`${S}/${ids.half}/schedule`, { method: 'DELETE' })
  })

  await step('repli sans déclencheur : la première lecture après l\'heure met en ligne ; le cache ne dépasse pas l\'échéance', async () => {
    ids.fallback = await create(claire, 'Sans déclencheur')
    const cached = async () => (await visitor.get('/api/content/services')).headers.get('cache-control')
    // Sur un serveur Node, aucun cache partagé ne garde les réponses : il n'y a pas de durée à raccourcir.
    const shared = config.target !== 'node'
    check(shared ? /s-maxage=3600/.test(await cached()) : config.siteCached(await cached()), 'cache habituel : ' + await cached())
    const at = new Date(Date.now() + 4000).toISOString()
    const r = await schedule(claire, ids.fallback, { action: 'publish', at })
    check(r.status === 200 && r.json.schedules[0].at === at, `instant complet accepté : ${r.status} ${r.text.slice(0, 200)}`)
    // Une réponse publique n'est pas gardée en cache au-delà de l'échéance : une vieille page ne masquera pas la nouvelle.
    const header = await cached()
    const seconds = Number(/s-maxage=(\d+)/.exec(header)?.[1])
    check(shared ? seconds >= 1 && seconds <= 4 : config.siteCached(header), 'durée de cache avant l\'échéance : ' + header)
    check(!(await online('sans-declencheur')), 'pas encore en ligne')
    await wait(Math.max(0, new Date(at).getTime() - Date.now()) + 300)
    // Aucun déclencheur n'est joué : c'est cette lecture qui exécute l'échéance, avant de répondre.
    const first = await visitor.get('/api/content/services/sans-declencheur')
    check(first.status === 200 && first.json.title === 'Sans déclencheur', `première lecture après l'heure : ${first.status} ${first.text.slice(0, 200)}`)
    check((await planned(ids.fallback)).length === 0, 'programmation exécutée')
    check(!shared || /s-maxage=3600/.test(await cached()) || Number(/s-maxage=(\d+)/.exec(await cached())?.[1]) > 4, 'le cache reprend sa durée : ' + await cached())
    await logged(/^Mise en ligne automatique de « Sans déclencheur » \(Services, français\), programmée par Claire Durand/)
    // La page du site déclenche le repli de la même façon (ici pour un retrait).
    const off = new Date(Date.now() + 3000).toISOString()
    check((await schedule(claire, ids.fallback, { action: 'unpublish', at: off })).status === 200, 'retrait programmé')
    await wait(3300)
    check((await visitor.get('/services/sans-declencheur')).status === 404, 'la page n\'est plus servie à la première visite après l\'heure')
  })

  await step('corbeille et duplication : un contenu supprimé perd sa programmation, une copie n\'en hérite pas', async () => {
    ids.trash = await create(claire, 'À supprimer')
    await schedule(claire, ids.trash, { action: 'publish', date: day.date, time: '09:00' })
    const copy = await claire.json(`${S}/${ids.trash}/duplicate`, { method: 'POST' })
    check(copy.schedules.length === 0 && copy.id !== ids.trash, 'la copie n\'est pas programmée : ' + JSON.stringify(copy.schedules))
    const gone = await claire.json(`${S}/${ids.trash}`, { method: 'DELETE' })
    check(!(await claire.json('/api/cms/schedules')).items.some(i => i.id === ids.trash), 'la programmation disparaît avec le contenu')
    const back = await claire.json(`/api/cms/trash/${gone.trashId}/restore`, { method: 'POST' })
    check(back, 'restauration')
    check((await planned(ids.trash)).length === 0, 'le contenu restauré n\'est plus programmé')
    await tick()
    check(!(await online('a-supprimer')), 'rien n\'est publié')
  })

  // ───── Écrans ─────

  const setInput = (sel, value) => page.$eval(sel, (el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
  const shot = name => page.screenshot({ path: path.join(config.resultsDir, `22-programmation-${name}.png`) })
  const opened = async () => {
    await page.waitForFunction(() => { const d = document.querySelector('[data-cms-schedule="dialog"]'); const box = d?.querySelector('.modal-box'); return box && getComputedStyle(box).opacity === '1' && getComputedStyle(d).opacity === '1' })
    await wait(350) // fin de l'animation d'ouverture, pour les captures
  }

  await step('formulaire : « Programmer… » à côté de « Publier », fenêtre avec le rappel du fuseau', async () => {
    ids.ui = await create(claire, 'Offre de printemps')
    await login(page, B)
    await page.goto(`${B}/admin/services/${ids.ui}`)
    await says(page, 'Offre de printemps')
    const buttons = await page.$$eval('.sticky button', list => list.map(b => b.textContent.trim()))
    check(buttons.join(' | ').includes('Enregistrer le brouillon | Programmer… | Publier'), 'boutons de l\'en-tête : ' + buttons.join(' | '))
    await page.$eval('[data-cms-schedule="open"]', b => b.click())
    await opened()
    const text = await page.$eval('[data-cms-schedule="dialog"]', d => d.innerText)
    check(text.includes('Mettre en ligne') && text.includes('Retirer du site') && text.includes('C\'est l\'heure du site : heure de Paris'), 'fenêtre : ' + text)
    check(text.includes('tel qu\'il sera à ce moment-là'), 'explication du brouillon : ' + text)
    await says(page, 'à 5 minutes près')
    check(await page.$eval('[data-cms-schedule="time"]', el => el.value) === '09:00', 'heure proposée')
    // Retrait impossible pour un brouillon : l'option est grisée.
    check(await page.$$eval('[data-cms-schedule="dialog"] input[type=radio]', r => r.map(x => x.disabled).join()) === 'false,true', 'options')
    // Une heure passée est refusée dès la saisie.
    await setInput('[data-cms-schedule="date"]', '2020-01-01')
    await says(page, 'Cette heure est déjà passée.')
    check(await page.$eval('[data-cms-schedule="submit"]', b => b.disabled), 'bouton désactivé')
    await setInput('[data-cms-schedule="date"]', day.date)
    await setInput('[data-cms-schedule="time"]', '14:30')
    await shot('fenetre')
    await page.$eval('[data-cms-schedule="submit"]', b => b.click())
    await says(page, `Mise en ligne programmée ${day.text} à 14 h 30 (heure de Paris) par vous`)
    const notice = await page.$eval('[data-cms-schedule="notice"]', n => n.innerText)
    check(notice.includes('vous pouvez continuer à le modifier') && notice.includes('Modifier') && notice.includes('Annuler'), 'état : ' + notice)
    await shot('formulaire')
  })

  await step('formulaire : modifier l\'heure, deux langues, annuler', async () => {
    await clickText(page, '[data-cms-schedule="notice"] button', 'Modifier')
    await opened()
    check(await page.$eval('[data-cms-schedule="time"]', el => el.value) === '14:30' && await page.$eval('[data-cms-schedule="date"]', el => el.value) === day.date, 'la fenêtre reprend la date et l\'heure')
    const langs = await page.$$eval('[data-cms-schedule="dialog"] input[type=checkbox]', list => list.map(c => `${c.value}:${c.checked}:${c.disabled}`).join())
    check(langs === 'fr:true:false,en:false:true', 'langues proposées : ' + langs)
    await setInput('[data-cms-schedule="time"]', '16:45')
    await page.$eval('[data-cms-schedule="submit"]', b => b.click())
    await says(page, `Mise en ligne programmée ${day.text} à 16 h 45 (heure de Paris) par vous`)
    check((await planned(ids.ui)).length === 1, 'une seule programmation')
    // Modifier le brouillon : « Programmer… » attend l'enregistrement.
    await clickText(page, '[data-cms-schedule="notice"] button', 'Annuler')
    await says(page, 'Programmation annulée')
    check(!(await page.$('[data-cms-schedule="notice"]')) && (await planned(ids.ui)).length === 0, 'l\'état disparaît')
  })

  await step('formulaire : échec affiché, à reprogrammer ou écarter ; rédactrice prévenue', async () => {
    await schedule(claire, ids.ui, { action: 'publish', date: day.date, time: '09:00' })
    await claire.json(`${S}/${ids.ui}`, { method: 'PUT', body: { values: { fromPrice: null } } })
    due(ids.ui)
    await tick()
    await page.reload()
    await says(page, 'n\'a pas pu se faire : Le contenu n\'est plus complet.')
    const notice = await page.$eval('[data-cms-schedule="notice"]', n => n.innerText)
    check(notice.includes('Reprogrammer') && notice.includes('Écarter') && notice.includes('« Tarif à partir de »'), 'échec : ' + notice)
    await shot('echec')
    // Reprogrammer un contenu toujours incomplet : refusé, et le champ en défaut est montré dans le formulaire.
    await clickText(page, '[data-cms-schedule="notice"] button', 'Reprogrammer')
    await opened()
    await page.$eval('[data-cms-schedule="submit"]', b => b.click())
    await says(page, 'champ à corriger avant de publier')
    await clickText(page, '[data-cms-schedule="notice"] button', 'Écarter')
    await says(page, 'Programmation écartée')

    // La rédactrice voit la programmation, sans bouton, avec l'explication.
    await claire.json(`${S}/${ids.ui}`, { method: 'PUT', body: { values: { fromPrice: 150 } } })
    await schedule(claire, ids.ui, { action: 'publish', date: day.date, time: '09:00' })
    const context = await t.newContext()
    const other = await t.newPage({ context })
    await login(other, B, LINA)
    await other.goto(`${B}/admin/services/${ids.ui}`)
    await says(other, 'par Claire Durand')
    const seen = await other.$eval('[data-cms-schedule="notice"]', n => n.innerText)
    check(seen.includes('seule une personne qui peut publier peut encore le modifier') && !seen.includes('Annuler'), 'vu par la rédactrice : ' + seen)
    check(!(await other.$('[data-cms-schedule="open"]')), 'pas de bouton « Programmer… » sans le droit de publier')
    await other.close()
  })

  await step('liste : statut « Programmé » et filtre ; écran « Programmé » dans le menu', async () => {
    await page.goto(`${B}/admin/services`)
    await says(page, 'Offre de printemps')
    const row = await page.$$eval('tbody tr', (rows, title) => rows.find(r => r.innerText.includes(title))?.innerText, 'Offre de printemps')
    check(row.includes('Brouillon') && row.includes('Programmé'), 'ligne : ' + row)
    const title = await page.$$eval('tbody tr', (rows, name) => [...rows.find(r => r.innerText.includes(name)).querySelectorAll('.badge')].find(b => b.textContent.trim() === 'Programmé')?.title, 'Offre de printemps')
    check(title === `Mise en ligne ${day.text} à 9 h 00 (heure de Paris)`, 'infobulle : ' + title)
    await clickText(page, '[role=tab]', 'Programmés')
    const shown = await page.$$eval('tbody tr', rows => rows.map(r => r.querySelector('.font-medium')?.textContent.trim()))
    check(shown.includes('Offre de printemps') && shown.includes('Brouillon de Lina') && !shown.includes('Droit social'), 'filtre : ' + shown.join(', '))
    await shot('liste')
    await until(async () => (await menuLabels(page)).some(l => l.startsWith('Programmé')), 'entrée « Programmé » du menu')
    await clickText(page, 'aside .menu a', 'Programmé')
    await says(page, 'Les contenus qui seront mis en ligne ou retirés du site tout seuls')
    const text = await page.$eval('main', m => m.innerText)
    check(text.includes('heure de Paris') && text.includes('Offre de printemps') && text.includes(`Mise en ligne ${day.text} à 9 h 00`) && text.includes('programmé par vous'), 'écran : ' + text)
    check(!text.includes('La tâche planifiée du site n\'est pas activée'), 'pas d\'alerte quand le déclencheur passe')
    await shot('ecran')
    // Un échec y figure en tête.
    await claire.json(`${S}/${ids.ui}`, { method: 'PUT', body: { values: { fromPrice: null } } })
    due(ids.ui)
    await tick()
    await page.reload()
    await says(page, 'En échec : à reprendre')
    await shot('ecran-echec')
    await clickText(page, '[data-cms-schedule="row"]', 'Offre de printemps')
    await page.waitForFunction(id => location.pathname.endsWith(id), {}, ids.ui)
  })

  await step('largeur de téléphone : formulaire, fenêtre, liste, écran', async () => {
    await claire.json(`${S}/${ids.ui}/schedule`, { method: 'DELETE' })
    await claire.json(`${S}/${ids.ui}`, { method: 'PUT', body: { values: { fromPrice: 150 } } })
    await schedule(claire, ids.ui, { action: 'publish', date: day.date, time: '09:00' })
    await page.setViewport({ width: 390, height: 800 })
    await page.goto(`${B}/admin/services/${ids.ui}`)
    await says(page, 'Mise en ligne programmée')
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
    check(await fits(), 'le formulaire ne déborde pas')
    await shot('telephone-formulaire')
    await page.$eval('[data-cms-schedule="open"]', b => b.click())
    await opened()
    const box = await page.$eval('[data-cms-schedule="dialog"] .modal-box', b => { const r = b.getBoundingClientRect(); return { left: r.left, right: r.right, width: innerWidth } })
    check(box.left >= 0 && box.right <= box.width + 1, 'la fenêtre tient dans l\'écran : ' + JSON.stringify(box))
    await shot('telephone-fenetre')
    await clickText(page, '[data-cms-schedule="dialog"] button', 'Fermer')
    await page.goto(`${B}/admin/scheduled`)
    await says(page, 'Offre de printemps')
    check(await fits(), 'l\'écran « Programmé » ne déborde pas')
    await shot('telephone-ecran')
    await page.setViewport({ width: 1400, height: 1100 })
  })
}
