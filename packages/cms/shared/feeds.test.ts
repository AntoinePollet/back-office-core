import assert from 'node:assert/strict'
import { test } from 'node:test'
import { entrySummary, feedErrors, feedOptions, feedPath, fieldDate, llmsTxt, rssXml, summarize } from './feeds'
import { collection, f, singleton, validate } from './format'

const fields = { title: f.text({ label: 'Titre' }), excerpt: f.textarea({ label: 'Résumé' }), body: f.richText({ label: 'Texte' }), date: f.date({ label: 'Date' }), cover: f.image({ label: 'Image' }), photos: f.image({ label: 'Photos', multiple: true }) }

test('réglages d\'un flux : forme courte, adresse par langue', () => {
  assert.deepEqual(feedOptions({ feed: true }), {})
  assert.deepEqual(feedOptions({ feed: { limit: 5 } }), { limit: 5 })
  assert.equal(feedOptions({}), null)
  assert.equal(feedOptions({ feed: false }), null)
  assert.equal(feedPath('articles', 'fr', 'fr'), '/feeds/articles.xml')
  assert.equal(feedPath('articles', 'en', 'fr'), '/feeds/en/articles.xml')
})

test('configuration : champs vérifiés, collection avec pages exigée', () => {
  const def = (feed: unknown, extra = {}) => ({ kind: 'collection', path: '/a/[slug]', fields, feed, ...extra })
  const errors = (feed: unknown, extra = {}) => feedErrors('articles', def(feed, extra), ['fr', 'en'])
  assert.deepEqual(errors(true), [])
  assert.deepEqual(errors(undefined), [])
  assert.deepEqual(errors({ description: 'excerpt', date: 'date', image: 'cover', content: 'body', limit: 50, title: { fr: 'Actualités', en: 'News' } }), [])
  assert.match(errors(true, { path: undefined })[0]!, /path avec \[slug\]/)
  assert.match(errors(true, { kind: 'singleton', path: '/a' })[0]!, /collection/)
  assert.match(errors({ date: 'title' })[0]!, /articles\.feed\.date : le champ « title » n'a pas le bon type/)
  assert.match(errors({ image: 'photos' })[0]!, /feed\.image/)
  assert.match(errors({ content: 'inconnu' })[0]!, /champ « inconnu » introuvable/)
  assert.match(errors({ limit: 500 })[0]!, /limit : un nombre entier de 1 à 100/)
  assert.match(errors({ title: { de: 'Neues' } })[0]!, /feed\.title/)
  assert.match(errors('oui')[0]!, /attendu true/)
  // Jusque dans defineCms, avec la description du site.
  const site = { name: 'Site', locales: ['fr'] as [string, ...string[]], defaultLocale: 'fr' }
  const articles = collection({ label: 'Articles', path: '/a/[slug]', titleField: 'title', fields, feed: { date: 'excerpt' } } as never)
  assert.match(validate({ site, collections: { articles } } as never)[0]!, /articles\.feed\.date/)
  assert.match(validate({ site: { ...site, description: { en: 'x' } }, singletons: { home: singleton({ label: 'Accueil', fields: { t: f.text({ label: 'T' }) } }) } } as never)[0]!, /site\.description/)
})

test('résumé : champ désigné, sinon description du référencement, sinon début du texte, coupé à un mot', () => {
  const values = { title: 'Titre', excerpt: ' Un  résumé ', body: '<p>Le <strong>texte</strong> entier.</p>' }
  assert.equal(entrySummary(fields, values, { field: 'excerpt', seoDescription: 'Référencement' }), 'Un résumé')
  assert.equal(entrySummary(fields, values, { field: 'body' }), 'Le texte entier.')
  assert.equal(entrySummary(fields, { ...values, excerpt: '' }, { field: 'excerpt', seoDescription: 'Référencement' }), 'Référencement')
  assert.equal(entrySummary(fields, values, { skip: 'title' }), 'Un résumé Le texte entier.')
  assert.equal(entrySummary(fields, { title: 'Seul' }, { skip: 'title' }), '')
  assert.equal(summarize('un deux trois quatre cinq', 14), 'un deux trois …')
  assert.equal(summarize('court', 14), 'court')
})

test('date d\'un champ : lue en temps universel, refusée si elle est mal formée', () => {
  assert.equal(fieldDate('2026-03-01')!.toISOString(), '2026-03-01T00:00:00.000Z')
  assert.equal(fieldDate('2026-03-01T09:30')!.toISOString(), '2026-03-01T09:30:00.000Z')
  for (const bad of ['', '01/03/2026', '2026-13-45', null, 3]) assert.equal(fieldDate(bad), null, String(bad))
})

test('document RSS : éléments, texte échappé, contenu entier, image jointe', () => {
  const xml = rssXml({
    title: 'Actualités — Durand & <Fils>', description: 'Le cabinet', siteUrl: 'https://site.fr/', feedUrl: 'https://site.fr/feeds/articles.xml', locale: 'fr',
    items: [
      { title: 'Un "titre" & plus', url: 'https://site.fr/a/un?x=1&y=2', date: new Date('2026-03-01T08:00:00Z'), description: 'Résumé <b>', content: '<p>Texte ]]> piège</p>', image: { url: 'https://site.fr/media/a.png', mime: 'image/png', size: 1234 } },
      { title: 'Ancien', url: 'https://site.fr/a/ancien', date: new Date('2026-01-01T08:00:00Z'), description: '' },
    ],
  })
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"'))
  assert.ok(xml.includes('<title>Actualités — Durand &amp; &lt;Fils&gt;</title>') && xml.includes('<language>fr</language>'))
  assert.ok(xml.includes('<atom:link href="https://site.fr/feeds/articles.xml" rel="self" type="application/rss+xml"/>'))
  assert.ok(xml.includes('<lastBuildDate>Sun, 01 Mar 2026 08:00:00 GMT</lastBuildDate>'))
  assert.ok(xml.includes('<title>Un &quot;titre&quot; &amp; plus</title>') && xml.includes('<link>https://site.fr/a/un?x=1&amp;y=2</link>') && xml.includes('<guid isPermaLink="true">https://site.fr/a/un?x=1&amp;y=2</guid>'))
  assert.ok(xml.includes('<pubDate>Sun, 01 Mar 2026 08:00:00 GMT</pubDate>') && xml.includes('<description>Résumé &lt;b&gt;</description>'))
  assert.ok(xml.includes('<content:encoded><![CDATA[<p>Texte ]]]]><![CDATA[> piège</p>]]></content:encoded>'))
  assert.ok(xml.includes('<enclosure url="https://site.fr/media/a.png" length="1234" type="image/png"/>'))
  // Élément sans résumé, sans contenu, sans image : ces balises sont absentes.
  const last = xml.slice(xml.lastIndexOf('<item>'))
  assert.ok(!last.includes('<description>') && !last.includes('enclosure') && !last.includes('content:encoded'))
  assert.equal(xml.split('<item>').length - 1, 2)
  // Flux vide : toujours un document valable.
  assert.ok(!rssXml({ title: 'T', description: 'D', siteUrl: 's', feedUrl: 'f', locale: 'fr', items: [] }).includes('lastBuildDate'))
})

test('llms.txt : titre, phrase d\'introduction, rubriques non vides, liens sur une ligne', () => {
  const text = llmsTxt({
    siteName: 'Cabinet Durand', description: 'Avocats en droit des affaires,\nà Lyon.', sitemapUrl: 'https://site.fr/sitemap.xml',
    sections: [
      { title: 'Pages', items: [{ title: 'Accueil', url: 'https://site.fr/', description: 'Le cabinet.' }, { title: 'Contact [urgent]', url: 'https://site.fr/contact', description: '' }] },
      { title: 'Vide', items: [] },
      { title: 'Services', items: [{ title: '', url: 'https://site.fr/s/x', description: 'Sur\ndeux lignes' }], more: 12 },
    ],
    feeds: [{ title: 'Services', url: 'https://site.fr/feeds/services.xml' }],
  })
  assert.equal(text, [
    '# Cabinet Durand', '', '> Avocats en droit des affaires, à Lyon.', '',
    '## Pages', '', '- [Accueil](https://site.fr/): Le cabinet.', '- [Contact urgent](https://site.fr/contact)', '',
    '## Services', '', '- [https://site.fr/s/x](https://site.fr/s/x): Sur deux lignes', '- [12 autres pages dans le plan du site](https://site.fr/sitemap.xml)', '',
    '## Flux RSS', '', '- [Services](https://site.fr/feeds/services.xml)', '',
  ].join('\n'))
  assert.equal(llmsTxt({ siteName: 'Site', sections: [] }), '# Site\n')
})
