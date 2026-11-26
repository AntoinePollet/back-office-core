// Recherche du site : route publique /api/search et page d'exemple du playground. Sans navigateur.
import { check } from '../lib/harness.mjs'

export const meta = { title: 'recherche du site : pages publiées, accents, extraits, langues' }

export default async function (t) {
  const { B, step } = t
  const admin = t.http(), anon = t.http()
  const create = async (type, body) => (await admin.json(`/api/cms/entries/${type}`, { method: 'POST', body })).id
  const search = async (query) => {
    const r = await anon.get('/api/search?' + query)
    check(r.status === 200, `${query} : statut ${r.status} ${r.text.slice(0, 200)}`)
    return r.json
  }
  const titles = r => r.items.map(i => i.title)
  const text = parts => parts.map(p => (p.match ? `[${p.text}]` : p.text)).join('')
  const same = (got, want) => JSON.stringify(got) === JSON.stringify(want)
  const ids = {}

  await step('préparation : accueil, trois services en ligne (dont un masqué), un brouillon, une traduction', async () => {
    check((await admin.signIn(t.admin.email, t.admin.password)).status === 200, 'connexion refusée')
    await admin.json('/api/cms/entries/home/home', { method: 'PUT', body: { locales: { fr: { values: { heroTitle: 'Un cabinet d\'avocats à Lyon', heroText: 'Des réponses claires, sans jargon.' } } }, publish: ['fr'] } })
    ids.affaires = await create('services', {
      shared: { onQuote: true },
      locales: {
        fr: { values: { title: 'Droit des affaires', excerpt: 'Conseil aux entreprises.', body: '<h2>Notre approche</h2><p>Nous accompagnons les <strong>sociétés</strong> lyonnaises à chaque étape de leur vie, de la création à la cession.</p>', seo: { description: 'Création, contrats et cessions de sociétés.' } } },
        en: { values: { title: 'Business law', body: '<p>We advise companies in Lyon.</p>' } },
      },
      publish: ['fr', 'en'],
    })
    ids.social = await create('services', { shared: { onQuote: true }, locales: { fr: { values: { title: 'Droit social', body: '<p>Contrats de travail, licenciements et élections du personnel.</p>' } } }, publish: ['fr'] })
    ids.fiscal = await create('services', { shared: { onQuote: true, seo: { noindex: true } }, locales: { fr: { values: { title: 'Droit fiscal', body: '<p>Page masquée des moteurs de recherche.</p>' } } }, publish: ['fr'] })
    ids.draft = await create('services', { shared: { onQuote: true }, locales: { fr: { values: { title: 'Droit en préparation' } } } })
    // Une collection sans page n'est pas cherchée.
    await create('categories', { locales: { fr: { values: { name: 'Droit des catégories' } } } })
  })

  await step('recherche par le titre : pages en ligne seulement, ni brouillon, ni page masquée, ni contenu sans page', async () => {
    const r = await search('q=droit')
    check(same(titles(r), ['Droit des affaires', 'Droit social']) && r.total === 2 && r.query === 'droit', JSON.stringify(r))
    const [first] = r.items
    check(first.type === 'services' && first.typeLabel === 'Services' && first.id === ids.affaires && first.path === '/services/droit-des-affaires' && first.url === 'https://cabinet-durand.fr/services/droit-des-affaires', JSON.stringify(first))
    check(first.image === null, 'vignette inattendue')
    // Le mot est dans le titre : l'extrait montre le début de la description.
    check(text(first.excerpt) === 'Création, contrats et cessions de sociétés.', text(first.excerpt))
  })

  await step('sans accents ni majuscules, dans le texte : extrait autour du mot, mis en évidence', async () => {
    const r = await search('q=' + encodeURIComponent('SOCIETES lyonnaises'))
    check(same(titles(r), ['Droit des affaires']), JSON.stringify(titles(r)))
    const excerpt = text(r.items[0].excerpt)
    check(excerpt.includes('[sociétés]') && excerpt.includes('[lyonnaises]') && !excerpt.includes('<'), excerpt)
    const work = await search('q=licenciement')
    check(same(titles(work), ['Droit social']) && text(work.items[0].excerpt).includes('[licenciement]s'), JSON.stringify(work.items[0]))
    // Chaque mot doit se trouver dans la page.
    check((await search('q=' + encodeURIComponent('droit licenciement'))).total === 1, 'deux mots : une seule page les contient')
    check((await search('q=' + encodeURIComponent('droit introuvable'))).total === 0, 'un mot absent : aucune page')
  })

  await step('page unique : trouvée par son texte, nommée par son nom', async () => {
    const r = await search('q=avocats')
    check(same(titles(r), ['Accueil']) && r.items[0].path === '/' && r.items[0].type === 'home', JSON.stringify(r.items))
    check(text(r.items[0].excerpt) === 'Un cabinet d\'[avocats] à Lyon', text(r.items[0].excerpt))
  })

  await step('recherche trop courte ou sans résultat : liste vide ; limites et types vérifiés', async () => {
    for (const q of ['q=d', 'q=', '', 'q=zzzz']) check((await search(q)).items.length === 0, `« ${q} » : résultats inattendus`)
    const one = await search('q=droit&limit=1')
    check(one.items.length === 1 && one.total === 2, JSON.stringify(one))
    check(same(titles(await search('q=lyon&types=services')), ['Droit des affaires']), 'filtre par type')
    check((await search('q=lyon')).total === 2, 'sans filtre : accueil et service')
    for (const bad of ['q=droit&limit=0', 'q=droit&limit=51', 'q=droit&limit=x', 'q=droit&types=categories', 'q=droit&types=inconnu']) {
      const r = await anon.get('/api/search?' + bad)
      check(r.status === 400, `${bad} : statut ${r.status}`)
    }
  })

  await step('langues : chaque langue cherche ses pages', async () => {
    const en = await search('q=law&locale=en')
    check(same(titles(en), ['Business law']) && en.items[0].path === '/en/services/business-law', JSON.stringify(en.items))
    check((await search('q=droit&locale=en')).total === 0, 'pages françaises trouvées en anglais')
    check((await search('q=law')).total === 0, 'page anglaise trouvée en français')
    check((await anon.get('/api/search?q=law&locale=de')).status === 404, 'langue inconnue acceptée')
  })

  await step('réponse publique mise en cache ; retirée du site, une page disparaît des résultats', async () => {
    const r = await anon.get('/api/search?q=droit')
    check(/^public, /.test(r.headers.get('cache-control') ?? ''), 'cache-control : ' + r.headers.get('cache-control'))
    const put = async (id, body) => { const r = await admin.put(`/api/cms/entries/services/${id}`, body); check(r.status === 200, `${JSON.stringify(body)} → ${r.status} ${r.json?.message ?? ''} ${JSON.stringify(r.json?.data ?? '')}`) }
    await put(ids.social, { unpublish: ['fr'] })
    check(same(titles(await search('q=droit')), ['Droit des affaires']), 'page retirée encore trouvée')
    await put(ids.draft, { locales: { fr: { values: { title: 'Droit en préparation' } } }, publish: ['fr'] })
    check(same(titles(await search('q=droit')), ['Droit des affaires', 'Droit en préparation']), 'page publiée non trouvée')
  })

  await step('page du site : résultats rendus par le serveur, mots en évidence', async () => {
    const html = await fetch(B + '/recherche?q=' + encodeURIComponent('sociétés')).then(r => r.text())
    check(html.includes('data-search-result') && html.includes('Droit des affaires') && /<mark[^>]*>sociétés<\/mark>/.test(html), 'résultats absents du HTML')
    const none = await fetch(B + '/recherche?q=zzzz').then(r => r.text())
    check(none.includes('data-search-empty') && !none.includes('data-search-result'), 'message « aucune page » absent')
  })
}
