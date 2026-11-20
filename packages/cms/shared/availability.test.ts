import assert from 'node:assert/strict'
import test from 'node:test'
import {
  closedPageHtml, closedTexts, contactHref, defaultAvailability, isSitePage, localeFromPath, normalizeAvailability, parseAvailability,
} from './availability'

const LOCALES = ['fr', 'en'] as const

test('pages du site remplacées ; back-office, API, médias et fichiers servis', () => {
  for (const path of ['/', '/services', '/services/droit-social', '/en', '/en/services?x=1'])
    assert.equal(isSitePage('GET', path), true, path)
  assert.equal(isSitePage('HEAD', '/'), true)
  for (const path of ['/admin', '/admin/availability', '/api/content/home', '/api/cms/theme', '/media/a.jpg', '/_nuxt/entry.js', '/_cms/redirect', '/__nuxt_error', '/robots.txt', '/sitemap.xml', '/favicon.ico', '/apple-touch-icon.png'])
    assert.equal(isSitePage('GET', path), false, path)
  assert.equal(isSitePage('POST', '/'), false)
  // Un nom qui commence comme « admin » ou « api » reste une page du site.
  assert.equal(isSitePage('GET', '/administration'), true)
  assert.equal(isSitePage('GET', '/apiculture'), true)
})

test('langue d\'après l\'adresse', () => {
  assert.equal(localeFromPath('/', LOCALES, 'fr'), 'fr')
  assert.equal(localeFromPath('/en', LOCALES, 'fr'), 'en')
  assert.equal(localeFromPath('/en/services', LOCALES, 'fr'), 'en')
  assert.equal(localeFromPath('/fr/services', LOCALES, 'fr'), 'fr')
  assert.equal(localeFromPath('/entreprise', LOCALES, 'fr'), 'fr')
})

test('réglage absent ou abîmé : site en ligne, pages vides', () => {
  assert.deepEqual(normalizeAvailability(undefined, LOCALES), defaultAvailability())
  assert.equal(normalizeAvailability({ mode: 'fermé' }, LOCALES).mode, 'online')
  assert.equal(normalizeAvailability({ mode: 'maintenance', pages: { maintenance: { template: '???' } } }, LOCALES).pages.maintenance.template, 'simple')
})

test('réglage reçu : vérifié et nettoyé', () => {
  assert.equal(parseAvailability({ mode: 'ferme' }, LOCALES), 'État du site inconnu.')
  assert.equal(parseAvailability({ mode: 'maintenance', pages: { maintenance: { template: 'video' } } }, LOCALES), 'Modèle de page inconnu.')
  assert.match(String(parseAvailability({ mode: 'online', pages: { construction: { template: 'simple', texts: { fr: { title: 'x'.repeat(121) } } } } }, LOCALES)), /Titre trop long/)
  const ok = parseAvailability({
    mode: 'maintenance',
    pages: { maintenance: { template: 'image', imageId: 'm1', contact: '  a@b.fr \n', texts: { fr: { title: ' Bientôt \n de retour ', message: ' Ligne 1\r\nLigne 2 ' }, en: { title: '', message: '' }, de: { title: 'Ignoriert' } } } },
  }, LOCALES)
  assert.ok(typeof ok !== 'string')
  assert.deepEqual(ok.pages.maintenance, { template: 'image', imageId: 'm1', contact: 'a@b.fr', texts: { fr: { title: 'Bientôt de retour', message: 'Ligne 1\nLigne 2' } } })
  assert.deepEqual(ok.pages.construction, defaultAvailability().pages.construction)
})

test('textes : langue, puis langue par défaut, puis texte proposé, champ par champ', () => {
  const page = { ...defaultAvailability().pages.maintenance, texts: { fr: { title: 'Travaux', message: '' } } }
  assert.deepEqual(closedTexts(page, 'maintenance', 'fr', 'fr'), { title: 'Travaux', message: 'Le site est en maintenance pour quelques instants. Merci de revenir un peu plus tard.' })
  assert.equal(closedTexts(page, 'maintenance', 'en', 'fr').title, 'Travaux')
  assert.equal(closedTexts(defaultAvailability().pages.construction, 'construction', 'en', 'fr').title, 'Website under construction')
  // Langue sans texte proposé : celui de la langue par défaut.
  assert.equal(closedTexts(defaultAvailability().pages.construction, 'construction', 'de', 'fr').title, 'Site en construction')
})

test('contact : e-mail, téléphone, texte libre', () => {
  assert.equal(contactHref('contact@cabinet.fr'), 'mailto:contact@cabinet.fr')
  assert.equal(contactHref('01 23 45 67 89'), 'tel:0123456789')
  assert.equal(contactHref('+33 (0)1.23.45.67.89'), 'tel:+330123456789')
  assert.equal(contactHref('Passez au cabinet, 3 rue de la Paix'), null)
  assert.equal(contactHref('12-34'), null)
})

test('page d\'attente : texte échappé, robots, modèle, image', () => {
  const base = { mode: 'construction' as const, locale: 'fr', defaultLocale: 'fr', siteName: 'Cabinet <Durand>', theme: null }
  const page = { template: 'simple' as const, imageId: null, contact: 'a@b.fr', texts: { fr: { title: '<script>alert(1)</script>', message: 'Un\n\nDeux\ntrois' } } }
  const html = closedPageHtml({ ...base, page })
  assert.ok(!html.includes('<script>'))
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))
  assert.ok(html.includes('Cabinet &lt;Durand&gt;'))
  assert.ok(html.includes('<p>Un</p><p>Deux<br>trois</p>'))
  assert.ok(html.includes('<meta name="robots" content="noindex">'))
  assert.ok(html.includes('href="mailto:a@b.fr"'))
  assert.ok(!closedPageHtml({ ...base, mode: 'maintenance', page }).includes('noindex'))
  // Modèle « image » sans image : modèle sobre.
  assert.ok(closedPageHtml({ ...base, page: { ...page, template: 'image' } }).includes('data-template="simple"'))
  const withImage = closedPageHtml({ ...base, page: { ...page, template: 'image' }, image: { url: '/media/a b".jpg?w=1920', position: '30% 20%' } })
  assert.ok(withImage.includes('data-template="image"'))
  assert.ok(withImage.includes('url("/media/a%20b%22.jpg?w=1920") 30% 20%/cover'))
  // Position inattendue : centrée.
  assert.ok(closedPageHtml({ ...base, page: { ...page, template: 'image' }, image: { url: '/x.jpg', position: 'red;}' } }).includes(') 50% 50%/cover'))
})
