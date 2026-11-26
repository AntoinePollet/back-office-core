import assert from 'node:assert/strict'
import { test } from 'node:test'
import { f } from './format'
import { classifyHref, contentLinks, healthCertainCount, healthPathKey, isCorePath, isHeavyImage, isPrivateHost, lacksAlt, verdictForStatus, type HealthReport } from './health'

const ORIGINS = ['https://cabinet-durand.fr', 'http://localhost:3000']

test('liens d\'un contenu : champs lien, textes mis en forme, répéteurs, champs masqués ignorés', () => {
  const fields = {
    cta: f.link({ label: 'Bouton' }),
    site: f.text({ label: 'Site web', format: 'url' }),
    body: f.richText({ label: 'Contenu' }),
    show: f.boolean({ label: 'Afficher' }),
    hidden: f.link({ label: 'Masqué', showIf: { field: 'show', equals: true } }),
    faq: f.repeater({ label: 'Questions', fields: { more: f.link({ label: 'Lien' }), text: f.richText({ label: 'Réponse' }) } }),
  }
  const values = {
    cta: { kind: 'page', type: 'services', id: 'abc' },
    site: 'https://exemple.fr',
    body: '<p><a href="/contact?x=1&amp;y=2">ici</a> et <a target="_blank" href=\'https://autre.fr/page\'>là</a> <a>sans adresse</a></p>',
    show: false,
    hidden: { kind: 'url', url: 'https://cache.fr' },
    faq: [{ more: { kind: 'url', url: ' /tarifs ' }, text: '<a href="mailto:a@b.fr">écrire</a>' }, { more: null, text: null }],
  }
  assert.deepEqual(contentLinks(fields, values), [
    { kind: 'page', field: 'Bouton', type: 'services', id: 'abc' },
    { kind: 'href', field: 'Site web', href: 'https://exemple.fr' },
    { kind: 'href', field: 'Contenu', href: '/contact?x=1&y=2' },
    { kind: 'href', field: 'Contenu', href: 'https://autre.fr/page' },
    { kind: 'href', field: 'Questions › Lien', href: '/tarifs' },
    { kind: 'href', field: 'Questions › Réponse', href: 'mailto:a@b.fr' },
  ])
})

test('nature d\'une adresse : page du site, autre site, rien à vérifier, mal écrite', () => {
  assert.deepEqual(classifyHref('/contact?x=1#haut', ORIGINS), { kind: 'internal', path: '/contact' })
  assert.deepEqual(classifyHref('https://www.cabinet-durand.fr/services/droit#a', ORIGINS), { kind: 'internal', path: '/services/droit' })
  assert.deepEqual(classifyHref('http://localhost:3000/', ORIGINS), { kind: 'internal', path: '/' })
  assert.deepEqual(classifyHref('https://autre.fr/page?x=1#ancre', ORIGINS), { kind: 'external', url: 'https://autre.fr/page?x=1' })
  for (const skipped of ['#haut', 'mailto:a@b.fr', 'tel:+33472000000', 'sms:0600000000', 'ftp://x.fr/a', '']) assert.equal(classifyHref(skipped, ORIGINS).kind, 'skip', skipped)
  const www = classifyHref('www.autre.fr/page', ORIGINS)
  assert.ok(www.kind === 'invalid' && www.reason.includes('https://'))
  assert.equal(classifyHref('autre.fr', ORIGINS).kind, 'invalid')
  assert.equal(classifyHref('voir la page contact', ORIGINS).kind, 'invalid')
  assert.equal(classifyHref('https://', ORIGINS).kind, 'invalid')
  // « //autre.fr » n'est pas un chemin du site : c'est un autre site.
  assert.deepEqual(classifyHref('//autre.fr/x', ORIGINS), { kind: 'external', url: 'https://autre.fr/x' })
})

test('chemins : forme de comparaison, chemins du core laissés de côté', () => {
  assert.equal(healthPathKey('/Contact/'), '/contact')
  assert.equal(healthPathKey('/a/../b'), '/a/../b')
  assert.ok(isCorePath('/admin') && isCorePath('/api/content/x') && isCorePath('/_nuxt/a.js'))
  assert.ok(!isCorePath('/administration') && !isCorePath('/media/x.png'))
})

test('verdict d\'une réponse : introuvable, en panne, non vérifiable', () => {
  assert.equal(verdictForStatus(200), 'ok')
  assert.equal(verdictForStatus(301), 'ok')
  assert.equal(verdictForStatus(404), 'broken')
  assert.equal(verdictForStatus(410), 'broken')
  assert.equal(verdictForStatus(500), 'down')
  assert.equal(verdictForStatus(503), 'down')
  for (const status of [401, 403, 429, 999, 400]) assert.equal(verdictForStatus(status), 'unknown', String(status))
})

test('adresses que le serveur n\'appelle jamais', () => {
  for (const host of ['localhost', 'app.localhost', 'serveur', 'nas.local', 'db.internal', '127.0.0.1', '10.1.2.3', '192.168.1.1', '172.16.0.1', '172.31.255.255', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '[::1]', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1'])
    assert.ok(isPrivateHost(host), host)
  for (const host of ['cabinet-durand.fr', 'www.exemple.com', '8.8.8.8', '172.32.0.1', '2001:4860:4860::8888']) assert.ok(!isPrivateHost(host), host)
})

test('fichiers : image lourde, image sans texte alternatif', () => {
  assert.ok(isHeavyImage({ mime: 'image/jpeg', size: 2_000_000 }))
  assert.ok(!isHeavyImage({ mime: 'image/jpeg', size: 400_000 }))
  assert.ok(!isHeavyImage({ mime: 'image/svg+xml', size: 2_000_000 }))
  assert.ok(!isHeavyImage({ mime: 'application/pdf', size: 9_000_000 }))
  assert.ok(lacksAlt({ mime: 'image/png', alt: { en: 'Office' } }, 'fr'))
  assert.ok(lacksAlt({ mime: 'image/png', alt: { fr: '  ' } }, 'fr'))
  assert.ok(!lacksAlt({ mime: 'image/png', alt: { fr: 'Le cabinet' } }, 'fr'))
  assert.ok(!lacksAlt({ mime: 'application/pdf', alt: {} }, 'fr'))
})

test('nombre de problèmes certains : sans les liens encore à vérifier ni les fichiers inutilisés', () => {
  const use = { type: 't', id: 'i', locale: 'fr', name: 'n', typeLabel: 'T', field: 'f', to: '/admin/t/i' }
  const file = { id: 'm', name: 'a.png', size: 1, to: '/admin/media?file=m', uses: 1 }
  const report: HealthReport = {
    examined: 3,
    links: { missingPages: [{ ...use, target: 'x' }], invalid: [{ ...use, href: 'www', reason: 'r' }], internal: [{ path: '/x', uses: [use] }], external: [{ url: 'https://x.fr', uses: [use] }], total: 4 },
    images: { withoutAlt: [file, file], heavy: [file] },
    unused: { count: 5, size: 10, files: [] },
    seo: null,
  }
  assert.equal(healthCertainCount(report), 5)
})
