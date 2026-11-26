// Flux RSS d'une collection et fichier /llms.txt. Sans navigateur.
import fs from 'node:fs'
import { check } from '../lib/harness.mjs'

export const meta = { title: 'flux RSS et llms.txt : pages en ligne, résumés, langues' }

const S = 'https://cabinet-durand.fr'

export default async function (t) {
  const { B, step } = t
  const admin = t.http(), anon = t.http()
  const create = async (type, body) => (await admin.json(`/api/cms/entries/${type}`, { method: 'POST', body })).id
  const feed = async (path = '/feeds/services.xml') => { const r = await anon.get(path); return { ...r, items: [...r.text.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => m[1]) } }
  const tag = (xml, name) => xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1] ?? null
  let cover

  await step('préparation : accueil, services (résumé, image, texte, traduction, page masquée, brouillon)', async () => {
    check((await admin.signIn(t.admin.email, t.admin.password)).status === 200, 'connexion refusée')
    const form = new FormData()
    form.append('file', new Blob([fs.readFileSync(t.fixture('Photo du Cabinet.png'))], { type: 'image/png' }), 'cabinet.png')
    cover = await fetch(B + '/api/cms/media', { method: 'POST', body: form, headers: { cookie: admin.cookie(), origin: B } }).then(r => r.json())
    await admin.json('/api/cms/entries/home/home', { method: 'PUT', body: { locales: { fr: { values: { heroTitle: 'Un conseil clair', heroText: 'Des avocats à vos côtés.', seo: { description: 'Le cabinet Durand accompagne les entreprises.' } } } }, publish: ['fr'] } })
    await create('services', { shared: { onQuote: true, cover: cover.id }, locales: { fr: { values: { title: 'Droit des affaires & des sociétés', excerpt: 'Création, contrats, cessions.', body: '<h2>Notre approche</h2><p>Un texte <strong>entier</strong>.</p>' } }, en: { values: { title: 'Business law', excerpt: 'Companies and contracts.' } } }, publish: ['fr', 'en'] })
    await create('services', { shared: { onQuote: true }, locales: { fr: { values: { title: 'Droit social', body: '<p>Contrats de travail et licenciements, pour les employeurs comme pour les salariés.</p>' } } }, publish: ['fr'] })
    await create('services', { shared: { onQuote: true, seo: { noindex: true } }, locales: { fr: { values: { title: 'Page masquée' } } }, publish: ['fr'] })
    await create('services', { shared: { onQuote: true }, locales: { fr: { values: { title: 'Brouillon' } } } })
  })

  await step('flux RSS : pages en ligne seulement, les plus récentes d\'abord, résumé, texte entier, image jointe', async () => {
    const r = await feed()
    check(r.status === 200 && /application\/rss\+xml/.test(r.headers.get('content-type') ?? '') && /^public, /.test(r.headers.get('cache-control') ?? ''), `${r.status} ${r.headers.get('content-type')}`)
    check(r.text.startsWith('<?xml version="1.0" encoding="UTF-8"?>') && tag(r.text, 'title') === 'Services — Cabinet Durand' && tag(r.text, 'language') === 'fr', r.text.slice(0, 300))
    check(tag(r.text, 'description') === 'Cabinet d\'avocats en droit des affaires, à Lyon.'.replace('\'', '&apos;') && r.text.includes(`<atom:link href="${S}/feeds/services.xml" rel="self"`), 'en-tête du flux')
    check(r.items.length === 2 && tag(r.items[0], 'title') === 'Droit social' && tag(r.items[1], 'title') === 'Droit des affaires &amp; des sociétés', r.items.map(i => tag(i, 'title')).join(' | '))
    const [social, affaires] = r.items
    check(tag(affaires, 'link') === `${S}/services/droit-des-affaires-des-societes` && tag(affaires, 'guid') === tag(affaires, 'link'), tag(affaires, 'link'))
    check(tag(affaires, 'description') === 'Création, contrats, cessions.' && affaires.includes('<content:encoded><![CDATA[<h2>Notre approche</h2><p>Un texte <strong>entier</strong>.</p>]]>'), affaires)
    check(affaires.includes(`<enclosure url="${S}${cover.url}" length="${cover.size}" type="image/png"/>`), 'image jointe : ' + affaires)
    // Sans résumé saisi : le début du texte. Sans image : pas de pièce jointe.
    check(tag(social, 'description').startsWith('Contrats de travail et licenciements') && !social.includes('enclosure'), social)
    check(!Number.isNaN(Date.parse(tag(social, 'pubDate'))), 'date : ' + tag(social, 'pubDate'))
  })

  await step('flux RSS : par langue, adresses inconnues refusées', async () => {
    const en = await feed('/feeds/en/services.xml')
    check(en.status === 200 && en.items.length === 1 && tag(en.items[0], 'title') === 'Business law' && tag(en.items[0], 'link') === `${S}/en/services/business-law` && tag(en.text, 'language') === 'en', en.text.slice(0, 400))
    check(tag(en.text, 'description') === 'Business law firm in Lyon.' && tag(en.text, 'link') === `${S}/en/`, 'en-tête en anglais')
    // Collection sans flux, collection inconnue, langue inconnue, langue par défaut écrite en préfixe.
    for (const path of ['/feeds/categories.xml', '/feeds/products.xml', '/feeds/inconnu.xml', '/feeds/de/services.xml', '/feeds/fr/services.xml', '/feeds/services', '/feeds/home.xml'])
      check((await anon.get(path)).status === 404, `${path} servi`)
  })

  await step('llms.txt : pages et résumés par rubrique, flux annoncés, langue', async () => {
    const r = await anon.get('/llms.txt')
    check(r.status === 200 && /text\/plain/.test(r.headers.get('content-type') ?? '') && /^public, /.test(r.headers.get('cache-control') ?? ''), `${r.status} ${r.headers.get('content-type')}`)
    const want = [
      '# Cabinet Durand', '', '> Cabinet d\'avocats en droit des affaires, à Lyon.', '',
      '## Pages', '', `- [Accueil](${S}/): Le cabinet Durand accompagne les entreprises.`, '',
      '## Services', '',
      `- [Droit des affaires & des sociétés](${S}/services/droit-des-affaires-des-societes): Création, contrats, cessions.`,
      `- [Droit social](${S}/services/droit-social): Contrats de travail et licenciements, pour les employeurs comme pour les salariés.`, '',
      '## Flux RSS', '', `- [Services](${S}/feeds/services.xml)`, '',
    ].join('\n')
    check(r.text === want, JSON.stringify(r.text))
    const en = await anon.get('/llms.txt?locale=en')
    check(en.text.includes('> Business law firm in Lyon.') && en.text.includes(`- [Business law](${S}/en/services/business-law): Companies and contracts.`) && !en.text.includes('Droit social') && en.text.includes(`${S}/feeds/en/services.xml`), en.text)
    check((await anon.get('/llms.txt?locale=de')).status === 404, 'langue inconnue servie')
  })

  await step('site en construction : rien à lire ; page du site : flux annoncé dans l\'en-tête', async () => {
    await admin.json('/api/cms/availability', { method: 'PUT', body: { mode: 'construction' } })
    check((await anon.get('/llms.txt')).text === '# Cabinet Durand\n', 'pages listées pendant la construction')
    await admin.json('/api/cms/availability', { method: 'PUT', body: { mode: 'online' } })
    const html = await fetch(B + '/lettre').then(r => r.text())
    check(/<link[^>]+type="application\/rss\+xml"[^>]+href="\/feeds\/services\.xml"/.test(html) || /<link[^>]+href="\/feeds\/services\.xml"[^>]+type="application\/rss\+xml"/.test(html), 'flux non annoncé')
    check(html.includes('data-feed-link') && html.includes('href="/feeds/services.xml"'), 'lien « Flux RSS » absent')
  })
}
