import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { collection, defineCms, f, singleton, validate, type CmsConfig } from './format'
import {
  type Doc, type Snapshot, KEPT_KEY, applyToSnapshot, assumedBaseline, convertValue, diffSchema, hashOf, htmlToText,
  planMigration, runMigration, shapeOf, textToHtml, unknownValues,
} from './migrate'

const site = { locales: ['fr', 'en'], defaultLocale: 'fr' } as const

/** Configuration de départ des tests : un singleton avec répéteur, une collection. */
const v1 = () => ({
  site: { name: 'Test', locales: ['fr', 'en'] as [string, ...string[]], defaultLocale: 'fr' },
  singletons: {
    home: singleton({
      label: 'Accueil', path: '/',
      fields: {
        heroTitle: f.text({ label: 'Titre' }),
        cta: f.link({ label: 'Bouton' }),
        faq: f.repeater({ label: 'Questions', fields: { question: f.text({ label: 'Question' }), answer: f.textarea({ label: 'Réponse' }) } }),
      },
    }),
  },
  collections: {
    services: collection({
      label: 'Services', path: '/services/[slug]', titleField: 'title',
      fields: {
        title: f.text({ label: 'Titre' }),
        excerpt: f.textarea({ label: 'Résumé' }),
        price: f.text({ label: 'Tarif', localized: false }),
        audience: f.select({ label: 'Public', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] }),
      },
    }),
  },
})
type V1 = ReturnType<typeof v1>
const shape = (config: unknown) => shapeOf(defineCms(config as never) as unknown as CmsConfig)
const snapshotOf = (config: unknown): Snapshot => { const s = shape(config); return assumedBaseline(s) }
/** Modifie une copie de la configuration de départ. */
const edit = (change: (c: V1) => void) => { const c = v1(); change(c); return c }
const kinds = (base: Snapshot, config: unknown) => diffSchema(base, shape(config)).map(o => o.id)

const service = (over: Partial<Doc> = {}): Doc => ({
  id: 's1', type: 'services',
  shared: { draft: { price: '120', audience: 'a' }, published: { price: '100', audience: 'a' } },
  locales: [
    { locale: 'fr', status: 'changed', draft: { title: 'Conseil', excerpt: 'Ligne 1\nLigne 2' }, published: { title: 'Conseil', excerpt: 'Ancien' } },
    { locale: 'en', status: 'draft', draft: { title: 'Advice', excerpt: 'One' }, published: null },
  ],
  ...over,
})
const home = (): Doc => ({
  id: 'home', type: 'home',
  shared: { draft: {}, published: {} },
  locales: [{
    locale: 'fr', status: 'published',
    draft: { heroTitle: 'Bonjour', cta: { kind: 'page', type: 'services', id: 's1' }, faq: [{ question: 'Q1', answer: 'R1' }, { question: 'Q2', answer: 'R2' }] },
    published: { heroTitle: 'Bonjour', cta: { kind: 'page', type: 'services', id: 's1' }, faq: [{ question: 'Q1', answer: 'R1' }] },
  }],
})

/** Compare, exécute tout ce qui est automatique (plus ce qui est validé) et renvoie le résultat. */
function migrate(base: Snapshot, config: unknown, docs: Doc[], options: { confirmed?: string[]; choices?: Record<string, string>; firstRun?: boolean; held?: string[] } = {}) {
  const ops = diffSchema(base, shape(config))
  return { ops, ...runMigration(docs, base, ops, { site, ...options }) }
}

describe('comparaison des structures', () => {
  it('ne trouve rien quand rien ne change', () => {
    assert.deepEqual(kinds(snapshotOf(v1()), v1()), [])
  })

  it('reconnaît un champ ajouté, retiré, renommé, relibellé', () => {
    const next = edit((c) => {
      const fields = c.collections.services.fields as Record<string, any>
      fields.summary = f.textarea({ label: 'Résumé', renamedFrom: 'excerpt' })
      delete fields.excerpt
      delete fields.audience
      fields.note = f.text({ label: 'Note' })
      fields.title = f.text({ label: 'Nom du service' })
    })
    assert.deepEqual(kinds(snapshotOf(v1()), next).sort(), [
      'add:services.note', 'meta:services.title', 'remove:services.audience', 'rename:services.summary:excerpt',
    ])
  })

  it('sans renamedFrom, un renommage est un retrait suivi d\'un ajout', () => {
    const next = edit((c) => {
      const fields = c.collections.services.fields as Record<string, any>
      fields.summary = fields.excerpt
      delete fields.excerpt
    })
    assert.deepEqual(kinds(snapshotOf(v1()), next).sort(), ['add:services.summary', 'remove:services.excerpt'])
  })

  it('suit les sous-champs d\'un répéteur et les renommages de type', () => {
    const next = edit((c) => {
      const sub = c.singletons.home.fields.faq.fields as Record<string, any>
      sub.reply = f.textarea({ label: 'Réponse', renamedFrom: 'answer' })
      delete sub.answer
      const all = c.collections as Record<string, any>
      all.offers = collection({ ...c.collections.services, renamedFrom: 'services' } as never)
      delete all.services
    })
    assert.deepEqual(kinds(snapshotOf(v1()), next), ['rename:offers:services', 'rename:home.faq.reply:answer'])
  })

  it('détecte le changement de « traduit » et de type', () => {
    const next = edit((c) => {
      const fields = c.collections.services.fields as Record<string, any>
      fields.price = f.number({ label: 'Tarif', localized: true })
      fields.title = f.text({ label: 'Titre', localized: false })
    })
    assert.deepEqual(kinds(snapshotOf(v1()), next), ['localized:services.title', 'localized:services.price', 'convert:services.price'])
  })

  it('une fois les opérations reportées dans l\'instantané, il ne reste aucune différence', () => {
    const next = edit((c) => {
      const fields = c.collections.services.fields as Record<string, any>
      fields.summary = f.richText({ label: 'Présentation', renamedFrom: 'excerpt', localized: false })
      delete fields.excerpt
      delete fields.audience
      fields.note = f.repeater({ label: 'Notes', fields: { text: f.text({ label: 'Texte' }) } })
      const sub = c.singletons.home.fields.faq.fields as Record<string, any>
      sub.reply = f.richText({ label: 'Réponse', renamedFrom: 'answer' })
      delete sub.answer
      const all = c.singletons as Record<string, any>
      all.landing = singleton({ ...c.singletons.home, label: 'Page d\'accueil', renamedFrom: 'home' } as never)
      delete all.home
    })
    const base = snapshotOf(v1())
    const ops = diffSchema(base, shape(next))
    assert.ok(ops.length >= 7)
    for (const op of ops) applyToSnapshot(base, op)
    assert.deepEqual(diffSchema(base, shape(next)), [])
    // Le champ retiré reste connu : ses valeurs sont encore en base.
    assert.equal(base.types.services!.fields.audience!.retired, true)
  })

  it('un renamedFrom laissé dans le fichier après la migration est ignoré', () => {
    const next = edit((c) => {
      const fields = c.collections.services.fields as Record<string, any>
      fields.summary = f.textarea({ label: 'Résumé', renamedFrom: 'excerpt' })
      delete fields.excerpt
    })
    const base = snapshotOf(v1())
    for (const op of diffSchema(base, shape(next))) applyToSnapshot(base, op)
    assert.deepEqual(kinds(base, next), [])
  })

  it('un champ retiré puis remis retrouve ses valeurs, et peut encore être renommé', () => {
    const without = edit((c) => { delete (c.collections.services.fields as Record<string, any>).excerpt })
    const base = snapshotOf(v1())
    for (const op of diffSchema(base, shape(without))) applyToSnapshot(base, op)
    assert.deepEqual(kinds(base, v1()), ['restore:services.excerpt'])
    const renamed = edit((c) => {
      const fields = c.collections.services.fields as Record<string, any>
      fields.summary = f.textarea({ label: 'Résumé', renamedFrom: 'excerpt' })
      delete fields.excerpt
    })
    assert.deepEqual(kinds(base, renamed), ['rename:services.summary:excerpt'])
  })

  it('première fois : chaque renamedFrom est supposé pas encore appliqué', () => {
    const next = edit((c) => {
      const fields = c.collections.services.fields as Record<string, any>
      fields.summary = f.textarea({ label: 'Résumé', renamedFrom: 'excerpt' })
      delete fields.excerpt
    })
    assert.deepEqual(diffSchema(assumedBaseline(shape(next)), shape(next)).map(o => o.id), ['rename:services.summary:excerpt'])
  })

  it('l\'empreinte change avec la structure, pas avec le reste', () => {
    assert.equal(hashOf(shape(v1())), hashOf(shape(edit((c) => { c.site.name = 'Autre' }))))
    assert.notEqual(hashOf(shape(v1())), hashOf(shape(edit((c) => { (c.collections.services.fields as Record<string, any>).excerpt = f.text({ label: 'Résumé' }) }))))
  })

  it('la configuration refuse un renamedFrom ambigu', () => {
    const errors = validate(edit((c) => {
      const fields = c.collections.services.fields as Record<string, any>
      fields.summary = f.textarea({ label: 'Résumé', renamedFrom: 'excerpt' })
      fields.a = f.text({ label: 'A', renamedFrom: 'old' })
      fields.b = f.text({ label: 'B', renamedFrom: 'old' })
    }) as never)
    assert.equal(errors.filter(e => e.includes('qui existe encore')).length, 1)
    assert.equal(errors.filter(e => e.includes('déjà utilisé')).length, 2)
  })
})

describe('conversion des valeurs', () => {
  const conv = (from: string, to: string, value: unknown, more: object = {}) => convertValue({ type: from as never }, { type: to as never, ...more }, value)

  it('texte court ↔ texte long', () => {
    assert.deepEqual(conv('text', 'textarea', 'abc'), { result: 'ok', value: 'abc' })
    assert.deepEqual(conv('textarea', 'text', 'abc'), { result: 'ok', value: 'abc' })
    assert.deepEqual(conv('textarea', 'text', 'a\n\nb'), { result: 'lossy', value: 'a b' })
  })

  it('texte → texte mis en forme : tout est échappé', () => {
    assert.deepEqual(conv('textarea', 'richText', 'a <b> & c\nd\n\ne'), { result: 'ok', value: '<p>a &lt;b&gt; &amp; c<br>d</p><p>e</p>' })
    assert.equal(textToHtml('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')
    assert.equal(htmlToText(textToHtml('a <b> & c\nd\n\ne')), 'a <b> & c\nd\n\ne')
  })

  it('texte mis en forme → texte : sans perte seulement s\'il n\'y avait pas de mise en forme', () => {
    assert.deepEqual(conv('richText', 'textarea', '<p>a</p><p>b</p>'), { result: 'ok', value: 'a\n\nb' })
    assert.deepEqual(conv('richText', 'textarea', '<p>a <strong>b</strong></p>'), { result: 'lossy', value: 'a b' })
    assert.deepEqual(conv('richText', 'text', '<p>a</p><p>b</p>'), { result: 'lossy', value: 'a b' })
    assert.deepEqual(conv('richText', 'text', '<p>a</p>'), { result: 'ok', value: 'a' })
  })

  it('nombre, date et choix', () => {
    assert.deepEqual(conv('text', 'number', ' 1 250,5 '), { result: 'ok', value: 1250.5 })
    assert.deepEqual(conv('text', 'number', 'sur devis'), { result: 'fail' })
    assert.deepEqual(conv('text', 'number', '01 23 45 67 89'), { result: 'fail' })
    assert.deepEqual(conv('text', 'number', '-0,5'), { result: 'ok', value: -0.5 })
    assert.deepEqual(conv('number', 'text', 12.5), { result: 'ok', value: '12.5' })
    assert.deepEqual(conv('text', 'date', '2026-11-17'), { result: 'ok', value: '2026-11-17' })
    assert.deepEqual(conv('text', 'date', '17/11/2026'), { result: 'fail' })
    assert.deepEqual(conv('text', 'select', 'a', { options: ['a', 'b'] }), { result: 'ok', value: 'a' })
    assert.deepEqual(conv('text', 'select', 'a', { options: ['a', 'b'], multiple: true }), { result: 'ok', value: ['a'] })
    assert.deepEqual(conv('text', 'select', 'z', { options: ['a', 'b'] }), { result: 'fail' })
  })

  it('choix unique ↔ choix multiple', () => {
    assert.deepEqual(convertValue({ type: 'relation' }, { type: 'relation', multiple: true }, 'id1'), { result: 'ok', value: ['id1'] })
    assert.deepEqual(convertValue({ type: 'select', multiple: true }, { type: 'select' }, ['a']), { result: 'ok', value: 'a' })
    assert.deepEqual(convertValue({ type: 'select', multiple: true }, { type: 'select' }, ['a', 'b']), { result: 'lossy', value: 'a' })
  })

  it('pas de conversion évidente : refus', () => {
    assert.deepEqual(conv('boolean', 'text', true), { result: 'fail' })
    assert.deepEqual(conv('link', 'text', { kind: 'url', url: 'https://a.fr' }), { result: 'fail' })
    assert.deepEqual(conv('repeater', 'text', [{ a: 1 }]), { result: 'fail' })
    assert.deepEqual(conv('file', 'image', 'm1'), { result: 'fail' })
    assert.deepEqual(conv('text', 'number', ''), { result: 'ok', value: '' })
  })
})

describe('exécution sur les contenus', () => {
  it('renommage de champ : brouillon et publié, toutes les langues, automatique', () => {
    const next = edit((c) => {
      const fields = c.collections.services.fields as Record<string, any>
      fields.summary = f.textarea({ label: 'Résumé', renamedFrom: 'excerpt' })
      delete fields.excerpt
    })
    const base = snapshotOf(v1())
    const run = migrate(base, next, [service()])
    const doc = run.docs[0]!
    assert.deepEqual(doc.locales[0]!.draft, { title: 'Conseil', summary: 'Ligne 1\nLigne 2' })
    assert.deepEqual(doc.locales[0]!.published, { title: 'Conseil', summary: 'Ancien' })
    assert.deepEqual(doc.locales[1]!.draft, { title: 'Advice', summary: 'One' })
    assert.equal(run.pending.length, 0)
    assert.equal(run.applied[0]!.stats.entries, 1)
    // Rejouer : plus aucune opération, plus aucun changement.
    const again = migrate(run.snapshot, next, run.docs)
    assert.deepEqual(again.ops, [])
    assert.deepEqual(again.docs, run.docs)
    // Même sans instantané à jour, rejouer le renommage ne change rien.
    assert.deepEqual(migrate(base, next, run.docs).docs, run.docs)
  })

  it('renommage d\'un sous-champ de répéteur', () => {
    const next = edit((c) => {
      const sub = c.singletons.home.fields.faq.fields as Record<string, any>
      sub.reply = f.textarea({ label: 'Réponse', renamedFrom: 'answer' })
      delete sub.answer
    })
    const run = migrate(snapshotOf(v1()), next, [home()])
    assert.deepEqual(run.docs[0]!.locales[0]!.draft.faq, [{ question: 'Q1', reply: 'R1' }, { question: 'Q2', reply: 'R2' }])
    assert.deepEqual(run.docs[0]!.locales[0]!.published!.faq, [{ question: 'Q1', reply: 'R1' }])
  })

  it('renommage vers un nom déjà rempli : bloqué, puis réglé par un choix explicite', () => {
    const next = edit((c) => {
      const fields = c.collections.services.fields as Record<string, any>
      fields.summary = f.textarea({ label: 'Résumé', renamedFrom: 'excerpt' })
      delete fields.excerpt
    })
    const docs = [service(), service({ id: 's2' })]
    docs[0]!.locales[0]!.draft.summary = 'Déjà saisi'
    const base = snapshotOf(v1())
    const blocked = migrate(base, next, docs)
    assert.equal(blocked.pending[0]!.level, 'blocked')
    assert.equal(blocked.pending[0]!.stats.conflicts, 1)
    assert.deepEqual(blocked.docs, docs) // rien n'a bougé, même pour le contenu sans conflit
    assert.deepEqual(blocked.snapshot, base)

    const id = blocked.pending[0]!.op.id
    assert.deepEqual(migrate(base, next, docs, { confirmed: [id] }).docs, docs) // valider sans choisir ne suffit pas
    const solved = migrate(base, next, docs, { confirmed: [id], choices: { [id]: 'keepNew' } })
    assert.deepEqual(solved.docs[0]!.locales[0]!.draft, { title: 'Conseil', summary: 'Déjà saisi', [KEPT_KEY]: { excerpt: 'Ligne 1\nLigne 2' } })
    assert.deepEqual(solved.docs[0]!.locales[0]!.published, { title: 'Conseil', summary: 'Ancien' })
    assert.equal(solved.docs[1]!.locales[0]!.draft.summary, 'Ligne 1\nLigne 2')
    assert.equal(solved.pending.length, 0)
  })

  it('première fois : un déplacement de données attend une validation', () => {
    const next = edit((c) => {
      const fields = c.collections.services.fields as Record<string, any>
      fields.summary = f.textarea({ label: 'Résumé', renamedFrom: 'excerpt' })
      delete fields.excerpt
    })
    const base = assumedBaseline(shape(next))
    const first = migrate(base, next, [service()], { firstRun: true })
    assert.equal(first.pending[0]!.level, 'confirm')
    assert.deepEqual(first.docs, [service()])
    // Aux examens suivants, l'opération retenue attend toujours ; les autres redeviennent automatiques.
    assert.equal(migrate(base, next, [service()], { held: ['rename:services.summary:excerpt'] }).pending[0]!.level, 'confirm')
    assert.equal(migrate(base, next, [service()]).pending.length, 0)
    // Sans donnée sous l'ancien nom, il n'y a rien à valider.
    assert.equal(migrate(base, next, [], { firstRun: true }).pending.length, 0)
  })

  it('traduit → commun : la langue principale fait foi, les autres valeurs sont mises de côté après validation', () => {
    const next = edit((c) => { (c.collections.services.fields as Record<string, any>).title = f.text({ label: 'Titre', localized: false }) })
    const base = snapshotOf(v1())
    const waiting = migrate(base, next, [service()])
    assert.equal(waiting.pending[0]!.level, 'confirm')
    assert.equal(waiting.pending[0]!.stats.differing, 1)
    assert.deepEqual(waiting.docs, [service()])

    const run = migrate(base, next, [service()], { confirmed: ['localized:services.title'] })
    const doc = run.docs[0]!
    assert.equal(doc.shared.draft.title, 'Conseil')
    assert.equal(doc.shared.published!.title, 'Conseil')
    assert.deepEqual(doc.locales[0]!.draft, { excerpt: 'Ligne 1\nLigne 2' })
    assert.deepEqual(doc.locales[1]!.draft, { excerpt: 'One', [KEPT_KEY]: { title: 'Advice' } })
  })

  it('traduit → commun : automatique quand toutes les langues disent la même chose ; langue principale vide → première langue remplie', () => {
    const next = edit((c) => { (c.collections.services.fields as Record<string, any>).title = f.text({ label: 'Titre', localized: false }) })
    const doc = service()
    doc.locales[0]!.draft.title = ''
    doc.locales[0]!.published = null
    const run = migrate(snapshotOf(v1()), next, [doc])
    assert.equal(run.pending.length, 0)
    assert.equal(run.docs[0]!.shared.draft.title, 'Advice')
    assert.equal('title' in run.docs[0]!.locales[1]!.draft, false)
  })

  it('commun → traduit : la valeur est recopiée dans chaque langue existante', () => {
    const next = edit((c) => { (c.collections.services.fields as Record<string, any>).price = f.text({ label: 'Tarif', localized: true }) })
    const run = migrate(snapshotOf(v1()), next, [service()])
    const doc = run.docs[0]!
    assert.equal(run.pending.length, 0)
    assert.equal(doc.locales[0]!.draft.price, '120')
    assert.equal(doc.locales[0]!.published!.price, '100')
    assert.equal(doc.locales[1]!.draft.price, '120')
    assert.equal(doc.locales[1]!.published, null)
    assert.deepEqual(doc.shared, { draft: { audience: 'a' }, published: { audience: 'a' } })
    // Aller-retour : on retrouve les contenus de départ.
    const back = migrate(run.snapshot, v1(), run.docs)
    assert.deepEqual(back.docs, [service()])
  })

  it('le passage en commun garde l\'état « publié / modifié » cohérent', () => {
    const next = edit((c) => { (c.collections.services.fields as Record<string, any>).title = f.text({ label: 'Titre', localized: false }) })
    const doc = service()
    doc.shared = { draft: {}, published: {} }
    doc.locales = [
      { locale: 'fr', status: 'changed', draft: { title: 'Nouveau' }, published: { title: 'Ancien' } },
      { locale: 'en', status: 'published', draft: { title: 'Ancien' }, published: { title: 'Ancien' } },
    ]
    const run = migrate(snapshotOf(v1()), next, [doc], { confirmed: ['localized:services.title'] })
    // Le brouillon commun (« Nouveau ») diffère du publié (« Ancien ») : l'anglais a maintenant des modifications en attente.
    assert.deepEqual(run.docs[0]!.locales.map(l => l.status), ['changed', 'changed'])
  })

  it('changement de type compatible : converti automatiquement', () => {
    const next = edit((c) => { (c.collections.services.fields as Record<string, any>).excerpt = f.richText({ label: 'Résumé' }) })
    const run = migrate(snapshotOf(v1()), next, [service()])
    assert.equal(run.pending.length, 0)
    assert.equal(run.docs[0]!.locales[0]!.draft.excerpt, '<p>Ligne 1<br>Ligne 2</p>')
    assert.equal(run.docs[0]!.locales[0]!.published!.excerpt, '<p>Ancien</p>')
    // L'instantané a avancé : rejouer ne convertit pas une seconde fois.
    assert.deepEqual(migrate(run.snapshot, next, run.docs).docs, run.docs)
  })

  it('conversion avec perte : à valider, l\'original est mis de côté', () => {
    const next = edit((c) => { (c.collections.services.fields as Record<string, any>).excerpt = f.text({ label: 'Résumé' }) })
    const base = snapshotOf(v1())
    const waiting = migrate(base, next, [service()])
    assert.equal(waiting.pending[0]!.level, 'confirm')
    assert.deepEqual(waiting.docs, [service()])
    const run = migrate(base, next, [service()], { confirmed: ['convert:services.excerpt'] })
    assert.deepEqual(run.docs[0]!.locales[0]!.draft, { title: 'Conseil', excerpt: 'Ligne 1 Ligne 2', [KEPT_KEY]: { excerpt: 'Ligne 1\nLigne 2' } })
    assert.deepEqual(run.docs[0]!.locales[1]!.draft, { title: 'Advice', excerpt: 'One' })
  })

  it('changement de type incompatible : bloqué, puis valeurs mises de côté sur choix explicite', () => {
    const next = edit((c) => { (c.collections.services.fields as Record<string, any>).price = f.number({ label: 'Tarif' }) })
    const base = snapshotOf(v1())
    const docs = [service(), service({ id: 's2', shared: { draft: { price: 'sur devis' }, published: null } })]
    const blocked = migrate(base, next, docs)
    assert.equal(blocked.pending[0]!.level, 'blocked')
    assert.equal(blocked.pending[0]!.stats.failed, 1)
    assert.deepEqual(blocked.docs, docs) // tout ou rien : la valeur convertible n'est pas convertie seule
    const id = 'convert:services.price'
    assert.deepEqual(migrate(base, next, docs, { confirmed: [id] }).docs, docs)
    const run = migrate(base, next, docs, { confirmed: [id], choices: { [id]: 'setAside' } })
    assert.equal(run.docs[0]!.shared.draft.price, 120)
    assert.equal(run.docs[0]!.shared.published!.price, 100)
    assert.deepEqual(run.docs[1]!.shared.draft, { [KEPT_KEY]: { price: 'sur devis' } })
    // Sans valeur gênante, le même changement est automatique.
    assert.equal(migrate(base, next, [service()]).pending.length, 0)
  })

  it('renommage de collection : les contenus et les liens suivent', () => {
    const next = edit((c) => {
      const all = c.collections as Record<string, any>
      all.offers = collection({ ...c.collections.services, renamedFrom: 'services' } as never)
      delete all.services
    })
    const run = migrate(snapshotOf(v1()), next, [service(), home()])
    assert.equal(run.docs[0]!.type, 'offers')
    assert.deepEqual(run.docs[1]!.locales[0]!.draft.cta, { kind: 'page', type: 'offers', id: 's1' })
    assert.deepEqual(run.docs[1]!.locales[0]!.published!.cta, { kind: 'page', type: 'offers', id: 's1' })
    assert.deepEqual(run.typeRenames, [{ from: 'services', to: 'offers', singleton: false }])
    assert.equal(run.applied[0]!.stats.entries, 2)
  })

  it('renommage de collection et de champ dans le même déploiement', () => {
    const next = edit((c) => {
      const all = c.collections as Record<string, any>
      const fields = { ...c.collections.services.fields, summary: f.textarea({ label: 'Résumé', renamedFrom: 'excerpt' }) } as Record<string, any>
      delete fields.excerpt
      all.offers = collection({ ...c.collections.services, fields, renamedFrom: 'services' } as never)
      delete all.services
    })
    const run = migrate(snapshotOf(v1()), next, [service()])
    assert.equal(run.docs[0]!.type, 'offers')
    assert.equal(run.docs[0]!.locales[1]!.draft.summary, 'One')
    assert.deepEqual(diffSchema(run.snapshot, shape(next)), [])
  })

  it('renommage de collection vers un identifiant déjà occupé : bloqué, et les champs attendent', () => {
    const next = edit((c) => {
      const all = c.collections as Record<string, any>
      const fields = { ...c.collections.services.fields, summary: f.textarea({ label: 'Résumé', renamedFrom: 'excerpt' }) } as Record<string, any>
      delete fields.excerpt
      all.offers = collection({ ...c.collections.services, fields, renamedFrom: 'services' } as never)
      delete all.services
    })
    const docs = [service(), service({ id: 'o1', type: 'offers' })]
    const run = migrate(snapshotOf(v1()), next, docs, { confirmed: ['rename:offers:services'] })
    assert.deepEqual(run.pending.map(p => p.level), ['blocked', 'waiting'])
    assert.deepEqual(run.pending[0]!.choices, [])
    assert.deepEqual(run.docs, docs)
  })

  it('renommage de singleton : la page vide créée entre-temps sous le nouveau nom est remplacée', () => {
    const next = edit((c) => {
      const all = c.singletons as Record<string, any>
      all.landing = singleton({ ...c.singletons.home, renamedFrom: 'home' } as never)
      delete all.home
    })
    const placeholder: Doc = { id: 'landing', type: 'landing', shared: { draft: {}, published: null }, locales: [] }
    const self = home()
    self.locales[0]!.draft.cta = { kind: 'page', type: 'home', id: 'home' }
    const run = migrate(snapshotOf(v1()), next, [self, placeholder])
    assert.equal(run.docs[0]!.type, 'landing')
    assert.equal(run.docs[1]!.gone, true)
    assert.deepEqual(run.docs[0]!.locales[0]!.draft.cta, { kind: 'page', type: 'landing', id: 'landing' })
    assert.deepEqual(run.typeRenames, [{ from: 'home', to: 'landing', singleton: true }])
  })

  it('un champ retiré ne perd rien, et le plan dit combien de contenus le portaient', () => {
    const next = edit((c) => { delete (c.collections.services.fields as Record<string, any>).excerpt })
    const base = snapshotOf(v1())
    const run = migrate(base, next, [service()])
    assert.deepEqual(run.docs, [service()])
    assert.equal(run.applied[0]!.stats.present, 1)
    assert.match(planMigration([service()], run.ops, { site })[0]!.text, /restent en base/)
  })

  it('l\'enregistrement conserve les valeurs que le formulaire ne connaît pas', () => {
    assert.deepEqual(unknownValues({ title: {} }, { title: 'A', old: 'B', seo: {}, [KEPT_KEY]: { x: 1 } }, ['seo']), { old: 'B', [KEPT_KEY]: { x: 1 } })
    assert.deepEqual(unknownValues({ title: {} }, null), {})
  })
})
