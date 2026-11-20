import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  type Hop, type RedirectGraph, canonicalPath, checkRule, cleanReferrer, followRedirects, isNoise, isReservedPath, normalizeSource,
  normalizeUrlTarget, parseRedirectBatch, pathKey, redirectLocation,
} from './redirects'

const source = (input: unknown) => { const r = normalizeSource(input); return r.ok ? r.path : `refus: ${r.error}` }

test('normalisation : barre finale, majuscules, barres doublées, accents encodés', () => {
  assert.equal(canonicalPath('/Contact/'), '/contact')
  assert.equal(canonicalPath('/a//b///'), '/a/b')
  assert.equal(canonicalPath('/caf%C3%A9'), '/café')
  // « é » en deux caractères (e + accent) et en un seul : la même adresse.
  assert.equal(canonicalPath('/café'), canonicalPath('/café'))
  assert.equal(canonicalPath('/mon%20fichier.pdf'), '/mon fichier.pdf')
  assert.equal(canonicalPath('/'), '/')
})

test('normalisation : chemins refusés', () => {
  for (const bad of ['sans-barre', '/a/../b', '/a/./b', '/a%2Fb', '/a%ZZ', '/a\\b', '/a%00b', '/' + 'x'.repeat(400)]) assert.equal(canonicalPath(bad), null, bad)
})

test('ancienne adresse : domaine, paramètres et ancre ignorés, barre ajoutée', () => {
  assert.equal(source('  /Ancienne-Page/  '), '/ancienne-page')
  assert.equal(source('ancienne-page.html'), '/ancienne-page.html')
  assert.equal(source('https://ancien-site.fr/Blog/Article?id=3#haut'), '/blog/article')
  assert.equal(source('https://ancien-site.fr/caf%C3%A9'), '/café')
  const noted = normalizeSource('/page?utm=1')
  assert.ok(noted.ok && noted.path === '/page' && noted.notes.some(n => n.includes('paramètres')))
  const domain = normalizeSource('http://x.fr/a')
  assert.ok(domain.ok && domain.notes.some(n => n.includes('nom de domaine')))
})

test('ancienne adresse : refus expliqués', () => {
  assert.match(source(''), /Indiquez/)
  assert.match(source(undefined), /Indiquez/)
  assert.match(source('/'), /accueil/)
  assert.match(source('https://ancien-site.fr'), /accueil/)
  assert.match(source('/blog/*'), /motifs/)
  assert.match(source('mailto:a@b.fr'), /pas une adresse du site/)
  assert.match(source('/a/../b'), /pas une adresse valide/)
  for (const reserved of ['/admin', '/Admin/users', '/api/content/x', '/media/abc/photo.png', '/_nuxt/x.js', '/sitemap.xml', '/robots.txt']) assert.match(source(reserved), /réservée/, reserved)
  // « /administration » n'est pas « /admin ».
  assert.equal(source('/administration'), '/administration')
  assert.ok(!isReservedPath('/mediatheque') && isReservedPath('/__nuxt_error'))
})

test('destination : chemin du site, adresse complète, ce site ramené à son chemin', () => {
  assert.deepEqual(normalizeUrlTarget('/Contact?x=1#haut'), { ok: true, url: '/Contact?x=1#haut', external: false })
  assert.deepEqual(normalizeUrlTarget('https://www.exemple.fr/a'), { ok: true, url: 'https://www.exemple.fr/a', external: true })
  assert.deepEqual(normalizeUrlTarget('https://cabinet-durand.fr/contact?a=1', 'https://cabinet-durand.fr'), { ok: true, url: '/contact?a=1', external: false })
  for (const bad of ['', 'www.exemple.fr', '//exemple.fr/a', 'javascript:alert(1)', 'mailto:a@b.fr', '/a b', 'https://']) assert.equal(normalizeUrlTarget(bad).ok, false, bad)
  assert.equal(pathKey('/Contact/?x=1#haut'), '/contact')
  assert.equal(pathKey('https://exemple.fr/a'), null)
})

test('en-tête Location : encodage, paramètres de la demande recopiés sur une destination interne qui n\'en a pas', () => {
  assert.equal(redirectLocation('/café'), '/caf%C3%A9')
  assert.equal(redirectLocation('/nouvelle', '?utm_source=lettre'), '/nouvelle?utm_source=lettre')
  assert.equal(redirectLocation('/nouvelle?a=1#b', '?utm_source=lettre'), '/nouvelle?a=1#b')
  assert.equal(redirectLocation('https://exemple.fr/a b', '?x=1'), 'https://exemple.fr/a%20b')
})

const url = (to: string, id?: string): Hop => ({ key: pathKey(to), target: { kind: 'url', url: to }, id })
const graph = (rules: Record<string, string> = {}, autos: Record<string, string> = {}, pages: string[] = []): RedirectGraph => ({
  rules: new Map(Object.entries(rules).map(([from, to], i) => [from, url(to, `r${i}`)])),
  autos: new Map(Object.entries(autos).map(([from, to]) => [from, { key: to, target: { kind: 'page', type: 'services', id: 'e1', locale: 'fr' } }])),
  pages: new Map(pages.map(p => [p, { type: 'services', id: 'p' + p, locale: 'fr', title: 'Titre' }])),
})
const check = (g: RedirectGraph, from: string, to: string, id?: string) => checkRule(g, { source: from, target: { kind: 'url', url: to }, targetKey: pathKey(to), id })

test('garde-fous : vers elle-même, doublon, page en ligne', () => {
  const g = graph({ '/a': '/b' }, { '/services/vieux': '/services/neuf' }, ['/services/neuf', '/contact'])
  const self = check(g, '/x/', '/X'); assert.ok(!self.ok && self.code === 'self')
  const dup = check(g, '/A', '/c'); assert.ok(!dup.ok && dup.code === 'duplicate' && dup.error.includes('« /b »'))
  const auto = check(g, '/services/vieux', '/c'); assert.ok(!auto.ok && auto.code === 'duplicate' && auto.error.includes('automatiquement'))
  const page = check(g, '/contact', '/c'); assert.ok(!page.ok && page.code === 'page' && page.error.includes('ne s\'appliquerait pas'))
  const bad = check(g, '/admin/x', '/c'); assert.ok(!bad.ok && bad.code === 'invalid')
  // La redirection modifiée n'est pas son propre doublon.
  const same = check(g, '/a', '/c', 'r0'); assert.ok(same.ok && !same.chain)
  const fine = check(g, '/libre', 'https://exemple.fr'); assert.ok(fine.ok && !fine.chain && !fine.upstream.length)
})

test('boucles : directe, longue, par une redirection automatique', () => {
  const g = graph({ '/b': '/c', '/c': '/a' })
  const loop = check(g, '/a', '/b')
  assert.ok(!loop.ok && loop.code === 'loop' && loop.error.includes('« /a » → « /b » → « /c » → « /a »'), JSON.stringify(loop))
  const direct = check(graph({ '/b': '/a' }), '/a', '/b'); assert.ok(!direct.ok && direct.code === 'loop')
  const viaAuto = check(graph({}, { '/services/vieux': '/a' }), '/a', '/services/vieux'); assert.ok(!viaAuto.ok && viaAuto.code === 'loop')
  // Une boucle déjà présente plus loin ne fait pas tourner la vérification sans fin.
  const far = check(graph({ '/b': '/c', '/c': '/b' }), '/a', '/b'); assert.ok(!far.ok && far.code === 'loop')
})

test('chaînes : la destination est redirigée (aval), une redirection mène à l\'ancienne adresse (amont)', () => {
  const g = graph({ '/b': '/c', '/c': '/Fin?x=1' })
  const down = check(g, '/a', '/b')
  assert.ok(down.ok && down.chain)
  assert.deepEqual(down.chain.via, ['/b', '/c'])
  assert.deepEqual(down.chain.final, { kind: 'url', url: '/Fin?x=1' })
  assert.equal(down.chain.finalKey, '/fin')
  // Vers une adresse externe : la chaîne s'arrête là.
  const out = check(graph({ '/b': 'https://exemple.fr/z' }), '/a', '/b'); assert.ok(out.ok && out.chain?.finalKey === null)
  const up = check(graph({ '/x': '/a', '/y': '/A/' }), '/a', '/z')
  assert.ok(up.ok && !up.chain)
  assert.deepEqual(up.upstream, [{ id: 'r0', source: '/x' }, { id: 'r1', source: '/y' }])
  const followed = followRedirects(g, '/b', '/a'); assert.deepEqual([followed.hops, followed.loop], [['/b', '/c'], false])
})

test('lot collé : séparateurs, guillemets, titres, commentaires, troisième colonne', () => {
  const lines = parseRedirectBatch([
    '﻿Ancienne adresse;Nouvelle adresse',
    '/a ; /b',
    '',
    '# commentaire',
    '"/c","/d, e"',
    '/e\t/f\t302',
    '/g -> /h',
    '/i → https://exemple.fr/x;y',
    '/j /k',
    '/l;/m;provisoire',
    '/n;/o;',
  ].join('\r\n'))
  assert.deepEqual(lines, [
    { line: 2, source: '/a', target: '/b' },
    { line: 5, source: '/c', target: '/d, e' },
    { line: 6, source: '/e', target: '/f', status: 302 },
    { line: 7, source: '/g', target: '/h' },
    // La flèche passe avant le point-virgule : celui d'une adresse n'est pas pris pour un séparateur.
    { line: 8, source: '/i', target: 'https://exemple.fr/x;y' },
    { line: 9, source: '/j', target: '/k' },
    { line: 10, source: '/l', target: '/m', status: 302 },
    { line: 11, source: '/n', target: '/o' },
  ])
})

test('lot collé : lignes illisibles signalées avec leur numéro, première ligne de données gardée', () => {
  const lines = parseRedirectBatch('/seule\n/a;/b;301;trop\n/c;\n/d,/e,404')
  assert.deepEqual(lines.map(l => [l.line, 'error' in l ? l.error.split(' :')[0] : 'ok']), [[1, 'Ligne illisible'], [2, 'Trop de colonnes'], [3, 'Ligne illisible'], [4, 'Troisième colonne « 404 »']])
  // Une première ligne qui est une vraie redirection n'est pas prise pour une ligne de titres.
  assert.equal(parseRedirectBatch('/source;/destination').length, 1)
  assert.equal(parseRedirectBatch('from,to\n/a,/b').length, 1)
  assert.deepEqual(parseRedirectBatch('\n\n# rien\n'), [])
})

test('bruit des robots : écarté ; vraies anciennes adresses : comptées', () => {
  const browser = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/130 Safari/537.36'
  for (const path of ['/wp-login.php', '/wp-admin/setup-config.php', '/blog/wp-content/plugins/x/y.php', '/.env', '/.git/config', '/.well-known/security.txt', '/xmlrpc.php', '/phpmyadmin/index.php',
    '/backup.zip', '/dump.sql', '/config.yml', '/shell.php', '/x.php', '/cgi-bin/luci', '/vendor/phpunit/phpunit/src/util/php/eval-stdin.php', '/favicon.ico', '/apple-touch-icon.png', '/assets/app.js',
    '/a/b/c/d/e/f/g/h/i', '/' + 'x'.repeat(250), '/page<script>', '/index.php;id', '/'])
    assert.equal(isNoise(path, browser), true, path)
  for (const path of ['/ancienne-page', '/contact.php', '/nos-services.html', '/blog/2019/mon-article', '/plaquette.pdf', '/équipe/marie', '/index.php', '/services/droit des affaires'])
    assert.equal(isNoise(path, browser), false, path)
  // Outils de balayage et scripts : écartés quelle que soit l'adresse. Les moteurs de recherche sont comptés.
  for (const agent of ['', null, 'curl/8.4.0', 'python-requests/2.31', 'Go-http-client/1.1', 'Mozilla/5.0 zgrab/0.x', 'Mozilla/5.0 (compatible; AhrefsBot/7.0)']) assert.equal(isNoise('/ancienne-page', agent), true, String(agent))
  assert.equal(isNoise('/ancienne-page', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'), false)
  assert.equal(isNoise('/ancienne-page'), false)
})

test('provenance : sans paramètres, chemin seul pour ce site', () => {
  assert.equal(cleanReferrer('https://cabinet-durand.fr/services?x=1#a', 'cabinet-durand.fr'), '/services')
  assert.equal(cleanReferrer('https://www.google.com/search?q=secret', 'cabinet-durand.fr'), 'www.google.com/search')
  assert.equal(cleanReferrer('https://exemple.fr/', 'cabinet-durand.fr'), 'exemple.fr')
  assert.equal(cleanReferrer('android-app://com.google.android.gm/', 'cabinet-durand.fr'), null)
  assert.equal(cleanReferrer('n\'importe quoi', 'x'), null)
  assert.equal(cleanReferrer(undefined, 'x'), null)
})
