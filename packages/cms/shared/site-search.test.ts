import assert from 'node:assert/strict'
import { test } from 'node:test'
import { f } from './format'
import { contentTexts, highlightParts, htmlToText, isSearchable, siteSearchExcerpt, siteSearchScore, siteSearchWords } from './site-search'

const text = (parts: { text: string; match: boolean }[]) => parts.map(p => (p.match ? `[${p.text}]` : p.text)).join('')

test('contenus cherchables : ceux qui ont une page, sauf search: false', () => {
  assert.equal(isSearchable({ path: '/a' }), true)
  assert.equal(isSearchable({}), false)
  assert.equal(isSearchable({ path: '/a', search: false }), false)
  assert.equal(isSearchable({ search: true }), false)
})

test('mots d\'une recherche : accents et majuscules ignorés, recherche trop courte refusée', () => {
  assert.deepEqual(siteSearchWords('  Droit des AFFAIRES '), ['droit', 'des', 'affaires'])
  assert.deepEqual(siteSearchWords('l\'Été'), ['l', 'ete'])
  assert.equal(siteSearchWords('a'), null)
  assert.equal(siteSearchWords(''), null)
  assert.equal(siteSearchWords(undefined), null)
  assert.equal(siteSearchWords('a b c d e f g h i j')!.length, 8)
})

test('texte d\'un HTML : balises retirées sans coller les mots, entités décodées', () => {
  assert.equal(htmlToText('<h2>Titre</h2><p>Un&nbsp;texte &amp; un &eacute;t&#233; &#x41;</p>'), 'Titre Un texte & un été A')
  assert.equal(htmlToText('<p></p>'), '')
  assert.equal(htmlToText('<p>Un <strong>mot</strong>, puis <a href="/x">un lien</a>.</p><ul><li>un</li><li>deux</li></ul>'), 'Un mot, puis un lien. un deux')
})

test('textes d\'un contenu : textes seulement, répéteurs compris, champs masqués et adresses exclus', () => {
  const fields = {
    title: f.text({ label: 'Titre' }),
    email: f.text({ label: 'E-mail', format: 'email' }),
    body: f.richText({ label: 'Texte' }),
    show: f.boolean({ label: 'Afficher' }),
    hidden: f.textarea({ label: 'Masqué', showIf: { field: 'show', equals: true } }),
    faq: f.repeater({ label: 'FAQ', fields: { q: f.text({ label: 'Q' }), a: f.textarea({ label: 'R' }) } }),
    price: f.number({ label: 'Prix' }),
  }
  const values = { title: 'Droit', email: 'a@b.fr', body: '<p>Bonjour <strong>à tous</strong></p>', show: false, hidden: 'secret', faq: [{ q: 'Quand ?', a: 'Demain' }], price: 3 }
  assert.deepEqual(contentTexts(fields, values, 'title'), ['Bonjour à tous', 'Quand ?', 'Demain'])
  assert.deepEqual(contentTexts(fields, { ...values, show: true }, 'title').includes('secret'), true)
})

test('pertinence : le titre d\'abord, puis la description, le texte, puis les mots répartis', () => {
  const doc = { title: 'Droit des affaires', description: 'Conseil aux entreprises', texts: ['Nous accompagnons les sociétés à Lyon.'] }
  assert.equal(siteSearchScore(doc, ['droit']), 0)
  assert.equal(siteSearchScore(doc, ['affaires']), 1)
  assert.equal(siteSearchScore(doc, ['ffaires']), 2)
  assert.equal(siteSearchScore(doc, ['conseil']), 3)
  assert.equal(siteSearchScore(doc, ['societes']), 4)
  assert.equal(siteSearchScore(doc, ['droit', 'lyon']), 5)
  assert.equal(siteSearchScore(doc, ['droit', 'paris']), null)
  assert.equal(siteSearchScore(doc, []), null)
})

test('mise en évidence : retrouvée dans le texte d\'origine malgré accents, majuscules et ligatures', () => {
  assert.equal(text(highlightParts('Les Sociétés du cœur de Lyon', ['societes', 'coeur'])), 'Les [Sociétés] du [cœur] de Lyon')
  assert.equal(text(highlightParts('aaa', ['aa'])), '[aa]a')
  assert.equal(text(highlightParts('rien ici', ['xyz'])), 'rien ici')
  // Deux mots qui se chevauchent ne font qu'un morceau.
  assert.equal(text(highlightParts('droitier', ['droit', 'oitier'])), '[droitier]')
})

test('extrait : passage autour du mot trouvé, coupé à des fins de mots', () => {
  const long = `${'Un début sans rapport. '.repeat(12)}Le cabinet plaide en droit du travail depuis vingt ans. ${'Une suite sans rapport. '.repeat(12)}`
  const parts = siteSearchExcerpt({ title: 'Page', description: '', texts: [long] }, ['travail'])
  const shown = text(parts)
  assert.ok(shown.startsWith('… ') && shown.endsWith(' …'), shown)
  assert.ok(shown.includes('[travail]'), shown)
  assert.ok(shown.length <= 170, String(shown.length))
  // Sans mot trouvé dans les textes : le début de la description.
  assert.equal(text(siteSearchExcerpt({ title: 'Droit', description: 'Résumé de la page', texts: ['Autre'] }, ['droit'])), 'Résumé de la page')
  assert.deepEqual(siteSearchExcerpt({ title: 'Droit', description: '', texts: [] }, ['droit']), [])
  // Plusieurs textes : celui qui contient le plus de mots cherchés, pas le premier venu.
  assert.equal(text(siteSearchExcerpt({ title: 'x', description: 'Cessions de sociétés.', texts: ['Les sociétés lyonnaises.'] }, ['societes', 'lyonnaises'])), 'Les [sociétés] [lyonnaises].')
  // Texte court : entier, sans points de suspension.
  assert.equal(text(siteSearchExcerpt({ title: 'x', description: '', texts: ['Droit du travail'] }, ['travail'])), 'Droit du [travail]')
})
