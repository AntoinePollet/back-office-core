// Redirections manuelles et pages introuvables : API, site public (serveur et navigation interne), écran du back-office.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { config } from '../lib/config.mjs'
import { check, clickText, login, menuLabels, says, until } from '../lib/harness.mjs'
import { hasSqlite, runSql } from '../lib/sqlite.mjs'

export const meta = {
  title: 'redirections manuelles, import en lot, pages introuvables',
  // En local il n'y a pas de cache à vider : chaque purge est déclarée échouée, ce qui prouve qu'elle est tentée.
  env: () => ({ CMS_DEV_SIMULATE_PURGE_FAILURE: '1' }),
}

const R = '/api/cms/redirects'
const E = '/api/cms/entries'
const MARC = { name: 'Marc Petit', email: 'marc@example.com', password: 'mot-de-passe-de-marc', role: 'editor' }
const LINA = { name: 'Lina Roux', email: 'lina@example.com', password: 'mot-de-passe-de-lina', role: 'writer' }
const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
const BIN = path.join(config.rootDir, 'packages', 'cms', 'bin', 'import.mjs')

/** Fichier de la base locale du serveur de test. Null si introuvable. */
function databaseFile() {
  const find = (dir) => {
    if (!fs.existsSync(dir)) return null
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { const hit = find(full); if (hit) return hit }
      else if (entry.name.endsWith('.sqlite') && !entry.name.includes('metadata')) return full
    }
    return null
  }
  return find(config.tmpDir)
}

export default async function (t) {
  const { B, step, info } = t
  const claire = t.http(), marc = t.http(), lina = t.http(), anon = t.http()
  const page = await t.newPage()
  const ids = {}

  /** Visite du site sans suivre la redirection, comme un navigateur (ou avec un autre agent). */
  const visit = async (url, headers = {}) => {
    const r = await fetch(B + url, { redirect: 'manual', headers: { 'user-agent': BROWSER, ...headers } })
    await r.arrayBuffer()
    return { status: r.status, location: r.headers.get('location'), cache: r.headers.get('cache-control') ?? '' }
  }
  const add = (body, client = claire) => client.post(R, body)
  const list = async () => (await claire.json(R)).items
  const rule = async source => (await list()).find(i => i.source === source)
  const missing = async () => (await claire.json(`${R}/not-found`)).items
  const service = (title, extra = {}) => ({ shared: { onQuote: true }, locales: { fr: { values: { title, excerpt: 'Résumé' }, ...extra } }, publish: ['fr'] })
  const refused = (r, status, code, text) => check(r.status === status && r.json?.data?.code === code && (!text || r.json.message.includes(text)), `attendu ${status} ${code} « ${text ?? ''} », reçu ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`)

  await step('préparation : comptes (éditeur, rédactrice), deux services, accueil', async () => {
    check((await claire.signIn(t.admin.email, t.admin.password)).status === 200, 'connexion de l\'administratrice refusée')
    for (const [who, client] of [[MARC, marc], [LINA, lina]]) {
      const { link } = await claire.json('/api/cms/users', { method: 'POST', body: { name: who.name, email: who.email, role: who.role } })
      check((await anon.post(`/api/cms/invite/${link.replace(/^.*\/admin\/invite\//, '')}`, { password: who.password })).status === 200, 'invitation de ' + who.name)
      check((await client.signIn(who.email, who.password)).status === 200, 'connexion refusée pour ' + who.name)
    }
    const a = service('Droit des affaires')
    a.locales.en = { values: { title: 'Business law' } }
    a.publish.push('en')
    ids.a = (await claire.json(`${E}/services`, { method: 'POST', body: a })).id
    ids.b = (await claire.json(`${E}/services`, { method: 'POST', body: service('Droit social') })).id
    await claire.get(`${E}/home/home`)
    await claire.json(`${E}/home/home`, { method: 'PUT', body: { locales: { fr: { values: { heroTitle: 'Un conseil clair' } } }, publish: ['fr'] } })
    check((await visit('/services/droit-social')).status === 200, 'le service publié ne s\'affiche pas')
  })

  await step('ajout à la main : 301 côté serveur, bon en-tête Location, cache purgé, normalisation', async () => {
    check((await visit('/vieille-page')).status === 404, 'l\'adresse devrait être introuvable avant')
    const r = await add({ source: 'https://ancien-site.fr/Vieille-Page/?id=3', target: { kind: 'url', url: '/contact?de=ancien' }, status: 301 })
    check(r.status === 200 && r.json.source === '/vieille-page' && r.json.to === '/contact?de=ancien', JSON.stringify(r.json).slice(0, 300))
    check(r.json.notes.some(n => n.includes('nom de domaine')) && r.json.notes.some(n => n.includes('paramètres')), 'la normalisation n\'est pas expliquée : ' + JSON.stringify(r.json.notes))
    // Effet immédiat : la purge du cache est tentée (ici simulée en échec, comme dans la suite 15).
    check(r.json.purgeFailed === true, 'purge du cache non tentée à la création')
    const v = await visit('/vieille-page')
    check(v.status === 301 && v.location === '/contact?de=ancien', JSON.stringify(v))
    // La réponse de redirection se met en cache comme une page : elle est purgée à chaque modification.
    check(config.siteCached(v.cache), 'cache de la redirection : ' + v.cache)
    for (const same of ['/Vieille-Page', '/vieille-page/', '//vieille-page', '/VIEILLE-PAGE/?x=1']) check((await visit(same)).location === '/contact?de=ancien', 'variante non reconnue : ' + same)
    const head = await fetch(B + '/vieille-page', { method: 'HEAD', redirect: 'manual', headers: { 'user-agent': BROWSER } })
    check(head.status === 301 && head.headers.get('location') === '/contact?de=ancien', 'HEAD : ' + head.status)
  })

  await step('302 vers un autre site, accents encodés, paramètres de la demande recopiés', async () => {
    const r = await add({ source: '/partenaire', target: 'https://www.exemple.fr/Accueil', status: 302 })
    check(r.status === 200, JSON.stringify(r.json).slice(0, 200))
    const v = await visit('/partenaire?utm_source=lettre')
    check(v.status === 302 && v.location === 'https://www.exemple.fr/Accueil', JSON.stringify(v))
    check((await add({ source: '/caf%C3%A9', target: '/équipe' })).json?.source === '/café', 'accent encodé non décodé')
    const cafe = await visit('/Caf%C3%A9/?utm_source=lettre')
    check(cafe.status === 301 && cafe.location === '/%C3%A9quipe?utm_source=lettre', JSON.stringify(cafe))
    check((await add({ source: '/x', target: '/y', status: 307 })).status === 422, 'un type 307 est accepté')
  })

  await step('destination « page du site » : elle suit la page quand son adresse change ; la redirection automatique reste', async () => {
    const r = await add({ source: '/nos-prestations/affaires.html', target: { kind: 'page', type: 'services', id: ids.a, locale: 'fr' } })
    check(r.status === 200 && r.json.to === '/services/droit-des-affaires', JSON.stringify(r.json).slice(0, 200))
    check((await add({ source: '/old/business', target: { kind: 'page', type: 'services', id: ids.a, locale: 'en' } })).json?.to === '/en/services/business-law', 'cible anglaise')
    // Une adresse libre qui est celle d'une page en ligne devient un lien vers cette page.
    const free = await add({ source: '/social.php', target: '/services/droit-social' })
    check(free.status === 200 && (await rule('/social.php')).target.kind === 'page', 'l\'adresse d\'une page en ligne n\'a pas été reliée à la page')
    check((await visit('/nos-prestations/affaires.html')).location === '/services/droit-des-affaires', 'avant le changement d\'adresse')

    const moved = service('Droit des affaires', { slug: 'affaires' })
    check((await claire.put(`${E}/services/${ids.a}`, moved)).status === 200, 'changement d\'adresse refusé')
    const v = await visit('/nos-prestations/affaires.html')
    check(v.status === 301 && v.location === '/services/affaires', 'la redirection n\'a pas suivi la page : ' + JSON.stringify(v))
    check((await visit('/old/business')).location === '/en/services/business-law', 'la cible anglaise a bougé')
    // La redirection automatique de l'ancienne adresse (suite 04) fonctionne toujours, et figure dans la liste.
    const auto = await visit('/services/droit-des-affaires')
    check(auto.status === 301 && auto.location === '/services/affaires', 'redirection automatique : ' + JSON.stringify(auto))
    const row = await rule('/services/droit-des-affaires')
    check(row?.kind === 'auto' && row.title === 'Droit des affaires' && row.to === '/services/affaires', 'redirection automatique absente de la liste : ' + JSON.stringify(row))
    // Destination inconnue ou sans adresse sur le site.
    check((await add({ source: '/z', target: { kind: 'page', type: 'services', id: 'inconnu' } })).status === 422, 'page inconnue acceptée')
    check((await add({ source: '/z', target: { kind: 'page', type: 'categories', id: 'x' } })).status === 422, 'type sans adresse accepté')
  })

  await step('garde-fous : mal formée, réservée, vers elle-même, doublon, page en ligne', async () => {
    refused(await add({ source: '', target: '/a' }), 422, 'invalid', 'Indiquez')
    refused(await add({ source: '/a/../b', target: '/a' }), 422, 'invalid', 'pas une adresse valide')
    refused(await add({ source: '/blog/*', target: '/actualites' }), 422, 'invalid', 'adresse exacte')
    refused(await add({ source: '/', target: '/a' }), 422, 'invalid', 'accueil')
    for (const reserved of ['/admin', '/admin/users', '/api/content/services', '/media/x.png', '/_nuxt/a.js', '/sitemap.xml', '/robots.txt']) refused(await add({ source: reserved, target: '/a' }), 422, 'invalid', 'réservée')
    refused(await add({ source: '/a', target: 'www.exemple.fr' }), 422, 'invalid', 'doit commencer par')
    refused(await add({ source: '/a', target: 'javascript:alert(1)' }), 422, 'invalid')
    refused(await add({ source: '/a', target: '//exemple.fr' }), 422, 'invalid')
    refused(await add({ source: '/meme', target: '/Meme/' }), 422, 'self', 'elle-même')
    refused(await add({ source: '/Vieille-page/', target: '/ailleurs' }), 422, 'duplicate', 'déjà redirigée vers « /contact?de=ancien »')
    refused(await add({ source: '/services/droit-des-affaires', target: '/ailleurs' }), 422, 'duplicate', 'automatiquement')
    // Décision : une page en ligne répond toujours en premier, la redirection est refusée.
    refused(await add({ source: '/services/droit-social', target: '/ailleurs' }), 422, 'page', '« Droit social »')
    refused(await add({ source: '/en/services/business-law', target: '/ailleurs' }), 422, 'page', 'ne s\'appliquerait pas')
    check((await visit('/services/droit-social')).status === 200, 'la page en ligne ne répond plus')
  })

  await step('boucle refusée ; chaîne signalée puis aplatie (en aval et en amont)', async () => {
    check((await add({ source: '/b1', target: '/b2' })).status === 200 && (await add({ source: '/b2', target: '/b3' })).status === 409, 'préparation de la chaîne')
    // /b2 → /b3 ferait /b1 → /b2 → /b3 : signalé (amont), rien n'est écrit sans accord.
    check(!(await rule('/b2')), 'la redirection a été écrite malgré la chaîne')
    const up = await add({ source: '/b2', target: '/b3', flatten: true })
    check(up.status === 200 && up.json.notes.some(n => n.includes('« /b1 »') && n.includes('directement')), JSON.stringify(up.json).slice(0, 300))
    check((await visit('/b1')).location === '/b3' && (await visit('/b2')).location === '/b3', 'l\'amont n\'a pas été réorienté')
    // Boucle : /b3 → /b1 ramènerait à /b3.
    refused(await add({ source: '/b3', target: '/b1' }), 422, 'loop', 'Boucle : « /b3 » → « /b1 » → « /b3 »')
    refused(await add({ source: '/b3', target: '/B2/?x=1' }), 422, 'loop')
    // Chaîne en aval : la destination est déjà redirigée. Le serveur dit où l'on arriverait.
    const down = await add({ source: '/b0', target: '/b1' })
    refused(down, 409, 'chain', '« /b0 » → « /b1 » → « /b3 »')
    check(down.json.data.chain.final === '/b3', JSON.stringify(down.json.data))
    const flat = await add({ source: '/b0', target: '/b1', flatten: true })
    check(flat.status === 200 && flat.json.to === '/b3' && (await visit('/b0')).location === '/b3', JSON.stringify(flat.json).slice(0, 200))
    // Par une redirection automatique : la destination finale est la page, et la redirection la suit.
    const viaAuto = await add({ source: '/b9', target: '/services/droit-des-affaires', flatten: true })
    check(viaAuto.status === 200 && viaAuto.json.to === '/services/affaires' && (await rule('/b9')).target.kind === 'page', JSON.stringify(viaAuto.json).slice(0, 200))
  })

  await step('modifier et supprimer ; cache purgé à chaque fois', async () => {
    const row = await rule('/partenaire')
    const edited = await claire.put(`${R}/${row.id}`, { source: '/partenaires', target: '/contact', status: 301 })
    check(edited.status === 200 && edited.json.purgeFailed === true, JSON.stringify(edited.json).slice(0, 200))
    check((await visit('/partenaire')).status === 404 && (await visit('/partenaires')).location === '/contact', 'la modification n\'a pas pris effet')
    // La redirection modifiée n'est pas son propre doublon ; une autre l'est.
    check((await claire.put(`${R}/${row.id}`, { source: '/partenaires', target: '/contact', status: 302 })).status === 200, 'ré-enregistrement refusé')
    refused(await claire.put(`${R}/${row.id}`, { source: '/vieille-page', target: '/contact' }), 422, 'duplicate')
    check((await claire.put(`${R}/inconnue`, { source: '/q', target: '/contact' })).status === 404, 'modification d\'une redirection inconnue')
    const gone = await claire.del(`${R}/${row.id}`)
    check(gone.status === 200 && gone.json.purgeFailed === true && (await visit('/partenaires')).status === 404, 'suppression sans effet')
    check((await claire.del(`${R}/${row.id}`)).status === 404, 'seconde suppression')
  })

  await step('corbeille : la redirection attend la page supprimée et reprend à sa restauration', async () => {
    check((await claire.del(`${E}/services/${ids.b}`)).status === 200, 'suppression du service')
    check((await visit('/social.php')).status === 404, 'la redirection mène encore à une page supprimée')
    check((await rule('/social.php')).issue?.includes('corbeille'), 'la liste ne signale pas la page à la corbeille : ' + JSON.stringify(await rule('/social.php')))
    const item = (await claire.json('/api/cms/trash')).items.find(i => i.title === 'Droit social')
    await claire.json(`/api/cms/trash/${item.id}/restore`, { method: 'POST' })
    const v = await visit('/social.php')
    check(v.status === 301 && v.location === '/services/droit-social' && !(await rule('/social.php')).issue, 'la redirection n\'a pas repris : ' + JSON.stringify(v))
    // Page retirée du site (brouillon) : même attente, signalée autrement.
    await claire.json(`${E}/services/${ids.b}`, { method: 'PUT', body: { unpublish: ['fr'] } }).catch(() => null)
    const row = await rule('/social.php')
    if (row.issue) check(row.issue.includes('pas en ligne') && (await visit('/social.php')).status === 404, row.issue)
    await claire.json(`${E}/services/${ids.b}`, { method: 'PUT', body: service('Droit social') })
    check((await visit('/social.php')).location === '/services/droit-social', 'après republication')
  })

  await step('import en lot : compte rendu ligne par ligne, erreurs, chaînes aplaties, simulation sans écriture', async () => {
    const text = [
      'Ancienne adresse;Nouvelle adresse',
      '/lot/un ; /services/affaires',
      '/lot/deux;/lot/un',
      '# commentaire',
      '',
      '/admin/secret;/x',
      '/vieille-page;/ailleurs',
      '"/lot/trois","https://www.exemple.fr/a,b",302',
      'n importe quoi',
      '/lot/quatre;/lot/cinq',
      '/lot/cinq;/lot/quatre',
      '/services/droit-social;/x',
      '/lot/six → /contact',
    ].join('\n')
    const before = (await list()).length
    const dry = await claire.post(`${R}/import`, { text, dryRun: true })
    check(dry.status === 200 && dry.json.dryRun === true && dry.json.created === 5 && dry.json.errors === 5 && !('purgeFailed' in dry.json), JSON.stringify(dry.json).slice(0, 1500))
    check((await list()).length === before, 'la simulation a écrit quelque chose')

    const done = await claire.post(`${R}/import`, { text })
    check(done.status === 200 && done.json.created === 5 && done.json.errors === 5 && done.json.purgeFailed === true, JSON.stringify(done.json).slice(0, 400))
    const by = Object.fromEntries(done.json.lines.map(l => [l.line, l]))
    check(by[2].result === 'created' && by[3].result === 'created' && by[3].message.includes('Chaîne aplatie'), JSON.stringify(by[3]))
    check(by[6].result === 'error' && by[6].message.includes('réservée'), JSON.stringify(by[6]))
    check(by[7].result === 'error' && by[7].message.includes('déjà redirigée') && by[7].message.includes('Remplacer'), JSON.stringify(by[7]))
    check(by[8].result === 'created' && by[8].message.startsWith('Provisoire'), JSON.stringify(by[8]))
    check(by[9].result === 'error' && by[9].message.includes('illisible'), JSON.stringify(by[9]))
    check(by[10].result === 'created' && by[11].result === 'error' && by[11].message.includes('Boucle'), JSON.stringify(by[11]))
    check(by[12].result === 'error' && by[12].message.includes('« Droit social »'), JSON.stringify(by[12]))
    check(by[13].result === 'created', JSON.stringify(by[13]))
    check((await visit('/lot/deux')).location === '/services/affaires' && (await rule('/lot/un')).target.kind === 'page', 'chaîne du lot non aplatie')
    const three = await visit('/lot/trois')
    check(three.status === 302 && three.location === 'https://www.exemple.fr/a,b', JSON.stringify(three))

    // Relance : rien ne change. Avec « remplacer » : la ligne en conflit est mise à jour.
    const again = await claire.post(`${R}/import`, { text })
    check(again.json.created === 0 && again.json.unchanged === 5 && !('purgeFailed' in again.json), JSON.stringify(again.json).slice(0, 300))
    const replaced = await claire.post(`${R}/import`, { text: '/vieille-page;/ailleurs', replace: true })
    check(replaced.json.updated === 1 && (await visit('/vieille-page')).location === '/ailleurs', JSON.stringify(replaced.json).slice(0, 300))
    check((await claire.post(`${R}/import`, { text: '\n# rien\n' })).status === 422 && (await claire.post(`${R}/import`, {})).status === 422, 'un import vide est accepté')
    check((await claire.post(`${R}/import`, { text: Array.from({ length: 1001 }, (_, i) => `/m${i};/x`).join('\n') })).status === 422, 'plus de 1000 lignes acceptées')
  })

  await step('pages introuvables : comptées sans donnée personnelle, page 404 jamais mise en cache', async () => {
    // Les étapes précédentes ont déjà fait compter quelques adresses : on repart d'une liste vide.
    check((await claire.del(`${R}/not-found`)).status === 200 && (await missing()).length === 0, 'la liste n\'a pas été vidée')
    for (let i = 0; i < 3; i++) {
      const v = await visit('/Ancien-Catalogue/', { referer: 'https://www.google.com/search?q=cabinet+durand&client=secret', [config.ipHeader]: '203.0.113.9' })
      check(v.status === 404 && !/public|s-maxage/.test(v.cache), 'page 404 : ' + JSON.stringify(v))
    }
    await visit('/services/jamais-existe', { referer: B + '/services/droit-social?x=1' })
    const row = await until(async () => (await missing()).find(m => m.path === '/ancien-catalogue' && m.hits === 3), 'trois demandes comptées pour /ancien-catalogue')
    check(row.referrer === 'www.google.com/search', 'provenance : ' + row.referrer)
    const all = await missing()
    check(all[0].path === '/ancien-catalogue' && all.find(m => m.path === '/services/jamais-existe')?.referrer === '/services/droit-social', JSON.stringify(all))
    // Rien de personnel : ni adresse IP, ni paramètres de la page d'origine, ni navigateur.
    const raw = JSON.stringify(await claire.json(`${R}/not-found`))
    check(!raw.includes('203.0.113.9') && !raw.includes('secret') && !raw.includes('Mozilla'), 'donnée personnelle conservée : ' + raw.slice(0, 300))
    check(Object.keys(row).sort().join() === 'firstAt,hits,lastAt,path,referrer', Object.keys(row).join())
  })

  await step('bruit des robots ignoré ; adresses réservées et aperçus jamais comptés', async () => {
    for (const noise of ['/wp-login.php', '/.env', '/wp-admin/install.php', '/backup.zip', '/.git/config', '/phpmyadmin/', '/vendor/phpunit/phpunit/src/Util/PHP/eval-stdin.php', '/apple-touch-icon.png'])
      check((await visit(noise)).status === 404, noise + ' ne répond pas 404')
    await visit('/bonne-adresse-robot', { 'user-agent': 'python-requests/2.31' })
    await visit('/bonne-adresse-curl', { 'user-agent': 'curl/8.4.0' })
    await visit('/bonne-adresse-apercu?preview=1')
    await anon.get('/api/content/services/inconnu')
    await visit('/admin-ancien') // n'est pas réservée : comptée
    await until(async () => (await missing()).some(m => m.path === '/admin-ancien'), 'la dernière adresse comptée')
    const paths = (await missing()).map(m => m.path)
    for (const p of paths) check(['/ancien-catalogue', '/services/jamais-existe', '/admin-ancien'].includes(p), 'adresse comptée à tort : ' + p)
  })

  await step('une page introuvable devient une redirection ; ignorer une adresse', async () => {
    const r = await add({ source: '/ancien-catalogue', target: { kind: 'page', type: 'services', id: ids.b, locale: 'fr' } }, marc)
    check(r.status === 200, JSON.stringify(r.json).slice(0, 200))
    check(!(await missing()).some(m => m.path === '/ancien-catalogue'), 'l\'adresse redirigée est encore dans les pages introuvables')
    check((await visit('/Ancien-Catalogue/')).location === '/services/droit-social', 'la redirection créée ne s\'applique pas')
    check((await claire.del(`${R}/not-found?path=${encodeURIComponent('/admin-ancien')}`)).status === 200 && !(await missing()).some(m => m.path === '/admin-ancien'), 'adresse non ignorée')
  })

  await step('plafond et ménage : 500 adresses au plus, les plus demandées gardées, oubli après 90 jours', async () => {
    const file = databaseFile()
    let done = false
    if (file && hasSqlite()) {
      const now = Date.now()
      const values = Array.from({ length: 520 }, (_, i) => `('/afflux/${i}', ${i < 10 ? 50 : 1}, ${now - i * 1000}, ${now - i * 1000})`).join(',')
      runSql(file, `insert into cms_not_found (path, hits, first_at, last_at) values ${values}, ('/tres-ancienne', 900, ${now - 100 * 86400_000}, ${now - 91 * 86400_000})`)
      done = true
    }
    if (!done) { info('non vérifié ici : il faut l\'outil sqlite3 pour remplir la table'); return }
    // La prochaine écriture fait le ménage.
    await visit('/goutte-de-trop')
    const all = await until(async () => { const m = await missing(); return m.some(x => x.path === '/goutte-de-trop') && m.length <= 500 ? m : null }, 'la table ramenée à 500 adresses')
    check(all.length === 500, 'adresses conservées : ' + all.length)
    check(!all.some(m => m.path === '/tres-ancienne'), 'une adresse de plus de 90 jours est gardée')
    check(Array.from({ length: 10 }, (_, i) => `/afflux/${i}`).every(p => all.some(m => m.path === p)) && all.some(m => m.path === '/services/jamais-existe'), 'les adresses les plus demandées ne sont pas toutes gardées')
    check(!all.some(m => m.path === '/afflux/519'), 'la moins récente des moins demandées est gardée')
    check((await claire.del(`${R}/not-found`)).status === 200 && (await missing()).length === 0, 'la liste n\'a pas été vidée')
  })

  await step('navigation interne (sans rechargement) : adresse sans page, puis page à adresse variable', async () => {
    await page.setUserAgent(BROWSER)
    // La page 404 rendue pour un navigateur n'est jamais mise en cache (elle doit rester comptée et céder la place à une redirection).
    const absent = await page.goto(B + '/page-absente', { waitUntil: 'networkidle0' })
    check(absent.status() === 404 && absent.headers()['cache-control'] === 'private, no-store', 'page 404 du navigateur : ' + absent.status() + ' ' + absent.headers()['cache-control'])
    await page.goto(B + '/', { waitUntil: 'networkidle0' })
    await page.evaluate(() => { window.__sansRechargement = true })
    const go = to => page.evaluate(to => document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$router.push(to), to)
    // Aucune page ne correspond à /lot/six : la question est posée avant d'afficher la page 404.
    await go('/vieille-page-interne')
    await says(page, '404')
    await page.goto(B + '/', { waitUntil: 'networkidle0' })
    await page.evaluate(() => { window.__sansRechargement = true })
    await claire.json(R, { method: 'POST', body: { source: '/vers-social', target: { kind: 'page', type: 'services', id: ids.b, locale: 'fr' } } })
    await go('/Vers-Social/')
    await page.waitForFunction(() => location.pathname === '/services/droit-social' && document.body.innerText.includes('Droit social'))
    check(await page.evaluate(() => window.__sansRechargement === true), 'la page a été rechargée')
    // /services/[slug] existe comme page : c'est elle qui déclare le contenu introuvable ; la redirection manuelle s'applique quand même.
    await claire.json(R, { method: 'POST', body: { source: '/services/ancien-nom', target: '/services/affaires' } })
    await go('/services/ancien-nom')
    await page.waitForFunction(() => location.pathname === '/services/affaires' && document.body.innerText.includes('Droit des affaires'))
    check(await page.evaluate(() => window.__sansRechargement === true), 'la page a été rechargée (page à adresse variable)')
    check((await visit('/services/ancien-nom')).location === '/services/affaires', 'même adresse, côté serveur')
    // La demande interne restée sans réponse est comptée, avec la page d'où elle vient.
    const seen = await until(async () => (await missing()).find(m => m.path === '/vieille-page-interne'), 'la navigation interne comptée')
    check(seen.referrer === '/', 'provenance interne : ' + seen.referrer)
    // Vers un autre site : le navigateur quitte le site.
    check((await anon.get('/_cms/redirect?path=/lot/trois')).json?.external === true, 'destination externe non signalée au navigateur')
  })

  await step('référencement : plan du site et robots inchangés, aucune ancienne adresse dans le plan', async () => {
    const map = (await anon.get('/sitemap.xml')).text
    const locs = [...map.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].replace('https://cabinet-durand.fr', '')).sort()
    check(locs.join() === ['/', '/en/services/business-law', '/services/affaires', '/services/droit-social'].join(), 'plan du site : ' + locs.join())
    const robots = (await anon.get('/robots.txt')).text
    check(robots.includes('Disallow: /admin') && robots.includes('Sitemap: https://cabinet-durand.fr/sitemap.xml') && !robots.includes('vieille'), robots)
  })

  await step('droits : éditeur oui, rédactrice et visiteur non (API et menu)', async () => {
    check((await marc.get(R)).status === 200 && (await marc.get(`${R}/not-found`)).status === 200, 'l\'éditeur est refusé')
    const calls = client => Promise.all([
      client.get(R), client.get(`${R}/not-found`), client.post(R, { source: '/droits', target: '/contact' }), client.put(`${R}/x`, { source: '/droits', target: '/contact' }),
      client.del(`${R}/x`), client.del(`${R}/auto?type=services&locale=fr&slug=droit-des-affaires`), client.post(`${R}/import`, { text: '/droits;/contact' }), client.del(`${R}/not-found`),
    ])
    check((await calls(lina)).every(r => r.status === 403), 'la rédactrice n\'est pas refusée partout : ' + (await calls(lina)).map(r => r.status))
    check((await calls(anon)).every(r => r.status === 401), 'le visiteur n\'est pas refusé partout : ' + (await calls(anon)).map(r => r.status))
    check(!(await rule('/droits')) && (await visit('/services/droit-des-affaires')).status === 301, 'un refus a quand même écrit quelque chose')
    const other = await t.newPage({ context: await t.newContext() })
    await login(other, B, LINA)
    check(!(await menuLabels(other)).includes('Redirections'), 'la rédactrice voit « Redirections » dans le menu')
    await other.goto(B + '/admin/redirections', { waitUntil: 'networkidle0' })
    check(!new URL(other.url()).pathname.startsWith('/admin/redirections'), 'la rédactrice a ouvert l\'écran : ' + other.url())
    await other.close()
  })

  await step('supprimer une redirection automatique : l\'ancienne adresse redevient introuvable', async () => {
    const r = await marc.del(`${R}/auto?type=services&locale=fr&slug=droit-des-affaires`)
    check(r.status === 200 && r.json.purgeFailed === true, JSON.stringify(r.json).slice(0, 200))
    // /b9 visait la page elle-même : elle n'est pas touchée.
    check((await visit('/services/droit-des-affaires')).status === 404 && (await visit('/b9')).location === '/services/affaires', 'suppression de la redirection automatique')
  })

  await step('écran : liste, recherche, ajout par le formulaire, chaîne proposée à l\'aplatissement', async () => {
    await page.setViewport({ width: 1400, height: 1100 })
    await login(page, B)
    check((await menuLabels(page)).includes('Redirections'), 'entrée de menu absente')
    await clickText(page, 'aside a', 'Redirections')
    await says(page, 'Une ancienne adresse du site conduit le visiteur')
    await page.waitForSelector('[data-redirect]')
    const rows = () => page.$$eval('[data-redirect]', els => els.map(e => e.innerText))
    check((await rows()).some(r => r.includes('/b9') && r.includes('Droit des affaires') && r.includes('/services/affaires')), 'ligne « page du site » : ' + (await rows()).slice(0, 3).join(' | '))
    await page.type('input[type=search]', 'lot/trois')
    await page.waitForFunction(() => document.querySelectorAll('[data-redirect]').length === 1)
    check((await rows())[0].includes('https://www.exemple.fr/a,b') && (await rows())[0].includes('Provisoire'), (await rows())[0])
    await page.$eval('input[type=search]', (el) => { el.value = ''; el.dispatchEvent(new Event('input')) })

    await clickText(page, 'button', 'Ajouter')
    await page.waitForSelector('[data-redirect-form]')
    await page.type('[data-redirect-form] input[name=source]', '/depuis-ecran')
    await clickText(page, '[data-redirect-form] button', 'Enregistrer')
    await says(page, 'Choisissez la destination')
    await clickText(page, '[data-redirect-form] label', 'Autre adresse')
    await page.waitForSelector('[data-redirect-form] input[placeholder^="https://"]')
    await page.type('[data-redirect-form] input[placeholder^="https://"]', '/b1')
    await clickText(page, '[data-redirect-form] button', 'Enregistrer')
    await says(page, 'Chaîne de redirections')
    check(!(await rule('/depuis-ecran')), 'la redirection a été écrite sans accord')
    await clickText(page, '[data-redirect-error] button', 'Rediriger directement vers « /b3 »')
    await says(page, '« /depuis-ecran » mène maintenant à « /b3 »')
    // L'avertissement « le site n'a pas pu être actualisé » s'affiche quand la purge échoue (ici simulée).
    await page.waitForSelector('[data-cms-site-delay]')
    check((await visit('/depuis-ecran')).location === '/b3', 'la redirection de l\'écran ne s\'applique pas')

    // Page du site, choisie comme dans le champ lien.
    await clickText(page, 'button', 'Ajouter')
    await page.waitForSelector('[data-redirect-form]')
    await page.type('[data-redirect-form] input[name=source]', '/vers-page')
    await page.select('[data-redirect-form] select', 'services')
    await page.waitForFunction(() => [...document.querySelectorAll('[data-redirect-form] select option')].some(o => o.textContent === 'Droit social'))
    const second = (await page.$$('[data-redirect-form] select'))[1]
    await second.select(ids.b)
    await page.select('[data-redirect-form] select[name=locale]', 'fr')
    await clickText(page, '[data-redirect-form] label', 'Provisoire')
    await clickText(page, '[data-redirect-form] button', 'Enregistrer')
    await says(page, '« /vers-page » mène maintenant à « /services/droit-social »').catch(async (e) => { throw new Error(e.message + ' — ' + await page.evaluate(() => JSON.stringify({ disabled: [...document.querySelectorAll('[data-redirect-form] button')].map(b => b.disabled), toast: document.querySelector('.toast')?.innerText, source: document.querySelector('[data-redirect-form] input[name=source]')?.value, valid: document.querySelector('[data-redirect-form]')?.checkValidity() }))) })
    const v = await visit('/vers-page')
    check(v.status === 302 && v.location === '/services/droit-social', JSON.stringify(v))

    // Modifier : le formulaire reprend la redirection.
    const line = await page.waitForFunction(() => [...document.querySelectorAll('[data-redirect]')].find(e => e.innerText.includes('/vers-page')))
    await (await line.asElement().$('button[title=Modifier]')).evaluate(el => el.click())
    await page.waitForSelector('[data-redirect-form]')
    check(await page.$eval('[data-redirect-form] input[name=source]', el => el.value) === '/vers-page', 'le formulaire ne reprend pas l\'ancienne adresse')
    await clickText(page, '[data-redirect-form] button', 'Annuler')
  })

  await step('écran : import (vérifier puis importer), pages introuvables et « créer une redirection »', async () => {
    await clickText(page, 'button', 'Importer une liste')
    await page.waitForSelector('[data-redirect-import]')
    await page.type('[data-redirect-import] textarea', '/ecran/un;/contact\n/admin;/x\n/ecran/deux;/ecran/un')
    await clickText(page, '[data-redirect-import] button', 'Vérifier')
    await page.waitForSelector('[data-import-report]')
    const report = await page.$eval('[data-import-report]', el => el.innerText)
    check(report.includes('2 à ajouter') && report.includes('1 refusée') && report.includes('réservée') && report.includes('Chaîne aplatie'), report)
    check(!(await rule('/ecran/un')), 'la vérification a écrit')
    await clickText(page, '[data-redirect-import] button', 'Importer 2 redirections')
    await says(page, '2 redirections enregistrées')
    await page.waitForFunction(() => document.querySelector('[data-import-report]')?.innerText.includes('Import terminé'))
    check((await visit('/ecran/deux')).location === '/contact', 'import de l\'écran sans effet')
    await clickText(page, '[data-redirect-import] button', 'Fermer')

    // Fichier CSV : son contenu remplit la zone de saisie.
    const csv = path.join(config.tmpDir, 'redirections.csv')
    fs.writeFileSync(csv, 'ancienne,nouvelle\n/csv/un,/contact\n')
    await clickText(page, 'button', 'Importer une liste')
    await (await page.waitForSelector('[data-redirect-import] input[type=file]')).uploadFile(csv)
    await page.waitForFunction(() => document.querySelector('[data-redirect-import] textarea').value.includes('/csv/un'))
    await clickText(page, '[data-redirect-import] button', 'Vérifier')
    await page.waitForFunction(() => document.querySelector('[data-import-report]')?.innerText.includes('1 à ajouter'))
    await clickText(page, '[data-redirect-import] button', 'Annuler')

    for (let i = 0; i < 2; i++) await visit('/plaquette-2019.pdf', { referer: 'https://annuaire.exemple.fr/cabinets?page=2' })
    await until(async () => (await missing()).some(m => m.path === '/plaquette-2019.pdf' && m.hits === 2), 'deux demandes comptées')
    await page.reload({ waitUntil: 'networkidle0' })
    await clickText(page, '[role=tab]', 'Pages introuvables')
    await page.waitForSelector('[data-not-found]')
    const row = await page.evaluateHandle(() => [...document.querySelectorAll('[data-not-found]')].find(e => e.innerText.includes('/plaquette-2019.pdf')))
    const text = await row.asElement().evaluate(e => e.innerText)
    check(text.includes('2 demandes') && text.includes('annuaire.exemple.fr/cabinets') && !text.includes('page=2'), text)
    await clickText(page, 'button', 'Créer une redirection', row.asElement())
    await page.waitForSelector('[data-redirect-form]')
    check(await page.$eval('[data-redirect-form] input[name=source]', el => el.value) === '/plaquette-2019.pdf', 'l\'ancienne adresse n\'est pas préremplie')
    await clickText(page, '[data-redirect-form] label', 'Autre adresse')
    await page.type('[data-redirect-form] input[placeholder^="https://"]', '/contact')
    await clickText(page, '[data-redirect-form] button', 'Enregistrer')
    await says(page, '« /plaquette-2019.pdf » mène maintenant à « /contact »')
    await page.waitForFunction(() => ![...document.querySelectorAll('[data-not-found]')].some(e => e.innerText.includes('/plaquette-2019.pdf')))
    check((await visit('/plaquette-2019.pdf')).location === '/contact', 'la redirection créée depuis la liste ne s\'applique pas')
  })

  await step('largeur de téléphone : liste, pages introuvables, formulaire sans débordement', async () => {
    await page.setViewport({ width: 390, height: 800 })
    await page.reload({ waitUntil: 'networkidle0' })
    await page.waitForSelector('[data-redirect]')
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    check(await fits(), 'la liste déborde en largeur de téléphone')
    await clickText(page, '[role=tab]', 'Pages introuvables')
    check(await fits(), 'les pages introuvables débordent')
    await clickText(page, 'button', 'Ajouter')
    await page.waitForSelector('[data-redirect-form]')
    check(await fits() && await page.$eval('[data-redirect-form]', el => el.getBoundingClientRect().right <= window.innerWidth), 'le formulaire déborde')
    await clickText(page, '[data-redirect-form] button', 'Annuler')
    await page.setViewport({ width: 1400, height: 1100 })
  })

  await step('journal d\'activité : création, modification, suppression, import', async () => {
    const wanted = [
      'Claire Durand a créé la redirection « /vieille-page » → « /contact?de=ancien »',
      'Claire Durand a modifié la redirection « /partenaires » → « /contact »',
      'Claire Durand a supprimé la redirection de « /partenaires »',
      'Claire Durand a importé 5 redirections',
      'Marc Petit a créé la redirection « /ancien-catalogue » → « /services/droit-social »',
      'Marc Petit a supprimé la redirection automatique de « /services/droit-des-affaires »',
    ]
    const lines = await until(async () => {
      const got = (await claire.json('/api/cms/activity?limit=100&q=redirection')).items
      return wanted.every(w => got.some(l => l.summary === w)) ? got : null
    }, 'les lignes du journal').catch(async () => { throw new Error('journal : ' + (await claire.json('/api/cms/activity?limit=100&q=redirection')).items.map(l => l.summary).filter(s => s.includes('redirection')).join(' | ')) })
    check(lines.find(l => l.summary === wanted[0]).link === '/admin/redirections', 'lien du journal : ' + JSON.stringify(lines.find(l => l.summary === wanted[0])))
  })

  await step('outil d\'import : rubrique « redirections » (simulation, import, relance sans doublon)', async () => {
    const dir = path.join(config.tmpDir, 'import-redirections')
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'import.json')
    fs.writeFileSync(file, JSON.stringify({
      collections: { services: [{ id: 'conseil', title: 'Conseil', excerpt: 'Résumé', onQuote: true }] },
      redirections: [
        { from: 'https://ancien-site.fr/Conseil.html', to: { page: 'services', id: 'conseil' } },
        { from: '/cli/contact', to: '/contact', status: 302 },
        { from: '/cli/boucle', to: '/cli/boucle/' },
      ],
    }))
    const run = args => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [BIN, file, ...args, '--url', B], { cwd: config.playgroundDir, env: { ...process.env, CMS_EMAIL: t.admin.email, CMS_PASSWORD: t.admin.password, CMS_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      child.stdout.on('data', d => { out += d })
      child.stderr.on('data', d => { out += d })
      child.on('error', reject)
      child.on('close', code => resolve({ code, out }))
    })
    const dry = await run(['--dry-run'])
    check(dry.out.includes('Redirections') && dry.out.includes('/conseil.html') && dry.out.includes('sera vérifiée à l\'import') && dry.out.includes('elle-même'), dry.out)
    check(!(await rule('/cli/contact')), 'la simulation a écrit une redirection')
    const done = await run([])
    check(done.code === 1 && /créé\s+\/conseil\.html/.test(done.out) && /créé\s+\/cli\/contact/.test(done.out) && /ERREUR\s+\/cli\/boucle/i.test(done.out), done.out)
    check((await visit('/Conseil.html')).location === '/services/conseil' && (await visit('/cli/contact')).status === 302, 'les redirections importées ne s\'appliquent pas')
    const again = await run([])
    check(/inchangé\s+\/conseil\.html/.test(again.out) && /inchangé\s+\/cli\/contact/.test(again.out), again.out)
  })
}
