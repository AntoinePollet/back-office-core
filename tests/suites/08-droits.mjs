// Rôles et droits : rédacteur, droits par collection (option `access`), contenus réservés, contenus attribués par personne.
// Le serveur fait foi : presque tout est vérifié par l'API, puis une étape contrôle ce que l'interface affiche.
import { check, clickText, login, menuLabels, says } from '../lib/harness.mjs'

export const meta = { title: 'rôles et droits par contenu' }

const MARC = { name: 'Marc Petit', email: 'marc@example.com', password: 'mot-de-passe-de-marc', role: 'editor' }
const LINA = { name: 'Lina Roux', email: 'lina@example.com', password: 'mot-de-passe-de-lina', role: 'writer' }

export default async function (t) {
  const { step, admin, B: base } = t
  const claire = t.http(), marc = t.http(), lina = t.http(), visitor = t.http()
  const ids = {}
  const service = (title, extra = {}) => ({ shared: { onQuote: true }, locales: { fr: { values: { title } } }, ...extra })
  const publicTitles = async (q = '') => (await visitor.json('/api/content/services' + q)).map(s => s.title)

  await step('préparation : un éditeur et un rédacteur invités', async () => {
    check((await claire.signIn(admin.email, admin.password)).status === 200, 'connexion de l\'administratrice refusée')
    for (const [who, client] of [[MARC, marc], [LINA, lina]]) {
      const { id, link } = await claire.json('/api/cms/users', { method: 'POST', body: { name: who.name, email: who.email, role: who.role } })
      who.id = id
      check((await visitor.post(link.replace(/^.*\/admin\/invite\//, '/api/cms/invite/'), { password: who.password })).status === 200, 'mot de passe refusé pour ' + who.name)
      check((await client.signIn(who.email, who.password)).status === 200, 'connexion refusée pour ' + who.name)
    }
    ids.categorie = (await claire.json('/api/cms/entries/categories', { method: 'POST', body: { locales: { fr: { values: { name: 'Entreprises' } } } } })).id
  })

  await step('droits annoncés au rédacteur : il prépare, ne publie pas, ne voit pas ce qui lui est fermé', async () => {
    const me = await lina.json('/api/cms/me')
    check(me.role === 'writer', 'rôle : ' + me.role)
    const want = {
      services: { edit: true, publish: false, delete: false },
      testimonials: { edit: true, publish: true, delete: false }, // access: { publish: ['editor', 'writer'] }
      categories: { edit: false, publish: false, delete: false }, // sans brouillons : modifier = publier
      settings: { edit: false, publish: false, delete: false }, // adminOnly
    }
    for (const [type, rights] of Object.entries(want)) check(JSON.stringify(me.access[type]) === JSON.stringify(rights), `${type} : ${JSON.stringify(me.access[type])}`)
    const schema = await lina.json('/api/cms/schema')
    const seen = [...Object.keys(schema.collections), ...Object.keys(schema.singletons)].sort().join()
    check(seen === 'home,services,testimonials', 'contenus visibles : ' + seen)
  })

  await step('rédacteur : crée et modifie un brouillon, publication refusée (403)', async () => {
    const created = await lina.post('/api/cms/entries/services', service('Brouillon de Lina'))
    check(created.status === 200 && created.json.locales.fr.status === 'draft', 'création : ' + created.status + ' ' + created.text.slice(0, 150))
    ids.service = created.json.id
    const edited = await lina.put(`/api/cms/entries/services/${ids.service}`, service('Brouillon de Lina, relu'))
    check(edited.status === 200, 'modification : ' + edited.status)
    const pub = await lina.put(`/api/cms/entries/services/${ids.service}`, service('Brouillon de Lina, relu', { publish: ['fr'] }))
    check(pub.status === 403 && /pas le publier/.test(pub.json?.message ?? ''), `publication : ${pub.status} ${pub.text.slice(0, 200)}`)
    check((await publicTitles()).length === 0, 'un contenu est en ligne alors que la publication a été refusée')
  })

  await step('éditeur : publie ; le rédacteur ne peut ni retirer, ni supprimer, ni réordonner, ni changer l\'adresse', async () => {
    const pub = await marc.put(`/api/cms/entries/services/${ids.service}`, service('Service publié', { publish: ['fr'] }))
    check(pub.status === 200 && (await publicTitles()).join() === 'Service publié', 'publication par l\'éditeur : ' + pub.status)
    const codes = {
      retrait: (await lina.put(`/api/cms/entries/services/${ids.service}`, { unpublish: ['fr'] })).status,
      suppression: (await lina.del(`/api/cms/entries/services/${ids.service}`)).status,
      ordre: (await lina.put('/api/cms/entries/services/order', { ids: [ids.service] })).status,
      adresse: (await lina.put(`/api/cms/entries/services/${ids.service}`, { locales: { fr: { slug: 'autre-adresse', values: { title: 'Service publié' } } } })).status,
    }
    check(Object.values(codes).every(c => c === 403), JSON.stringify(codes))
    check((await publicTitles()).join() === 'Service publié' && (await visitor.get('/api/content/services/brouillon-de-lina')).status === 200, 'le site a changé malgré les refus')
  })

  await step('rédacteur : modifie le brouillon d\'une page en ligne sans toucher au site', async () => {
    const r = await lina.put(`/api/cms/entries/services/${ids.service}`, service('Service publié, nouvelle version'))
    check(r.status === 200 && r.json.locales.fr.status === 'changed', `${r.status} ${r.json?.locales?.fr?.status}`)
    check((await publicTitles()).join() === 'Service publié', 'le brouillon est passé en ligne')
  })

  await step('droit accordé par collection : le rédacteur publie un témoignage, mais ne le supprime pas', async () => {
    const r = await lina.post('/api/cms/entries/testimonials', { shared: { author: 'Client' }, locales: { fr: { values: { quote: 'Très bien.' } } }, publish: ['fr'] })
    check(r.status === 200 && r.json.locales.fr.status === 'published', `publication : ${r.status} ${r.text.slice(0, 150)}`)
    check((await lina.del(`/api/cms/entries/testimonials/${r.json.id}`)).status === 403, 'suppression acceptée')
    check((await marc.del(`/api/cms/entries/testimonials/${r.json.id}`)).status === 200, 'suppression par l\'éditeur refusée')
  })

  await step('collection sans brouillons : fermée au rédacteur, qui n\'en reçoit que les titres pour ses champs relation', async () => {
    const codes = [
      (await lina.post('/api/cms/entries/categories', { locales: { fr: { values: { name: 'Pirate' } } } })).status,
      (await lina.put(`/api/cms/entries/categories/${ids.categorie}`, { locales: { fr: { values: { name: 'Pirate' } } } })).status,
      (await lina.get(`/api/cms/entries/categories/${ids.categorie}`)).status,
    ]
    check(codes.join() === '403,403,403', codes.join())
    const list = await lina.json('/api/cms/entries/categories')
    check(list.length === 1 && Object.keys(list[0]).sort().join() === 'id,title' && list[0].title === 'Entreprises', JSON.stringify(list))
    check(Object.keys((await marc.json('/api/cms/entries/categories'))[0]).length > 2, 'l\'éditeur devrait recevoir la liste complète')
  })

  await step('contenu réservé aux administrateurs : ni lecture ni écriture, pour l\'éditeur comme pour le rédacteur', async () => {
    await claire.json('/api/cms/entries/settings/settings')
    for (const client of [marc, lina]) {
      const codes = [
        (await client.get('/api/cms/entries/settings/settings')).status,
        (await client.put('/api/cms/entries/settings/settings', { shared: { phone: '0102030405' }, locales: {} })).status,
        (await client.get('/api/cms/entries/settings/settings/revisions')).status,
      ]
      check(codes.join() === '403,403,403', codes.join())
    }
    check((await claire.get('/api/cms/entries/settings/settings')).status === 200, 'l\'administratrice n\'y accède plus')
  })

  await step('médiathèque : le rédacteur ne supprime pas de fichier', async () => {
    check((await lina.del('/api/cms/media/fichier-inexistant')).status === 403, 'suppression non refusée au rédacteur')
    check((await marc.del('/api/cms/media/fichier-inexistant')).status === 404, 'l\'éditeur devrait passer le contrôle de rôle')
    check((await lina.get('/api/cms/media')).status === 200, 'le rédacteur devrait voir la médiathèque')
  })

  await step('contenus attribués : un éditeur limité aux services perd le reste, puis le retrouve', async () => {
    check((await marc.call(`/api/cms/users/${MARC.id}`, { method: 'PATCH', body: { types: null } })).status === 403, 'un éditeur a modifié des droits')
    check((await claire.call(`/api/cms/users/${MARC.id}`, { method: 'PATCH', body: { types: ['inconnu'] } })).status === 400, 'contenu inconnu accepté')
    check((await claire.call(`/api/cms/users/${MARC.id}`, { method: 'PATCH', body: { types: ['services'] } })).status === 200, 'attribution refusée')
    const me = await marc.json('/api/cms/me')
    check(me.types.join() === 'services' && me.access.services.publish && !me.access.testimonials.edit && !me.access.home.edit, JSON.stringify(me.access))
    const schema = await marc.json('/api/cms/schema')
    check(Object.keys(schema.collections).join() === 'services' && !Object.keys(schema.singletons).length, 'schéma : ' + JSON.stringify([Object.keys(schema.collections), Object.keys(schema.singletons)]))
    const codes = [
      (await marc.get('/api/cms/entries/home/home')).status,
      (await marc.post('/api/cms/entries/testimonials', { shared: { author: 'X' }, locales: { fr: { values: { quote: 'x' } } } })).status,
      (await marc.put(`/api/cms/entries/services/${ids.service}`, service('Toujours modifiable'))).status,
      (await marc.get('/api/cms/entries/categories')).status, // titres seulement, pour le champ relation des services
    ]
    check(codes.join() === '403,403,200,200', codes.join())
    check(Object.keys((await marc.json('/api/cms/entries/categories'))[0]).sort().join() === 'id,title', 'liste complète reçue malgré la limite')
    const users = await claire.json('/api/cms/users')
    check(users.find(u => u.id === MARC.id).types.join() === 'services', 'liste des comptes : ' + JSON.stringify(users.find(u => u.id === MARC.id)))
    await claire.json(`/api/cms/users/${MARC.id}`, { method: 'PATCH', body: { types: null } })
    check((await marc.get('/api/cms/entries/home/home')).status === 200 && (await marc.json('/api/cms/me')).types === null, 'la limite n\'est pas levée')
  })

  await step('aperçu des brouillons : réservé à ceux qui peuvent ouvrir le contenu', async () => {
    const count = async client => (await client.json('/api/content/services?preview=1')).length
    check(await count(lina) === 1 && (await lina.json('/api/content/services?preview=1'))[0].title === 'Toujours modifiable', 'le rédacteur devrait voir le brouillon')
    await claire.json(`/api/cms/users/${LINA.id}`, { method: 'PATCH', body: { types: ['testimonials'] } })
    const limited = await lina.json('/api/content/services?preview=1')
    check(limited.length === 1 && limited[0].title === 'Service publié', 'brouillon visible sans accès : ' + JSON.stringify(limited.map(s => s.title)))
    await claire.json(`/api/cms/users/${LINA.id}`, { method: 'PATCH', body: { types: null } })
  })

  await step('recherche : ne trouve que les contenus accessibles', async () => {
    await claire.json(`/api/cms/users/${LINA.id}`, { method: 'PATCH', body: { types: ['testimonials'] } })
    const found = r => JSON.stringify(r).includes('Toujours modifiable')
    check(!found(await lina.json('/api/cms/search?q=toujours')), 'la recherche a révélé un contenu inaccessible')
    check(found(await marc.json('/api/cms/search?q=toujours')), 'l\'éditeur devrait le trouver')
    await claire.json(`/api/cms/users/${LINA.id}`, { method: 'PATCH', body: { types: null } })
  })

  await step('interface du rédacteur : pas de bouton Publier, menu réduit ; trois rôles côté administrateur', async () => {
    const page = await t.newPage({ context: await t.newContext() })
    await login(page, base, LINA)
    const menu = await menuLabels(page)
    check(menu.includes('Services') && menu.includes('Témoignages') && !menu.includes('Catégories') && !menu.includes('Réglages du site') && !menu.includes('Utilisateurs'), menu.join())
    await page.goto(`${base}/admin/services/${ids.service}`, { waitUntil: 'networkidle0' })
    await says(page, 'La mise en ligne est faite par un éditeur')
    const buttons = await page.$$eval('button', bs => bs.map(b => b.textContent.trim()))
    check(buttons.includes('Enregistrer le brouillon') && !buttons.includes('Publier') && !buttons.some(b => b.includes('Retirer du site')) && !buttons.some(b => b === 'Supprimer'), buttons.join(' | '))

    const adminPage = await t.newPage({ context: await t.newContext() })
    await login(adminPage, base)
    await adminPage.goto(`${base}/admin/users`, { waitUntil: 'networkidle0' })
    const options = await adminPage.$$eval('tbody tr:nth-child(2) select option', os => os.map(o => o.textContent.trim()))
    check(options.join() === 'Rédacteur,Éditeur,Administrateur', 'rôles proposés : ' + options.join())
    await clickText(adminPage, 'tbody button', 'Tous ceux de son rôle')
    await says(adminPage, 'Contenus accessibles à')
  })
}
