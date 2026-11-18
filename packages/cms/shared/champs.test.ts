// Galeries (image ou fichier avec `multiple`) et sections du formulaire : logique pure.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeValues, toMediaItems, toPublicValues, validateValues } from './content.ts'
import { splitFlat } from './flat.ts'
import { collection, defineCms, f, section, singleton, validate, type AnyField } from './format.ts'
import { convertValue, diffSchema, runMigration, shapeOf, type Doc } from './migrate.ts'

type Fields = Record<string, AnyField>
const site = { name: 'Test', locales: ['fr', 'en'] as const, defaultLocale: 'fr' }

const fields = {
  title: f.text({ label: 'Titre' }),
  photos: f.image({ label: 'Photos', multiple: true, captions: true, min: 2, max: 3 }),
  plain: f.image({ label: 'Sans légende', multiple: true }),
  docs: f.file({ label: 'Documents', multiple: true }),
  cases: f.repeater({ label: 'Cas', fields: { name: f.text({ label: 'Nom' }), photos: f.image({ label: 'Photos', multiple: true, captions: true }) } }),
} as unknown as Fields

describe('galerie : valeur enregistrée', () => {
  it('une liste d\'identifiants ou une valeur seule devient une liste d\'éléments { media }', () => {
    assert.deepEqual(toMediaItems(['a', { media: 'b', caption: 'B' }]), [{ media: 'a' }, { media: 'b', caption: 'B' }])
    assert.deepEqual(toMediaItems('a'), [{ media: 'a' }])
    assert.deepEqual(toMediaItems(null), [])
    assert.deepEqual(toMediaItems(''), [])
    // Légende vide : retirée.
    assert.deepEqual(toMediaItems([{ media: 'a', caption: '  ' }, { media: 'b', caption: null }]), [{ media: 'a' }, { media: 'b' }])
  })

  it('mise en forme à l\'enregistrement, y compris dans un répéteur', () => {
    const values = normalizeValues(fields, { title: 'x', plain: ['a'], cases: [{ name: 'Un', photos: ['p1', { media: 'p2', caption: 'Lyon' }] }] })
    assert.deepEqual(values, { title: 'x', plain: [{ media: 'a' }], cases: [{ name: 'Un', photos: [{ media: 'p1' }, { media: 'p2', caption: 'Lyon' }] }] })
    // Un champ absent n'est pas créé.
    assert.equal('docs' in values, false)
  })
})

describe('galerie : validation à la publication', () => {
  const ok = [{ media: 'a', caption: 'A' }, { media: 'b' }]
  it('min, max, éléments mal formés', () => {
    assert.deepEqual(validateValues(fields, { photos: ok }), {})
    assert.deepEqual(validateValues(fields, { photos: [{ media: 'a' }] }), { photos: '2 images au minimum.' })
    assert.deepEqual(validateValues(fields, { photos: [...ok, ...ok] }), { photos: '3 images au maximum.' })
    assert.deepEqual(validateValues(fields, { photos: [{ media: 'a', legende: 'x' }, { media: 'b' }] }), { photos: 'Liste de fichiers invalide.' })
    assert.deepEqual(validateValues(fields, { docs: 'a' }), { docs: 'Liste de fichiers invalide.' })
    assert.deepEqual(validateValues(fields, { cases: [{ photos: [{ media: 3 }] }] }), { 'cases.0.photos': 'Liste de fichiers invalide.' })
  })
  it('obligatoire : au moins une image', () => {
    const required = { g: f.image({ label: 'G', multiple: true, required: true }) } as unknown as Fields
    assert.deepEqual(validateValues(required, { g: [] }), { g: 'Ce champ est obligatoire.' })
    assert.deepEqual(validateValues(required, { g: [{ media: 'a' }] }), {})
  })
})

describe('galerie : ce que reçoit le site (avant le remplacement par les fichiers)', () => {
  it('vide : toujours []', () => {
    for (const v of [undefined, null, '', []]) {
      const out = toPublicValues(fields, { photos: v, plain: v, docs: v, cases: [{ photos: v }] })
      assert.deepEqual([out.photos, out.plain, out.docs, (out.cases as any)[0].photos], [[], [], [], []])
    }
  })
  it('légende : null si vide, absente si le champ n\'en a pas', () => {
    const out = toPublicValues(fields, { photos: [{ media: 'a', caption: 'A' }, { media: 'b' }, { media: '' }, 'c'], plain: [{ media: 'a', caption: 'oubliée' }] })
    assert.deepEqual(out.photos, [{ media: 'a', caption: 'A' }, { media: 'b', caption: null }, { media: 'c', caption: null }])
    assert.deepEqual(out.plain, [{ media: 'a' }])
  })
  it('masquée par showIf : vide', () => {
    const cond = { on: f.boolean({ label: 'On' }), g: f.image({ label: 'G', multiple: true, showIf: { field: 'on', equals: true } }) } as unknown as Fields
    assert.deepEqual(toPublicValues(cond, { on: false, g: [{ media: 'a' }] }).g, [])
  })
})

describe('galerie : écriture à plat', () => {
  it('signale les clés inconnues des éléments, au premier niveau et dans un répéteur', () => {
    const out = splitFlat(fields, { photos: [{ media: 'a', legende: 'x' }], cases: [{ photos: [{ media: 'a' }, { file: 'b' }] }] })
    assert.deepEqual(out.unknown, ['photos.0.legende', 'cases.0.photos.1.file'])
  })
})

describe('galerie : configuration', () => {
  const check = (field: AnyField) => validate({ site, collections: { c: collection({ label: 'C', titleField: 't', fields: { t: f.text({ label: 'T' }), g: field } }) } } as any)
  it('captions, min et max demandent multiple', () => {
    assert.deepEqual(check(f.image({ label: 'G', captions: true }) as AnyField), ['c.g : captions, min et max demandent multiple: true'])
    assert.deepEqual(check(f.image({ label: 'G', multiple: true, min: 3, max: 2 }) as AnyField), ['c.g : min est plus grand que max'])
    assert.deepEqual(check(f.file({ label: 'G', multiple: true, captions: true, max: 4 }) as AnyField), [])
  })
  it('vignette de liste : une galerie convient (sa première image)', () => {
    const errors = validate({ site, collections: { c: collection({ label: 'C', titleField: 't', list: { thumbnail: 'g' }, fields: { t: f.text({ label: 'T' }), g: f.image({ label: 'G', multiple: true }) } }) } } as any)
    assert.deepEqual(errors, [])
  })
  it('showIf « vide » sur une galerie', () => {
    const errors = validate({ site, collections: { c: collection({ label: 'C', titleField: 't', fields: { t: f.text({ label: 'T' }), g: f.image({ label: 'G', multiple: true }), more: f.text({ label: 'M', showIf: { field: 'g', empty: false } }) } }) } } as any)
    assert.deepEqual(errors, [])
  })
})

describe('galerie : migrations de contenu', () => {
  it('image seule → galerie : sans perte', () => {
    assert.deepEqual(convertValue({ type: 'image' }, { type: 'image', multiple: true }, 'm1'), { result: 'ok', value: [{ media: 'm1' }] })
    assert.deepEqual(convertValue({ type: 'image' }, { type: 'file', multiple: true }, 'm1'), { result: 'ok', value: [{ media: 'm1' }] })
  })
  it('galerie → image seule : la première ; perte signalée s\'il y en avait d\'autres ou une légende', () => {
    assert.deepEqual(convertValue({ type: 'image', multiple: true }, { type: 'image' }, [{ media: 'm1' }]), { result: 'ok', value: 'm1' })
    assert.deepEqual(convertValue({ type: 'image', multiple: true }, { type: 'image' }, [{ media: 'm1' }, { media: 'm2' }]), { result: 'lossy', value: 'm1' })
    assert.deepEqual(convertValue({ type: 'image', multiple: true }, { type: 'image' }, [{ media: 'm1', caption: 'Lyon' }]), { result: 'lossy', value: 'm1' })
  })
  it('image ↔ fichier', () => {
    assert.deepEqual(convertValue({ type: 'image', multiple: true }, { type: 'file', multiple: true }, [{ media: 'm1', caption: 'A' }]), { result: 'ok', value: [{ media: 'm1', caption: 'A' }] })
    assert.deepEqual(convertValue({ type: 'file', multiple: true }, { type: 'image', multiple: true }, [{ media: 'm1' }]), { result: 'fail' })
    assert.deepEqual(convertValue({ type: 'image' }, { type: 'text' }, 'm1'), { result: 'fail' })
  })

  it('exécution : une image devenue galerie, au premier niveau et dans un répéteur, s\'applique toute seule', () => {
    const make = (multiple: boolean) => defineCms({
      site,
      singletons: {
        home: singleton({
          label: 'Accueil',
          fields: {
            cover: f.image({ label: 'Image', ...(multiple ? { multiple: true } : {}) }),
            cases: f.repeater({ label: 'Cas', fields: { photo: f.image({ label: 'Photo', ...(multiple ? { multiple: true, captions: true } : {}) }) } }),
          },
        }),
      },
    })
    const before = shapeOf(make(false) as any)
    const after = shapeOf(make(true) as any)
    const ops = diffSchema(before, after)
    assert.deepEqual(ops.map(o => o.kind), ['convert', 'convert'])
    const docs: Doc[] = [{
      id: 'home', type: 'home',
      shared: { draft: { cover: 'm1' }, published: { cover: 'm1' } },
      locales: [{ locale: 'fr', status: 'published', draft: { cases: [{ photo: 'p1' }, { photo: null }] }, published: { cases: [{ photo: 'p1' }] } }],
    }]
    const result = runMigration(docs, before, ops, { site })
    assert.equal(result.pending.length, 0)
    assert.deepEqual(result.docs[0]!.shared.draft, { cover: [{ media: 'm1' }] })
    assert.deepEqual(result.docs[0]!.locales[0]!.draft, { cases: [{ photo: [{ media: 'p1' }] }, { photo: null }] })
    assert.equal(result.docs[0]!.locales[0]!.status, 'published')
  })

  it('exécution : une galerie redevenue image seule attend une validation, et garde la liste complète de côté', () => {
    const make = (multiple: boolean) => defineCms({ site, singletons: { home: singleton({ label: 'Accueil', fields: { cover: f.image({ label: 'Image', ...(multiple ? { multiple: true } : {}) }) } }) } })
    const before = shapeOf(make(true) as any)
    const ops = diffSchema(before, shapeOf(make(false) as any))
    const docs: Doc[] = [{ id: 'home', type: 'home', shared: { draft: { cover: [{ media: 'm1' }, { media: 'm2' }] }, published: null }, locales: [] }]
    const first = runMigration(docs, before, ops, { site })
    assert.equal(first.pending[0]!.level, 'confirm')
    const done = runMigration(docs, before, ops, { site, confirmed: [ops[0]!.id] })
    assert.deepEqual(done.docs[0]!.shared.draft, { cover: 'm1', _kept: { cover: [{ media: 'm1' }, { media: 'm2' }] } })
  })

  it('légendes ajoutées ou retirées, sections : aucune migration', () => {
    const make = (extra: object, grouped: boolean) => {
      const own = { g: f.image({ label: 'G', multiple: true, ...extra }), t: f.text({ label: 'T' }) }
      return defineCms({ site, singletons: { home: singleton({ label: 'Accueil', fields: grouped ? section({ label: 'S', collapsed: true }, own) : own }) } })
    }
    assert.deepEqual(diffSchema(shapeOf(make({}, false) as any), shapeOf(make({ captions: true }, true) as any)), [])
  })
})

describe('sections du formulaire', () => {
  const errorsOf = (own: Record<string, unknown>) => validate({ site, collections: { c: collection({ label: 'C', titleField: 't', fields: { t: f.text({ label: 'T' }), ...own } as any }) } } as any)

  it('section() pose la même section sur chaque champ, sans changer leurs noms', () => {
    const out = section({ label: 'Bandeau', help: 'Aide' }, { a: f.text({ label: 'A' }), b: f.image({ label: 'B' }) })
    assert.deepEqual(Object.keys(out), ['a', 'b'])
    assert.deepEqual(out.a.section, { label: 'Bandeau', help: 'Aide' })
    assert.equal(out.b.type, 'image')
  })
  it('acceptées : plusieurs sections, champs hors section entre elles', () => {
    assert.deepEqual(errorsOf({ ...section({ label: 'A' }, { a1: f.text({ label: 'x' }), a2: f.text({ label: 'x' }) }), z: f.text({ label: 'z' }), ...section({ label: 'B', collapsed: true }, { b1: f.text({ label: 'x' }) }) }), [])
  })
  it('les champs d\'une section se suivent', () => {
    const errors = errorsOf({ ...section({ label: 'A' }, { a1: f.text({ label: 'x' }) }), z: f.text({ label: 'z' }), ...section({ label: 'A' }, { a2: f.text({ label: 'x' }) }) })
    assert.deepEqual(errors, ['c : les champs de la section « A » doivent se suivre (« a2 » est séparé des autres)'])
  })
  it('une même section a les mêmes réglages partout, et un titre', () => {
    assert.deepEqual(errorsOf({ ...section({ label: 'A' }, { a1: f.text({ label: 'x' }) }), ...section({ label: 'A', collapsed: true }, { a2: f.text({ label: 'x' }) }) }),
      ['c.a2.section : la section « A » est déclarée avec d\'autres réglages (help, collapsed) plus haut'])
    assert.deepEqual(errorsOf({ ...section({ label: ' ' }, { a1: f.text({ label: 'x' }) }) }), ['c.a1.section : un titre est attendu (utilisez section({ label: \'…\' }, { … }))'])
  })
  it('refusées dans un répéteur, avec une explication', () => {
    const errors = errorsOf({ r: f.repeater({ label: 'R', fields: section({ label: 'A' }, { a: f.text({ label: 'x' }) }) }) })
    assert.deepEqual(errors, ['c.r.a : pas de section dans un répéteur (ses éléments se replient déjà) ; rangez le répéteur entier dans une section'])
  })
  it('n\'affectent ni les données ni ce que reçoit le site', () => {
    const plain = { a: f.text({ label: 'A' }), g: f.image({ label: 'G', multiple: true }) } as unknown as Fields
    const grouped = section({ label: 'S' }, plain) as unknown as Fields
    const values = { a: 'x', g: [{ media: 'm' }] }
    assert.deepEqual(toPublicValues(grouped, values), toPublicValues(plain, values))
    assert.deepEqual(splitFlat(grouped, values), splitFlat(plain, values))
  })
})
