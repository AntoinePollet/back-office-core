import assert from 'node:assert/strict'
import { test } from 'node:test'
import { collection, defineCms, f, singleton, type CmsConfig } from '../shared/format.ts'
import { imageSize } from './image-size.ts'
import { importId, mediaId, planImport, requestBody } from './import-plan.ts'

const config = defineCms({
  site: { name: 'Test', locales: ['fr', 'en'], defaultLocale: 'fr' },
  singletons: {
    contact: singleton({ label: 'Coordonnées', drafts: false, fields: { email: f.text({ label: 'E-mail', format: 'email', required: true }), phone: f.text({ label: 'Téléphone', localized: false }) } }),
  },
  collections: {
    categories: collection({ label: 'Catégories', titleField: 'name', fields: { name: f.text({ label: 'Nom', required: true }) } }),
    services: collection({
      label: 'Services',
      titleField: 'title',
      path: '/services/[slug]',
      seo: true,
      fields: {
        title: f.text({ label: 'Titre', required: true, max: 40 }),
        body: f.richText({ label: 'Contenu' }),
        price: f.number({ label: 'Tarif', min: 0, integer: true }),
        onQuote: f.boolean({ label: 'Sur devis' }),
        date: f.date({ label: 'Date' }),
        audience: f.select({ label: 'Public', options: [{ value: 'pro', label: 'Pro' }, { value: 'perso', label: 'Perso' }] }),
        tags: f.select({ label: 'Thèmes', multiple: true, options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] }),
        cover: f.image({ label: 'Image' }),
        brochure: f.file({ label: 'Plaquette' }),
        cta: f.link({ label: 'Bouton' }),
        category: f.relation({ label: 'Catégorie', to: 'categories' }),
        related: f.relation({ label: 'Voir aussi', to: 'services', multiple: true }),
        prices: f.repeater({ label: 'Tarifs', max: 3, fields: { label: f.text({ label: 'Précision' }), amount: f.text({ label: 'Prix', required: true }), photo: f.image({ label: 'Photo' }) } }),
      },
    }),
  },
}) as unknown as CmsConfig

const options = { baseDir: '/projet/import', publicDir: '/projet/public' }
const plan = (data: unknown, extra = {}) => planImport(config, data, { ...options, ...extra })
const service = (item: object, others: object[] = []) => plan({ collections: { categories: [{ id: 'pro', name: 'Pro' }], services: [{ id: 's1', title: 'Un', ...item }, ...others] } })
const entry = (p: ReturnType<typeof plan>, key: string) => p.entries.find(e => e.key === key)!

test('la clé donne toujours le même identifiant, différent d\'une collection à l\'autre', () => {
  assert.equal(importId('services', 's1'), importId('services', 's1'))
  assert.notEqual(importId('services', 's1'), importId('categories', 's1'))
  assert.match(importId('services', 's1'), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.equal(mediaId(Buffer.from('abc')), mediaId(Buffer.from('abc')))
  assert.notEqual(mediaId(Buffer.from('abc')), mediaId(Buffer.from('abd')))
})

test('un fichier simple : valeurs à plat, publié par défaut, une page unique porte son propre identifiant', () => {
  const p = plan({ singletons: { contact: { email: 'a@b.fr', phone: '' } }, collections: { categories: [{ id: 'pro', name: 'Pro' }] } })
  assert.deepEqual(p.errors, [])
  assert.deepEqual(p.entries.map(e => [e.type, e.id, e.publish, e.values]), [
    ['contact', 'contact', true, { email: 'a@b.fr', phone: '' }],
    ['categories', importId('categories', 'pro'), true, { name: 'Pro' }],
  ])
  assert.deepEqual(requestBody(p.entries[1]!, new Map(), { create: true, dryRun: false }), { id: importId('categories', 'pro'), locale: 'fr', values: { name: 'Pro' }, publish: ['fr'] })
  // Une page unique ne reçoit jamais d'identifiant : le sien est son nom.
  assert.deepEqual(requestBody(p.entries[0]!, new Map(), { create: true, dryRun: true }), { locale: 'fr', values: { email: 'a@b.fr', phone: '' }, publish: ['fr'], dryRun: true })
})

test('brouillon : par option, pour tout le fichier, ou élément par élément', () => {
  const items = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B', status: 'published' }, { id: 'c', name: 'C', status: 'draft' }]
  const publish = (p: ReturnType<typeof plan>) => p.entries.map(e => e.publish)
  assert.deepEqual(publish(plan({ collections: { categories: items } })), [true, true, false])
  assert.deepEqual(publish(plan({ collections: { categories: items } }, { status: 'draft' })), [false, true, false])
  assert.deepEqual(publish(plan({ status: 'draft', collections: { categories: items } })), [false, true, false])
  // Le fichier a priorité sur l'option de la ligne de commande.
  assert.deepEqual(publish(plan({ status: 'published', collections: { categories: items } }, { status: 'draft' })), [true, true, false])
  assert.equal('publish' in requestBody(entry(plan({ collections: { categories: items } }), 'c'), new Map(), { create: true, dryRun: false }), false)
})

test('plusieurs langues : un bloc par langue, avec les seuls champs traduits', () => {
  const p = service({ price: 10, slug: 'un', seo: { title: 'T', noindex: true }, en: { title: 'One', slug: 'one', seo: { description: 'D' } } })
  assert.deepEqual(p.errors, [])
  const e = entry(p, 's1')
  assert.deepEqual(e.values, { title: 'Un', price: 10, seo: { title: 'T', noindex: true } })
  assert.equal(e.slug, 'un')
  assert.deepEqual(e.translations, { en: { values: { title: 'One', seo: { description: 'D' } }, slug: 'one' } })
  assert.deepEqual(requestBody(e, new Map(), { create: false, dryRun: false }), {
    locale: 'fr', values: e.values, slug: 'un', translations: { en: { values: { title: 'One', seo: { description: 'D' } }, slug: 'one' } }, publish: ['fr', 'en'],
  })
  // La langue par défaut peut aussi s'écrire dans son bloc ; une traduction vide n'est pas envoyée.
  const own = plan({ collections: { categories: [{ id: 'pro', fr: { name: 'Pro' }, en: {} }] } })
  assert.deepEqual(own.errors, [])
  assert.deepEqual(requestBody(own.entries[0]!, new Map(), { create: false, dryRun: false }), { locale: 'fr', values: { name: 'Pro' }, publish: ['fr'] })
})

test('un champ commun dans une traduction : refusé s\'il diffère, sans conséquence s\'il est répété à l\'identique', () => {
  assert.match(service({ price: 10, en: { title: 'One', price: 12 } }).errors.join('\n'), /collections\.services\[0\] \(« s1 »\)\.en\.price : ce champ est commun à toutes les langues/)
  const same = service({ price: 10, en: { title: 'One', price: 10 } })
  assert.deepEqual(same.errors, [])
  assert.deepEqual(entry(same, 's1').translations.en!.values, { title: 'One' })
  assert.match(service({ en: { seo: { noindex: true } } }).errors.join('\n'), /en\.seo\.noindex : commun à toutes les langues/)
})

test('images et fichiers : chemin dans public/ ou à côté du fichier d\'import, texte alternatif, un seul envoi par fichier', () => {
  const p = service(
    { cover: '/photos/a.jpg', brochure: 'docs/plaquette.pdf', prices: [{ amount: '50 €', photo: { file: '/photos/a.jpg', alt: 'Vue de face' } }], seo: { image: { file: '/photos/a.jpg', alt: { en: 'Front view' } } } },
    [{ id: 's2', title: 'Deux', cover: { file: 'photos/b.png', alt: 'B' } }],
  )
  assert.deepEqual(p.errors, [])
  assert.deepEqual(p.files.map(f => [f.path, f.image, f.alt]), [
    ['/projet/public/photos/a.jpg', true, { fr: 'Vue de face', en: 'Front view' }],
    ['/projet/import/docs/plaquette.pdf', false, {}],
    ['/projet/import/photos/b.png', true, { fr: 'B' }],
  ])
  const ids = new Map([['/projet/public/photos/a.jpg', 'media-a'], ['/projet/import/docs/plaquette.pdf', 'media-p']])
  const body = requestBody(entry(p, 's1'), ids, { create: false, dryRun: false })
  assert.equal(body.values.cover, 'media-a')
  assert.equal(body.values.brochure, 'media-p')
  assert.deepEqual(body.values.prices, [{ amount: '50 €', photo: 'media-a' }])
  assert.deepEqual(body.values.seo, { image: 'media-a' })
})

test('deux textes alternatifs différents pour le même fichier : le premier est gardé, avec un avertissement', () => {
  const p = service({ cover: { file: '/a.jpg', alt: 'Un' }, prices: [{ amount: '1', photo: { file: '/a.jpg', alt: 'Deux' } }] })
  assert.deepEqual(p.errors, [])
  assert.equal(p.files[0]!.alt.fr, 'Un')
  assert.equal(p.warnings.length, 1)
})

test('relations et liens désignent un autre élément du fichier par sa clé', () => {
  const p = service(
    { category: 'pro', related: ['s2'], cta: { page: 'services', id: 's2', label: 'Voir' } },
    [{ id: 's2', title: 'Deux', cta: 'https://exemple.fr', related: [] }, { id: 's3', title: 'Trois', cta: { page: 'contact' } }, { id: 's4', title: 'Quatre', cta: { url: '/contact', newTab: true } }],
  )
  assert.deepEqual(p.errors, [])
  assert.deepEqual(entry(p, 's1').values, { title: 'Un', category: importId('categories', 'pro'), related: [importId('services', 's2')], cta: { kind: 'page', type: 'services', id: importId('services', 's2'), label: 'Voir' } })
  assert.deepEqual(entry(p, 's2').values.cta, { kind: 'url', url: 'https://exemple.fr' })
  assert.deepEqual(entry(p, 's3').values.cta, { kind: 'page', type: 'contact', id: 'contact' })
  assert.deepEqual(entry(p, 's4').values.cta, { kind: 'url', url: '/contact', newTab: true })
})

test('null et texte vide vident un champ ; un champ absent n\'est pas envoyé', () => {
  const p = service({ body: '', price: null, cover: null, category: '', cta: null, audience: '' })
  assert.deepEqual(p.errors, [])
  assert.deepEqual(entry(p, 's1').values, { title: 'Un', body: '', price: null, cover: null, category: null, cta: null, audience: '' })
})

test('collection, page unique ou champ inconnu : l\'erreur dit où et propose les noms possibles', () => {
  const errors = plan({ pages: {}, collections: { articles: [], contact: [], services: [{ id: 's1', titel: 'x' }] }, singletons: { accueil: {}, services: {} } }).errors.join('\n')
  assert.match(errors, /« pages » : clé inconnue à la racine/)
  assert.match(errors, /collections\.articles : collection inconnue\. Collections de cms\.config\.ts : categories, services/)
  assert.match(errors, /collections\.contact : c'est une page unique/)
  assert.match(errors, /singletons\.accueil : page unique inconnue\. Pages uniques de cms\.config\.ts : contact/)
  assert.match(errors, /singletons\.services : c'est une collection/)
  assert.match(errors, /collections\.services\[0\] \(« s1 »\)\.titel : champ inconnu dans « services »\. Champs possibles : title, body, /)
})

test('valeur du mauvais type : une erreur par champ, avec ce qui était attendu', () => {
  const errors = service({
    title: 12, price: '150', onQuote: 'oui', date: '17/11/2026', audience: 'tous', tags: 'a', cover: 3, cta: 'contact', category: 'inconnue', related: 's1',
    prices: [{ label: 'x' }, { amount: '1', prix: 2 }, 'trois', { amount: '4' }],
  }).errors
  const at = 'collections.services[0] (« s1 »)'
  const has = (text: string) => assert.ok(errors.some(e => e.startsWith(`${at}.${text}`)), `${text}\n${errors.join('\n')}`)
  has('title : texte attendu (reçu un nombre)')
  has('price : nombre attendu (reçu un texte)')
  has('onQuote : true ou false attendu')
  has('date : date attendue, comme "2026-11-17" (reçu "17/11/2026")')
  has('audience : choix inconnu "tous". Choix possibles : pro, perso')
  has('tags : liste de choix attendue')
  has('cover : attendu le chemin d\'un fichier')
  has('cta : l\'adresse doit commencer par')
  has('category : aucun élément « inconnue » dans collections.categories')
  has('related : liste d\'id d\'éléments de « services » attendue')
  has('prices : 3 éléments au maximum (4 ici)')
  has('prices[0].amount : champ obligatoire')
  has('prices[1].prix : champ inconnu')
  has('prices[2] : objet attendu')
  // Un élément en erreur n'est pas préparé ; les autres le sont.
  assert.deepEqual(service({ price: 'x' }).entries.map(e => e.key), ['pro'])
})

test('règles des champs : longueur, bornes, format', () => {
  const errors = service({ title: 'x'.repeat(41), price: -1 }).errors.join('\n')
  assert.match(errors, /title : 40 caractères au maximum \(41 ici\)/)
  assert.match(errors, /price : 0 au minimum/)
  assert.match(service({ price: 1.5 }).errors.join('\n'), /price : nombre entier attendu/)
  assert.match(plan({ singletons: { contact: { email: 'pas-une-adresse' } } }).errors.join('\n'), /singletons\.contact\.email : adresse e-mail invalide/)
})

test('id : obligatoire et unique dans une collection, refusé pour une page unique', () => {
  const errors = plan({ collections: { categories: [{ name: 'A' }, { id: 'x', name: 'B' }, { id: 'x', name: 'C' }] }, singletons: { contact: { id: 'c', email: 'a@b.fr' } } }).errors.join('\n')
  assert.match(errors, /collections\.categories\[0\] : id manquant/)
  assert.match(errors, /collections\.categories\[2\] \(« x »\) : l'id « x » est déjà utilisé/)
  assert.match(errors, /singletons\.contact\.id : champ inconnu/)
})

test('slug et seo ne sont acceptés que si le contenu en a', () => {
  const errors = plan({ collections: { categories: [{ id: 'a', name: 'A', slug: 'a', seo: { title: 'T' } }] } }).errors.join('\n')
  assert.match(errors, /slug : « categories » n'a pas d'adresse de page/)
  assert.match(errors, /seo : « categories » n'a pas l'onglet Référencement/)
})

test('dimensions d\'une image lues dans le fichier', () => {
  const png = Buffer.alloc(24)
  png.writeUInt32BE(0x89504e47, 0); png.writeUInt32BE(320, 16); png.writeUInt32BE(240, 20)
  assert.deepEqual(imageSize(png), { width: 320, height: 240 })
  const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.from([0x40, 0x01, 0xf0, 0x00])])
  assert.deepEqual(imageSize(gif), { width: 320, height: 240 })
  // JPEG : un bloc APP0 puis le bloc SOF0 qui porte hauteur et largeur.
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0xf0, 0x01, 0x40, 0x03, 0x00, 0x00])
  assert.deepEqual(imageSize(jpeg), { width: 320, height: 240 })
  assert.equal(imageSize(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null)
})

test('galerie : liste ordonnée de chemins ou de { file, alt, caption }, au premier niveau et dans un répéteur', () => {
  const gallery = defineCms({
    site: { name: 'Test', locales: ['fr', 'en'], defaultLocale: 'fr' },
    collections: {
      works: collection({
        label: 'Réalisations',
        titleField: 'title',
        fields: {
          title: f.text({ label: 'Titre' }),
          photos: f.image({ label: 'Photos', multiple: true, captions: true, max: 3 }),
          docs: f.file({ label: 'Documents', multiple: true }),
          cases: f.repeater({ label: 'Cas', fields: { name: f.text({ label: 'Nom' }), photos: f.image({ label: 'Photos', multiple: true, captions: true }) } }),
        },
      }),
    },
  }) as unknown as CmsConfig
  const run = (item: object) => planImport(gallery, { collections: { works: [{ id: 'w', title: 'W', ...item }] } }, options)
  const p = run({
    photos: ['/a.jpg', { file: 'b.png', alt: 'Vue B', caption: 'Marseille (13)' }],
    docs: [],
    cases: [{ name: 'Un', photos: [{ file: '/a.jpg', caption: 'Lyon' }] }],
    en: { cases: [{ name: 'One', photos: [{ file: '/a.jpg', caption: 'Lyon, France' }] }] },
  })
  assert.deepEqual(p.errors, [])
  assert.deepEqual(p.files.map(x => [x.path, x.image, x.alt]), [['/projet/public/a.jpg', true, {}], ['/projet/import/b.png', true, { fr: 'Vue B' }]])
  const ids = new Map([['/projet/public/a.jpg', 'm-a'], ['/projet/import/b.png', 'm-b']])
  const body = requestBody(p.entries[0]!, ids, { create: true, dryRun: false })
  assert.deepEqual(body.values.photos, [{ media: 'm-a' }, { media: 'm-b', caption: 'Marseille (13)' }])
  assert.deepEqual(body.values.docs, [])
  assert.deepEqual(body.values.cases, [{ name: 'Un', photos: [{ media: 'm-a', caption: 'Lyon' }] }])
  assert.deepEqual(body.translations?.en?.values.cases, [{ name: 'One', photos: [{ media: 'm-a', caption: 'Lyon, France' }] }])

  const bad = run({ photos: '/a.jpg', docs: [{ file: 'x.pdf', caption: 'Non' }], cases: [{ photos: [{ file: '/a.jpg', caption: 3 }] }] })
  assert.deepEqual(bad.errors, [
    'collections.works[0] (« w »).photos : liste de fichiers attendue, dans l\'ordre d\'affichage : ["/photos/a.jpg", { "file": "…", "alt": "…", "caption": "…" }] (reçu un texte).',
    'collections.works[0] (« w »).docs[0].caption : clé inconnue. Clés possibles : file, alt. (Ce champ n\'a pas de légende : captions: true dans la configuration.)',
    'collections.works[0] (« w »).cases[0].photos[0].caption : texte attendu (reçu un nombre).',
  ])
  assert.match(run({ photos: ['/1.jpg', '/2.jpg', '/3.jpg', '/4.jpg'] }).errors[0]!, /photos : 3 fichiers au maximum \(4 ici\)/)
})
