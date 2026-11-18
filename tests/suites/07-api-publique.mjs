// Pagination et filtres de l'API publique (packages/cms/server/utils/public.ts, resolve.ts). Sans navigateur.
import { check } from '../lib/harness.mjs'

export const meta = { title: 'API publique : pagination, filtres, aperçu, lien vers une page' }

const LIST = '/api/content/services'

export default async function (t) {
  const { step } = t
  const admin = t.http()
  const anon = t.http()
  const create = async (type, body) => (await admin.json(`/api/cms/entries/${type}`, { method: 'POST', body })).id
  const titles = list => list.map(s => s.title)
  const same = (got, want) => JSON.stringify(got) === JSON.stringify(want)
  /** Lit une liste et compare ses titres, dans l'ordre. */
  const expectTitles = async (client, query, want, what) => {
    const r = await client.get(LIST + query)
    check(r.status === 200, `${what} : statut ${r.status} ${r.text.slice(0, 200)}`)
    const got = titles(Array.isArray(r.json) ? r.json : r.json.items)
    check(same(got, want), `${what} : attendu ${want.join(', ') || '(rien)'} — reçu ${got.join(', ') || '(rien)'}`)
    return r.json
  }

  // Services publiés, dans l'ordre de création. [titre, catégorie, public, sur devis, tarif]
  const SERVICES = [
    ['Droit des affaires', 'pro', 'companies', true, null],
    ['Droit social', 'pro', 'companies', false, 150],
    ['Droit fiscal', 'pro', 'individuals', false, 200],
    ['Droit de la famille', 'perso', 'individuals', false, 150],
    ['Successions', 'perso', 'individuals', true, null],
    ['Baux commerciaux', null, 'companies', false, 300],
    ['Médiation', null, null, true, null],
  ]
  const ALL = SERVICES.map(s => s[0])
  const DRAFT = 'Brouillon secret'
  const cat = {}, ids = {}
  let order = ALL

  await step('préparation : deux catégories, sept services publiés, un brouillon', async () => {
    check((await admin.signIn(t.admin.email, t.admin.password)).status === 200, 'connexion refusée')
    cat.pro = await create('categories', { locales: { fr: { values: { name: 'Entreprises' } } } })
    cat.perso = await create('categories', { locales: { fr: { values: { name: 'Particuliers' } } } })
    for (const [title, category, audience, onQuote, fromPrice] of SERVICES) {
      const shared = { onQuote, ...(category ? { category: cat[category] } : {}), ...(audience ? { audience } : {}), ...(fromPrice ? { fromPrice } : {}) }
      ids[title] = await create('services', { shared, locales: { fr: { values: { title } } }, publish: ['fr'] })
    }
    // Jamais publié : il aurait sa place dans plusieurs filtres, et ne doit apparaître qu'en aperçu.
    ids[DRAFT] = await create('services', { shared: { onQuote: true, category: cat.pro, audience: 'companies' }, locales: { fr: { values: { title: DRAFT } } } })
  })

  await step('sans paramètre : tableau complet des contenus publiés', async () => {
    const list = await expectTitles(anon, '', ALL, 'liste complète')
    check(Array.isArray(list), 'un tableau est attendu, pas un objet de pagination')
  })

  await step('?limit=3 : une page avec total, page, limit, pageCount', async () => {
    const r = await expectTitles(anon, '?limit=3', ALL.slice(0, 3), 'page 1')
    const { items, ...paging } = r
    check(same(paging, { total: 7, page: 1, limit: 3, pageCount: 3 }), JSON.stringify(paging))
    check(same(Object.keys(r).sort(), ['items', 'limit', 'page', 'pageCount', 'total']), 'clés : ' + Object.keys(r).join())
    await expectTitles(anon, '?limit=3&page=2', ALL.slice(3, 6), 'page 2')
  })

  await step('dernière page incomplète, page au-delà de la fin vide avec le total conservé', async () => {
    const last = await expectTitles(anon, '?limit=3&page=3', ALL.slice(6), 'page 3')
    check(last.total === 7 && last.page === 3 && last.pageCount === 3, JSON.stringify({ ...last, items: undefined }))
    const beyond = await expectTitles(anon, '?limit=3&page=4', [], 'page 4')
    check(beyond.total === 7 && beyond.page === 4 && beyond.pageCount === 3, JSON.stringify(beyond))
    const whole = await expectTitles(anon, '?limit=100', ALL, 'limit=100')
    check(whole.pageCount === 1, 'pageCount : ' + whole.pageCount)
  })

  await step('l\'ordre suit l\'ordre manuel, avec et sans pagination', async () => {
    order = ['Médiation', 'Droit fiscal', 'Droit des affaires', 'Successions', 'Baux commerciaux', 'Droit social', 'Droit de la famille']
    // Le brouillon fait partie de la collection : il est dans la liste envoyée, au milieu.
    const sent = [...order.slice(0, 2), DRAFT, ...order.slice(2)].map(title => ids[title])
    const r = await admin.put('/api/cms/entries/services/order', { ids: sent })
    check(r.status === 200, 'enregistrement de l\'ordre : ' + r.status + ' ' + r.text.slice(0, 200))
    await expectTitles(anon, '', order, 'liste complète')
    await expectTitles(anon, '?limit=3', order.slice(0, 3), 'page 1')
    await expectTitles(anon, '?limit=3&page=2', order.slice(3, 6), 'page 2')
    await expectTitles(anon, '?limit=3&page=3', order.slice(6), 'page 3')
  })

  // Les résultats attendus des filtres suivent l'ordre manuel enregistré ci-dessus.
  const only = (...wanted) => order.filter(title => wanted.includes(title))
  const where = (field, value) => `where[${field}]=${encodeURIComponent(value)}`

  await step('filtres : relation, liste de choix, interrupteur (vrai et faux)', async () => {
    await expectTitles(anon, '?' + where('category', cat.pro), only('Droit des affaires', 'Droit social', 'Droit fiscal'), 'catégorie Entreprises')
    await expectTitles(anon, '?' + where('category', cat.perso), only('Droit de la famille', 'Successions'), 'catégorie Particuliers')
    await expectTitles(anon, '?' + where('audience', 'individuals'), only('Droit fiscal', 'Droit de la famille', 'Successions'), 'public particuliers')
    await expectTitles(anon, '?' + where('onQuote', 'true'), only('Droit des affaires', 'Successions', 'Médiation'), 'sur devis')
    await expectTitles(anon, '?' + where('onQuote', 'false'), only('Droit social', 'Droit fiscal', 'Droit de la famille', 'Baux commerciaux'), 'pas sur devis')
  })

  await step('filtres : nombre, texte, deux filtres cumulés, filtre et pagination', async () => {
    await expectTitles(anon, '?' + where('fromPrice', '150'), only('Droit social', 'Droit de la famille'), 'tarif 150')
    await expectTitles(anon, '?' + where('title', 'Droit social'), ['Droit social'], 'titre exact')
    await expectTitles(anon, '?' + where('title', 'Droit'), [], 'titre partiel (pas de recherche approximative)')
    await expectTitles(anon, `?${where('category', cat.pro)}&${where('audience', 'companies')}`, only('Droit des affaires', 'Droit social'), 'catégorie et public')
    await expectTitles(anon, `?${where('category', cat.pro)}&${where('onQuote', 'false')}&${where('fromPrice', '200')}`, ['Droit fiscal'], 'trois filtres')
    const paged = await expectTitles(anon, `?${where('onQuote', 'false')}&limit=3&page=2`, only('Droit social', 'Droit fiscal', 'Droit de la famille', 'Baux commerciaux').slice(3), 'filtre paginé, page 2')
    check(paged.total === 4 && paged.pageCount === 2, JSON.stringify({ total: paged.total, pageCount: paged.pageCount }))
    const filtered = await anon.get(`${LIST}?${where('category', cat.pro)}`)
    check(filtered.json[0].category?.title === 'Entreprises', 'la relation d\'un résultat filtré doit rester résolue : ' + JSON.stringify(filtered.json[0].category))
  })

  await step('brouillons : exclus, inclus avec ?preview=1 seulement pour une personne connectée', async () => {
    const withDraft = [...order.slice(0, 2), DRAFT, ...order.slice(2)]
    await expectTitles(anon, '?preview=1', order, 'aperçu sans connexion')
    await expectTitles(admin, '', order, 'connecté sans aperçu')
    await expectTitles(admin, '?preview=1', withDraft, 'aperçu connecté')
    await expectTitles(anon, `?${where('category', cat.pro)}&preview=1`, only('Droit des affaires', 'Droit social', 'Droit fiscal'), 'filtre en aperçu sans connexion')
    const filtered = await expectTitles(admin, `?${where('category', cat.pro)}&preview=1&limit=10`, withDraft.filter(title => [DRAFT, 'Droit des affaires', 'Droit social', 'Droit fiscal'].includes(title)), 'filtre en aperçu connecté')
    check(filtered.total === 4, 'total en aperçu : ' + filtered.total)
    const count = await anon.get(LIST + '?limit=1')
    check(count.json.total === 7, 'le brouillon est compté dans le total public : ' + count.json.total)
  })

  await step('demandes invalides : 400', async () => {
    const bad = ['limit=0', 'limit=101', 'limit=abc', 'page=2', 'limit=5&page=0', 'where[cover]=x', 'where[inconnu]=x', 'where[body]=x']
    const got = []
    for (const query of bad) got.push(`${query} → ${(await anon.get(`${LIST}?${query}`)).status}`)
    check(got.every(line => line.endsWith('→ 400')), got.filter(line => !line.endsWith('→ 400')).join(' ; '))
  })

  await step('valeur hostile dans un filtre : traitée comme du texte', async () => {
    const hostile = 'x\' or \'1\'=\'1'
    await expectTitles(anon, '?' + where('title', hostile), [], 'titre')
    await expectTitles(anon, '?' + where('category', hostile), [], 'catégorie')
    const paged = await expectTitles(anon, `?${where('title', hostile)}&limit=5`, [], 'titre, paginé')
    check(paged.total === 0, 'total : ' + paged.total)
    await expectTitles(anon, '', order, 'la collection est intacte')
  })

  await step('accueil : un lien seul vers une page est résolu avec son adresse', async () => {
    // Aucune relation vers ce service sur l'accueil : le lien doit suffire à faire charger sa cible.
    const target = ids['Droit des affaires']
    // Un singleton est créé vide à sa première lecture par le formulaire : on fait comme lui.
    await admin.json('/api/cms/entries/home/home')
    const saved = await admin.put('/api/cms/entries/home/home', { locales: { fr: { values: { heroTitle: 'Un conseil clair', cta: { kind: 'page', type: 'services', id: target } } } }, publish: ['fr'] })
    check(saved.status === 200, 'enregistrement de l\'accueil : ' + saved.status + ' ' + saved.text.slice(0, 200))
    const home = (await anon.get('/api/content/home')).json
    check(same(home.featured, []), 'aucune relation attendue : ' + JSON.stringify(home.featured))
    check(home.cta?.href === '/services/droit-des-affaires' && home.cta.label === 'Droit des affaires' && home.cta.newTab === false, 'lien : ' + JSON.stringify(home.cta))
  })
}
