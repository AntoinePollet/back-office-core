import assert from 'node:assert/strict'
import { test } from 'node:test'
import { collection, defineCms, f, singleton, validate } from './format'
import {
  WEEKDAYS, breadcrumbBlock, breadcrumbName, breadcrumbTrail, contentBlocks, normalizeTime, parentPaths, sd, specsOf, structuredDataJson, summarizeBlock,
} from './structured-data'

const ctx = {
  site: { name: 'Cabinet Durand', logo: '/logo.svg' }, base: 'https://cabinet-durand.fr', locale: 'fr',
  imageUrl: (value: unknown) => (typeof value === 'string' && value ? `https://cabinet-durand.fr/media/${value}.png` : null),
}
const page = { url: 'https://cabinet-durand.fr/actualites/ouverture', title: 'Titre de référencement', description: 'Résumé de la page', image: 'partage', publishedAt: new Date('2026-03-01T08:00:00Z'), updatedAt: '2026-03-02T09:00:00.000Z' }

const articleFields = {
  title: f.text({ label: 'Titre' }), cover: f.image({ label: 'Image' }), date: f.date({ label: 'Date' }),
  author: f.text({ label: 'Auteur' }), intro: f.textarea({ label: 'Chapô' }),
}

test('article : valeurs par défaut (titre du contenu, description et image du référencement, date de mise en ligne, site pour auteur)', () => {
  const [block] = contentBlocks({ titleField: 'title', fields: articleFields, structuredData: sd.article() }, { title: 'Ouverture du cabinet' }, page, ctx)
  assert.deepEqual(block, {
    '@type': 'Article', 'headline': 'Ouverture du cabinet', 'description': 'Résumé de la page', 'image': ['https://cabinet-durand.fr/media/partage.png'],
    'datePublished': '2026-03-01T08:00:00.000Z', 'dateModified': '2026-03-02T09:00:00.000Z',
    'author': { '@type': 'Organization', 'name': 'Cabinet Durand', 'url': 'https://cabinet-durand.fr' },
    'publisher': { '@type': 'Organization', 'name': 'Cabinet Durand', 'logo': { '@type': 'ImageObject', 'url': 'https://cabinet-durand.fr/logo.svg' } },
    'mainEntityOfPage': page.url, 'inLanguage': 'fr',
  })
})

test('article : champs désignés, auteur en personne, propriétés vides absentes, pas de bloc sans titre', () => {
  const spec = sd.article({ type: 'BlogPosting', image: 'cover', datePublished: 'date', author: 'author', description: 'intro' })
  const [block] = contentBlocks({ titleField: 'title', fields: articleFields, structuredData: spec }, { title: 'Billet', cover: 'photo', date: '2026-02-10', author: 'Claire Durand', intro: ' Un  chapô ' }, { ...page, image: undefined }, { ...ctx, site: { name: 'Cabinet Durand' } })
  assert.equal(block!['@type'], 'BlogPosting')
  assert.equal(block!.description, 'Un chapô')
  assert.deepEqual(block!.image, ['https://cabinet-durand.fr/media/photo.png'])
  assert.equal(block!.datePublished, '2026-02-10')
  assert.deepEqual(block!.author, { '@type': 'Person', 'name': 'Claire Durand' })
  assert.deepEqual(block!.publisher, { '@type': 'Organization', 'name': 'Cabinet Durand' })
  // Sans image : la propriété est absente, pas vide.
  const [bare] = contentBlocks({ titleField: 'title', fields: articleFields, structuredData: sd.article() }, { title: 'Sans image' }, { ...page, image: null, description: '' }, ctx)
  assert.ok(!('image' in bare!) && !('description' in bare!))
  assert.deepEqual(contentBlocks({ titleField: 'title', fields: articleFields, structuredData: sd.article() }, { title: '' }, { ...page, title: '' }, ctx), [])
})

test('questions fréquentes : éléments incomplets ignorés, réponse mise en forme gardée, pas de bloc vide', () => {
  const fields = { faq: f.repeater({ label: 'FAQ', fields: { q: f.text({ label: 'Q' }), a: f.richText({ label: 'R' }) } }) }
  const def = { fields, structuredData: sd.faq({ items: 'faq', question: 'q', answer: 'a' }) }
  const [block] = contentBlocks(def, { faq: [{ q: 'Quand ?', a: '<p>Dès <strong>demain</strong>.</p>' }, { q: 'Sans réponse', a: '<p></p>' }, { q: '', a: '<p>Sans question</p>' }] }, page, ctx)
  assert.deepEqual(block, { '@type': 'FAQPage', 'mainEntity': [{ '@type': 'Question', 'name': 'Quand ?', 'acceptedAnswer': { '@type': 'Answer', 'text': '<p>Dès <strong>demain</strong>.</p>' } }] })
  assert.deepEqual(contentBlocks(def, { faq: [] }, page, ctx), [])
  assert.deepEqual(contentBlocks(def, {}, page, ctx), [])
})

test('organisme : coordonnées, valeur fixe, horaires, pages ailleurs, logo du site par défaut', () => {
  const fields = {
    phone: f.text({ label: 'Téléphone', format: 'tel' }), street: f.textarea({ label: 'Adresse' }), city: f.text({ label: 'Ville' }), zip: f.text({ label: 'Code postal' }),
    socials: f.textarea({ label: 'Réseaux' }),
    hours: f.repeater({ label: 'Horaires', fields: { days: f.select({ label: 'Jours', multiple: true, options: WEEKDAYS }), opens: f.text({ label: 'Ouverture' }), closes: f.text({ label: 'Fermeture' }) } }),
  }
  const spec = sd.organization({
    type: 'LegalService', telephone: 'phone', streetAddress: 'street', addressLocality: 'city', postalCode: 'zip', addressCountry: sd.value('FR'),
    sameAs: 'socials', openingHours: { items: 'hours', days: 'days', opens: 'opens', closes: 'closes' },
  })
  const values = {
    phone: '04 72 00 00 00', street: '12 rue de la République\nBâtiment B', city: 'Lyon', zip: '69002',
    socials: 'https://www.linkedin.com/company/durand\npas une adresse\nhttps://www.linkedin.com/company/durand',
    hours: [{ days: ['Monday', 'mardi'], opens: '9h', closes: '18h30' }, { days: ['Saturday'], opens: 'matin', closes: '12:00' }, { days: [], opens: '09:00', closes: '12:00' }],
  }
  const [block] = contentBlocks({ fields, structuredData: spec }, values, page, ctx)
  assert.deepEqual(block, {
    '@type': 'LegalService', '@id': 'https://cabinet-durand.fr/#organization', 'name': 'Cabinet Durand', 'url': 'https://cabinet-durand.fr',
    'telephone': '04 72 00 00 00', 'logo': 'https://cabinet-durand.fr/logo.svg',
    'address': { '@type': 'PostalAddress', 'streetAddress': '12 rue de la République Bâtiment B', 'postalCode': '69002', 'addressLocality': 'Lyon', 'addressCountry': 'FR' },
    'sameAs': ['https://www.linkedin.com/company/durand'],
    'openingHoursSpecification': [{ '@type': 'OpeningHoursSpecification', 'dayOfWeek': ['Monday', 'Tuesday'], 'opens': '09:00', 'closes': '18:30' }],
  })
  // Rien de rempli : le nom et l'adresse du site seulement, sans adresse postale vide.
  const [empty] = contentBlocks({ fields, structuredData: spec }, {}, page, { ...ctx, site: { name: 'Cabinet Durand' } })
  assert.deepEqual(empty, { '@type': 'LegalService', '@id': 'https://cabinet-durand.fr/#organization', 'name': 'Cabinet Durand', 'url': 'https://cabinet-durand.fr', 'address': { '@type': 'PostalAddress', 'addressCountry': 'FR' } })
  // Sur une autre page que la sienne et que l'accueil, l'organisme n'est pas émis.
  assert.deepEqual(contentBlocks({ fields, structuredData: spec }, values, page, ctx, { organization: false }), [])
})

test('heures : écritures courantes ramenées à HH:MM', () => {
  assert.equal(normalizeTime('9h'), '09:00')
  assert.equal(normalizeTime('18h30'), '18:30')
  assert.equal(normalizeTime('9:05'), '09:05')
  assert.equal(normalizeTime(' 14 '), '14:00')
  assert.equal(normalizeTime('25:00'), null)
  assert.equal(normalizeTime('midi'), null)
  assert.equal(normalizeTime(null), null)
})

test('fil d\'Ariane : déduit des adresses, pages absentes ou hors ligne sautées, nom par langue', () => {
  assert.deepEqual(parentPaths('/services/droit'), ['/', '/services'])
  assert.deepEqual(parentPaths('/'), [])
  const singletons = {
    home: { label: 'Accueil', path: '/', breadcrumb: { fr: 'Accueil', en: 'Home' } },
    servicesPage: { label: 'Page des services', path: '/services', breadcrumb: 'Services' },
    legal: { label: 'Mentions légales', path: '/mentions', breadcrumb: false as const },
    settings: { label: 'Réglages' },
  }
  const base = { def: { path: '/services/[slug]' }, path: '/services/droit', name: 'Droit des affaires', defaultLocale: 'fr', base: 'https://site.fr', singletons }
  const fr = breadcrumbTrail({ ...base, url: 'https://site.fr/services/droit', locale: 'fr', isLive: () => true })
  assert.deepEqual(fr, [{ name: 'Accueil', url: 'https://site.fr/' }, { name: 'Services', url: 'https://site.fr/services' }, { name: 'Droit des affaires', url: 'https://site.fr/services/droit' }])
  const en = breadcrumbTrail({ ...base, url: 'https://site.fr/en/services/law', locale: 'en', isLive: key => key !== 'servicesPage' })
  assert.deepEqual(en, [{ name: 'Home', url: 'https://site.fr/en/' }, { name: 'Droit des affaires', url: 'https://site.fr/en/services/law' }])
  // Aucune page parente connue, page d'accueil, ou page qui refuse son fil : rien.
  assert.deepEqual(breadcrumbTrail({ ...base, url: 'x', locale: 'fr', isLive: () => false }), [])
  assert.deepEqual(breadcrumbTrail({ ...base, def: { path: '/' }, path: '/', url: 'x', locale: 'fr', isLive: () => true }), [])
  assert.deepEqual(breadcrumbTrail({ ...base, def: { path: '/services/[slug]', breadcrumb: false }, url: 'x', locale: 'fr', isLive: () => true }), [])
  assert.equal(breadcrumbName({ label: 'Accueil', breadcrumb: { fr: 'Accueil' } }, 'en', 'fr'), 'Accueil')
  assert.equal(breadcrumbBlock([{ name: 'Seul', url: 'x' }]), null)
  assert.deepEqual(breadcrumbBlock(fr)!.itemListElement, [
    { '@type': 'ListItem', 'position': 1, 'name': 'Accueil', 'item': 'https://site.fr/' },
    { '@type': 'ListItem', 'position': 2, 'name': 'Services', 'item': 'https://site.fr/services' },
    { '@type': 'ListItem', 'position': 3, 'name': 'Droit des affaires', 'item': 'https://site.fr/services/droit' },
  ])
})

test('balise : un seul graphe, « < » neutralisé', () => {
  assert.equal(structuredDataJson([]), null)
  const json = structuredDataJson([{ '@type': 'FAQPage', 'name': '</script><b>' }])!
  assert.ok(!json.includes('<'), json)
  assert.deepEqual(JSON.parse(json), { '@context': 'https://schema.org', '@graph': [{ '@type': 'FAQPage', 'name': '</script><b>' }] })
})

test('résumé d\'un bloc : lignes lisibles et manques signalés', () => {
  const article = summarizeBlock({ '@type': 'Article', 'headline': 'Titre', 'datePublished': '2026-03-01T08:00:00Z', 'author': { name: 'Claire' } })
  assert.deepEqual(article, { type: 'Article', label: 'Article', lines: ['Titre : Titre', 'Date : 2026-03-01', 'Auteur : Claire'], warnings: ['Pas d\'image : Google en demande une pour mettre un article en avant.'] })
  const business = summarizeBlock({ '@type': 'LegalService', 'name': 'Cabinet', 'address': { addressCountry: 'FR' } })
  assert.equal(business.label, 'Établissement (LegalService)')
  assert.equal(business.warnings.length, 2)
  assert.equal(summarizeBlock({ '@type': 'Organization', 'name': 'Asso' }).warnings.length, 0)
  assert.deepEqual(summarizeBlock({ '@type': 'BreadcrumbList', 'itemListElement': [{ name: 'Accueil' }, { name: 'Services' }] }).lines, ['Accueil › Services'])
})

test('configuration : champs vérifiés, messages lisibles', () => {
  const site = { name: 'Site', locales: ['fr', 'en'] as [string, ...string[]], defaultLocale: 'fr' }
  const errors = (singletons: Record<string, any>, collections: Record<string, any> = {}) => validate({ site, singletons, collections } as never)
  const page = (extra: Record<string, unknown>) => singleton({ label: 'Page', path: '/page', fields: { title: f.text({ label: 'Titre' }), photo: f.image({ label: 'Photo' }), faq: f.repeater({ label: 'FAQ', fields: { q: f.text({ label: 'Q' }), a: f.textarea({ label: 'R' }) } }) }, ...extra } as never)
  assert.deepEqual(errors({ page: page({ structuredData: [sd.article({ image: 'photo' }), sd.faq({ items: 'faq', question: 'q', answer: 'a' })], breadcrumb: { fr: 'Page', en: 'Page' } }) }), [])
  assert.match(errors({ page: page({ structuredData: sd.article({ image: 'title' }) }) })[0]!, /page\.structuredData\.image : le champ « title » est de type text/)
  assert.match(errors({ page: page({ structuredData: sd.article({ author: 'inconnu' }) }) })[0]!, /champ « inconnu » introuvable/)
  assert.match(errors({ page: page({ structuredData: sd.faq({ items: 'title', question: 'q', answer: 'a' }) }) })[0]!, /un champ répéteur est attendu/)
  assert.match(errors({ page: page({ structuredData: sd.faq({ items: 'faq', question: 'x', answer: 'a' }) }) })[0]!, /sous-champ « x » introuvable dans « faq »/)
  assert.match(errors({ page: page({ structuredData: [sd.article(), sd.article()] }) })[0]!, /déclaré deux fois/)
  assert.match(errors({ page: page({ structuredData: { kind: 'recette' } }) })[0]!, /bloc inconnu/)
  assert.match(errors({ page: page({ breadcrumb: { de: 'Seite' } }) })[0]!, /page\.breadcrumb/)
  assert.match(errors({ page: page({ path: undefined, structuredData: sd.article() }) })[0]!, /exige path/)
  // L'organisme : sur une page unique, avec ou sans adresse ; pas sur une collection.
  assert.deepEqual(errors({ page: page({ path: undefined, structuredData: sd.organization({ type: 'LocalBusiness', name: 'title', addressCountry: sd.value('FR') }) }) }), [])
  assert.match(errors({ page: page({ structuredData: sd.organization({ type: 'local business' }) }) })[0]!, /type schema\.org/)
  const items = collection({ label: 'Articles', path: '/a/[slug]', titleField: 'title', fields: { title: f.text({ label: 'Titre' }) }, structuredData: sd.organization() } as never)
  assert.match(errors({}, { items })[0]!, /se déclare sur une page unique/)
  // La configuration reste sérialisable : les blocs voyagent tels quels jusqu'au back-office.
  const config = defineCms({ site, singletons: { page: page({ structuredData: sd.faq({ items: 'faq', question: 'q', answer: 'a' }) }) } } as never) as any
  assert.deepEqual(specsOf(config.singletons.page), [{ items: 'faq', question: 'q', answer: 'a', kind: 'faq' }])
})
