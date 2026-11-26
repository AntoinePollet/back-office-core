// Données structurées (JSON-LD) : blocs déclarés dans cms.config.ts, organisme sur l'accueil, fil d'Ariane, aperçu.
import { check, login } from '../lib/harness.mjs'

export const meta = { title: 'données structurées : FAQ, organisme, fil d\'Ariane, aperçu dans l\'onglet Référencement' }

const S = 'https://cabinet-durand.fr'

export default async function (t) {
  const { B, step } = t
  const admin = t.http(), anon = t.http()
  // Un enregistrement remplace les valeurs de la partie envoyée (champs communs, ou une langue) : elles sont envoyées entières.
  const put = async (url, body) => {
    const r = await admin.put(url, body)
    check(r.status === 200, `PUT ${url} → ${r.status} ${r.json?.message ?? ''} ${JSON.stringify(r.json?.data ?? '')}`)
    return r.json
  }
  const types = blocks => blocks.map(b => b['@type'])
  const same = (got, want) => JSON.stringify(got) === JSON.stringify(want)
  /** Blocs JSON-LD d'une page rendue : le graphe du core, et le bloc « WebSite » de l'accueil. */
  const scripts = async (path, headers) => {
    const html = await fetch(B + path, { headers }).then(r => r.text())
    return [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([^<]+)<\/script>/g)].map(m => JSON.parse(m[1]))
  }
  let service

  await step('accueil sans question ni coordonnées : aucun bloc', async () => {
    check((await admin.signIn(t.admin.email, t.admin.password)).status === 200, 'connexion refusée')
    await put('/api/cms/entries/home/home', { locales: { fr: { values: { heroTitle: 'Un conseil clair' } } }, publish: ['fr'] })
    const home = (await anon.get('/api/content/home')).json
    check(same(home.structuredData, []), JSON.stringify(home.structuredData))
    check(same((await scripts('/')).map(s => s['@type']), ['WebSite']), 'accueil : un seul bloc attendu')
  })

  await step('questions fréquentes : bloc FAQPage, éléments incomplets ignorés, texte qui ne ferme pas la balise', async () => {
    await put('/api/cms/entries/home/home', {
      locales: { fr: { values: { heroTitle: 'Un conseil clair', faq: [
        { question: 'Quels sont vos honoraires ?', answer: 'Ils sont fixés par convention </script><b>dès le premier rendez-vous.', hasLink: false },
        { question: 'Recevez-vous le samedi ?', answer: 'Oui, sur rendez-vous.', hasLink: false },
      ] } } },
      publish: ['fr'],
    })
    const home = (await anon.get('/api/content/home')).json
    check(same(types(home.structuredData), ['FAQPage']), JSON.stringify(home.structuredData))
    const [faq] = home.structuredData
    check(faq.mainEntity.length === 2 && faq.mainEntity[1].name === 'Recevez-vous le samedi ?' && faq.mainEntity[1].acceptedAnswer.text === 'Oui, sur rendez-vous.', JSON.stringify(faq))
    const [website, graph] = await scripts('/')
    check(website['@type'] === 'WebSite' && graph['@context'] === 'https://schema.org' && same(types(graph['@graph']), ['FAQPage']), JSON.stringify(graph))
    check(graph['@graph'][0].mainEntity[0].acceptedAnswer.text.includes('</script><b>'), 'texte altéré')
  })

  await step('organisme : coordonnées d\'une page unique sans adresse, émises sur l\'accueil seulement', async () => {
    await put('/api/cms/entries/settings/settings', { shared: { phone: '04 72 00 00 00', email: 'contact@cabinet-durand.fr' }, locales: { fr: { values: { address: '12 rue de la République\n69002 Lyon' } } } })
    const home = (await anon.get('/api/content/home')).json
    check(same(types(home.structuredData), ['FAQPage', 'LegalService']), JSON.stringify(types(home.structuredData)))
    const org = home.structuredData[1]
    check(same(org, {
      '@type': 'LegalService', '@id': S + '/#organization', 'name': 'Cabinet Durand', 'url': S, 'telephone': '04 72 00 00 00', 'email': 'contact@cabinet-durand.fr', 'logo': S + '/logo.svg',
      'address': { '@type': 'PostalAddress', 'streetAddress': '12 rue de la République 69002 Lyon', 'addressCountry': 'FR' },
    }), JSON.stringify(org))
    // Le contenu réservé aux administrateurs n'est pas lisible autrement.
    check((await anon.get('/api/content/settings')).status !== 200 || !(await anon.get('/api/content/settings')).json?.structuredData?.length, 'réglages exposés')
  })

  await step('fil d\'Ariane : déduit des adresses, sur la page d\'un contenu, pas dans les listes', async () => {
    const created = await admin.json('/api/cms/entries/services', { method: 'POST', body: {
      shared: { onQuote: true },
      locales: { fr: { values: { title: 'Droit des affaires' } }, en: { values: { title: 'Business law' } } },
      publish: ['fr', 'en'],
    } })
    service = created.id
    const one = (await anon.get('/api/content/services/droit-des-affaires')).json
    check(same(one.structuredData, [{ '@type': 'BreadcrumbList', 'itemListElement': [
      { '@type': 'ListItem', 'position': 1, 'name': 'Accueil', 'item': S + '/' },
      { '@type': 'ListItem', 'position': 2, 'name': 'Droit des affaires', 'item': S + '/services/droit-des-affaires' },
    ] }]), JSON.stringify(one.structuredData))
    const list = (await anon.get('/api/content/services')).json
    check(list.length === 1 && !('structuredData' in list[0]), 'données structurées dans une liste')
    const paged = (await anon.get('/api/content/services?limit=5')).json
    check(!('structuredData' in paged.items[0]), 'données structurées dans une page de liste')
    const [graph] = await scripts('/services/droit-des-affaires')
    check(same(types(graph['@graph']), ['BreadcrumbList']), JSON.stringify(graph))
    // L'accueil n'est pas publié en anglais : pas de page parente, donc pas de fil.
    const en = (await anon.get('/api/content/services/business-law?locale=en')).json
    check(same(en.structuredData, []), 'fil d\'Ariane sans page parente : ' + JSON.stringify(en.structuredData))
    await put('/api/cms/entries/home/home', { locales: { en: { values: { heroTitle: 'Clear advice' } } }, publish: ['en'] })
    const trail = (await anon.get('/api/content/services/business-law?locale=en')).json.structuredData[0].itemListElement
    check(trail[0].item === S + '/en/' && trail[1].item === S + '/en/services/business-law' && trail[1].name === 'Business law', JSON.stringify(trail))
  })

  await step('jamais en aperçu ni sur une page masquée des moteurs de recherche', async () => {
    const preview = (await admin.get('/api/content/services/droit-des-affaires?preview=1')).json
    check(!('structuredData' in preview), 'données structurées dans un aperçu')
    check(!(await fetch(B + '/services/droit-des-affaires?preview=1', { headers: { cookie: admin.cookie() } }).then(r => r.text())).includes('application/ld+json'), 'balise dans un aperçu')
    await admin.json('/api/cms/entries/services', { method: 'POST', body: { shared: { onQuote: true, seo: { noindex: true } }, locales: { fr: { values: { title: 'Droit fiscal' } } }, publish: ['fr'] } })
    check(same((await anon.get('/api/content/services/droit-fiscal')).json.structuredData, []), 'page masquée : blocs émis')
    check((await scripts('/services/droit-fiscal')).length === 0, 'page masquée : balise émise')
  })

  await step('onglet Référencement : aperçu des blocs, qui suit la saisie', async () => {
    const page = await t.newPage()
    await login(page, B)
    await page.goto(B + '/admin/home?tab=seo', { waitUntil: 'networkidle0' })
    await page.waitForSelector('[data-seo-structured] [data-seo-block="FAQPage"]')
    const faq = await page.$eval('[data-seo-block="FAQPage"]', el => el.innerText.replace(/\s+/g, ' '))
    check(faq.includes('Questions fréquentes') && faq.includes('2 questions') && faq.includes('« Quels sont vos honoraires ? »'), faq)
    const note = await page.$eval('[data-seo-block="organization-from"]', el => el.innerText)
    check(note.includes('« Réglages du site »'), note)
    const code = await page.$eval('[data-seo-structured-code]', el => el.textContent)
    check(JSON.parse(code)['@graph'][0]['@type'] === 'FAQPage', code.slice(0, 200))
    // Un service : le fil d'Ariane suit le titre saisi, sans enregistrer.
    await page.goto(B + `/admin/services/${service}?tab=seo`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('[data-seo-block="BreadcrumbList"]')
    const trail = await page.$eval('[data-seo-block="BreadcrumbList"]', el => el.innerText.replace(/\s+/g, ' '))
    check(trail.includes('Fil d\'Ariane') && trail.includes('Accueil › Droit des affaires'), trail)
    await t.shot(page, 'donnees-structurees')
  })
}
