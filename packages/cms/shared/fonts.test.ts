import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  BUILTIN_FONTS, type CustomFont, customFamilies, fluidSize, fontFormatOf, fontLabel, guessFont, isDefaultTypography, isFontFamily, parseFontWeight,
  parseTypography, typographyCss,
} from './fonts'
import { DEFAULT_THEME, parseTheme, themeCss } from './theme'

const bytes = (...head: number[]) => new Uint8Array([...head, ...new Array(16).fill(0)])
const custom: CustomFont[] = [
  { id: 'a', url: '/media/a/maison-regular.woff2', name: 'Maison-Regular.woff2', size: 30000, format: 'woff2', family: 'Maison Neue', weight: 400, style: 'normal' },
  { id: 'b', url: '/media/b/maison-bolditalic.ttf', name: 'Maison-BoldItalic.ttf', size: 90000, format: 'ttf', family: 'Maison Neue', weight: 700, style: 'italic' },
  { id: 'c', url: '/media/c/titre.woff2', name: 'Titre[wght].woff2', size: 50000, format: 'woff2', family: 'Titre', weight: [200, 900], style: 'normal' },
]

test('polices proposées : chaque fichier annoncé existe dans le core, avec sa licence', () => {
  const dir = fileURLToPath(new URL('../fonts/', import.meta.url))
  for (const font of BUILTIN_FONTS) {
    for (const subset of ['latin', 'latin-ext']) for (const style of ['normal', ...(font.italic ? ['italic'] : [])])
      assert.ok(existsSync(`${dir}${font.id}/${font.id}-${subset}-wght-${style}.woff2`), `${font.id} ${subset} ${style}`)
    assert.ok(existsSync(`${dir}${font.id}/LICENSE`), `licence de ${font.id}`)
    // Une police sans italique n'en annonce pas : le navigateur penche alors lui-même le texte.
    assert.equal(existsSync(`${dir}${font.id}/${font.id}-latin-wght-italic.woff2`), font.italic, `italique de ${font.id}`)
  }
  assert.equal(new Set(BUILTIN_FONTS.map(f => f.id)).size, BUILTIN_FONTS.length)
})

test('format d\'un fichier : lu dans ses premiers octets', () => {
  assert.equal(fontFormatOf(bytes(0x77, 0x4F, 0x46, 0x32)), 'woff2')
  assert.equal(fontFormatOf(bytes(0x77, 0x4F, 0x46, 0x46)), 'woff')
  assert.equal(fontFormatOf(bytes(0x4F, 0x54, 0x54, 0x4F)), 'otf')
  assert.equal(fontFormatOf(bytes(0, 1, 0, 0)), 'ttf')
  assert.equal(fontFormatOf(bytes(0x74, 0x72, 0x75, 0x65)), 'ttf')
  assert.equal(fontFormatOf(bytes(0x89, 0x50, 0x4E, 0x47)), null)
  assert.equal(fontFormatOf(new Uint8Array([0x77, 0x4F, 0x46, 0x32])), null)
})

test('nom de fichier : famille, graisse et style devinés', () => {
  assert.deepEqual(guessFont('OpenSans-BoldItalic.woff2'), { family: 'Open Sans', weight: 700, style: 'italic' })
  assert.deepEqual(guessFont('maison_neue-extra-light.otf'), { family: 'maison neue', weight: 200, style: 'normal' })
  assert.deepEqual(guessFont('Inter-VariableFont_wght.ttf'), { family: 'Inter', weight: [100, 900], style: 'normal' })
  assert.deepEqual(guessFont('Recursive[wght].woff2'), { family: 'Recursive', weight: [100, 900], style: 'normal' })
  assert.deepEqual(guessFont('Sohne-SemiBold.woff2'), { family: 'Sohne', weight: 600, style: 'normal' })
  assert.deepEqual(guessFont('GT America 500 Italic.woff'), { family: 'GT America', weight: 500, style: 'italic' })
  assert.deepEqual(guessFont('Lato-Regular-webfont.woff'), { family: 'Lato', weight: 400, style: 'normal' })
  assert.deepEqual(guessFont('bold.woff2'), { family: 'Ma police', weight: 700, style: 'normal' })
})

test('famille et graisse saisies : vérifiées', () => {
  for (const ok of ['Maison Neue', 'GT-America', 'Söhne', 'Police 2']) assert.ok(isFontFamily(ok), ok)
  for (const bad of ['', ' ', 'a"b', 'x;}body{display:none', 'serif', 'Sans-Serif', 'x'.repeat(61), 'a\nb', 3]) assert.ok(!isFontFamily(bad), String(bad))
  assert.equal(parseFontWeight(400), 400)
  assert.deepEqual(parseFontWeight([100, 900]), [100, 900])
  for (const bad of [0, 1001, 400.5, '400', [900, 100], [400], null]) assert.equal(parseFontWeight(bad), null, JSON.stringify(bad))
  assert.deepEqual(customFamilies(custom).map(f => [f.family, f.files.length]), [['Maison Neue', 2], ['Titre', 1]])
})

test('typographie reçue : nettoyée, polices inconnues et valeurs hors bornes refusées', () => {
  assert.deepEqual(parseTypography(undefined, []), { body: 'site', heading: 'site', scale: 'site', levels: {} })
  const parsed = parseTypography({ body: 'inter', heading: 'custom:Titre', scale: 'ample', inconnu: 1, levels: { h1: { weight: 800.4, size: 3.5, lineHeight: 1.05, letterSpacing: -0.02, autre: 1 }, h2: {}, body: { size: 1.0625, font: 'lora' }, h9: { size: 2 } } }, ['Titre'])
  assert.deepEqual(parsed, { body: 'inter', heading: 'custom:Titre', scale: 'ample', levels: { body: { size: 1.063 }, h1: { weight: 800, size: 3.5, lineHeight: 1.05, letterSpacing: -0.02 } } })
  assert.equal(parseTypography({ body: 'comic-sans' }, []), 'Police du texte inconnue.')
  assert.equal(parseTypography({ heading: 'custom:Titre' }, []), 'Police des titres inconnue.')
  assert.equal(parseTypography({ scale: 'géante' }, []), 'Échelle des titres inconnue.')
  assert.match(parseTypography({ levels: { h1: { size: 40 } } }, []) as string, /Titre principal \(H1\) : taille entre 0,875 et 6/)
  assert.match(parseTypography({ levels: { body: { size: 3 } } }, []) as string, /Texte courant : taille/)
  assert.match(parseTypography({ levels: { h2: { weight: '700' } } }, []) as string, /graisse/)
  assert.match(parseTypography({ levels: { h3: { font: 'custom:Absente' } } }, []) as string, /Sous-titre \(H3\) : police inconnue/)
  assert.equal(parseTypography('inter', []), 'Typographie invalide.')
  assert.ok(isDefaultTypography(null) && isDefaultTypography({ body: 'site', heading: 'site', scale: 'site', levels: { h1: {} } }) && !isDefaultTypography({ body: 'site', heading: 'site', scale: 'compact', levels: {} }))
  assert.equal(fontLabel('inter'), 'Inter')
  assert.equal(fontLabel('custom:Maison Neue'), 'Maison Neue')
})

test('taille qui suit la largeur de l\'écran', () => {
  assert.equal(fluidSize(2, 3), 'clamp(2rem,1.571rem + 1.905vw,3rem)')
  assert.equal(fluidSize(1.5, 1.5), '1.5rem')
})

test('feuille de style : rien sans réglage ; police proposée, variables, préchargement', () => {
  assert.deepEqual(typographyCss(undefined), { css: '', preload: [] })
  assert.deepEqual(typographyCss({ body: 'site', heading: 'site', scale: 'site', levels: {} }), { css: '', preload: [] })
  const { css, preload } = typographyCss({ body: 'inter', heading: 'site', scale: 'site', levels: {} })
  assert.deepEqual(preload, ['/_cms/fonts/inter/inter-latin-wght-normal.woff2'])
  // Quatre fichiers annoncés (latin et latin étendu, droit et italique) ; le navigateur ne télécharge que ceux qu'il lui faut.
  assert.equal(css.split('@font-face').length - 1, 4)
  assert.ok(css.includes('@font-face{font-family:"Inter";font-style:normal;font-weight:100 900;font-display:swap;src:url("/_cms/fonts/inter/inter-latin-wght-normal.woff2") format("woff2");unicode-range:U+0000-00FF'), css.slice(0, 300))
  assert.ok(css.includes('html:root{--cms-font-body:"Inter",ui-sans-serif,system-ui'))
  assert.ok(css.endsWith('html:root body{font-family:var(--cms-font-body)}'), css.slice(-120))
  assert.ok(!css.includes('h1'))
  // Police du système : aucun fichier.
  const system = typographyCss({ body: 'system-serif', heading: 'site', scale: 'site', levels: {} })
  assert.ok(!system.css.includes('@font-face') && system.css.includes('--cms-font-body:ui-serif,Georgia') && !system.preload.length)
})

test('feuille de style : titres, échelle, réglages fins, police envoyée', () => {
  const { css, preload } = typographyCss({
    body: 'custom:Maison Neue', heading: 'custom:Titre', scale: 'normal',
    levels: { body: { size: 1.0625, lineHeight: 1.7 }, h1: { weight: 800, letterSpacing: -0.02 }, h2: { size: 1.25 }, h3: { font: 'oswald', size: 2.5 } },
  }, custom)
  assert.deepEqual(preload, ['/media/a/maison-regular.woff2'])
  assert.ok(css.includes('@font-face{font-family:"Maison Neue";font-style:italic;font-weight:700;font-display:swap;src:url("/media/b/maison-bolditalic.ttf") format("truetype")}'))
  assert.ok(css.includes('@font-face{font-family:"Titre";font-style:normal;font-weight:200 900;'))
  assert.ok(css.includes('html:root body{font-family:var(--cms-font-body);font-size:1.063rem;line-height:1.7}'))
  assert.ok(css.includes('html:root :is(h1,h2,h3,h4,h5,h6):not(.cms-type-off){font-family:var(--cms-font-heading)}'))
  assert.ok(css.includes('html:root h1:not(.cms-type-off){font-weight:800;font-size:clamp(2rem,1.571rem + 1.905vw,3rem);letter-spacing:-0.02em}'))
  // Une taille réglée à la main l'emporte sur l'échelle ; petite, elle est fixe ; grande, elle se réduit sur téléphone.
  assert.ok(css.includes('html:root h2:not(.cms-type-off){font-size:1.25rem}'))
  assert.ok(css.includes('html:root h3:not(.cms-type-off){font-family:"Oswald",ui-sans-serif') && css.includes('font-size:clamp(1.75rem,'))
  assert.ok(css.includes('html:root h4:not(.cms-type-off){font-size:clamp(1.125rem,'))
  assert.ok(css.includes('oswald-latin-wght-normal.woff2') && !css.includes('oswald-latin-wght-italic'))
  // Dans l'aperçu du back-office, les mêmes règles s'appliquent au seul bloc d'aperçu.
  const preview = typographyCss({ body: 'lora', heading: 'site', scale: 'compact', levels: {} }, [], { root: '.x', text: '.x' }).css
  assert.ok(preview.includes('.x{font-family:var(--cms-font-body)}') && preview.includes('.x h1:not(.cms-type-off){') && !preview.includes('html:root'))
})

test('police envoyée puis supprimée : police du système, pas un nom qui ne mène à rien', () => {
  const { css, preload } = typographyCss({ body: 'custom:Disparue', heading: 'site', scale: 'site', levels: {} }, custom)
  assert.ok(!css.includes('Disparue') && css.includes('--cms-font-body:ui-sans-serif') && !preload.length)
})

test('thème : typographie gardée, absente quand elle ne règle rien, thème d\'avant inchangé', () => {
  const before = parseTheme({ ...DEFAULT_THEME })
  assert.deepEqual(before, DEFAULT_THEME)
  assert.ok(!('typography' in (parseTheme({ ...DEFAULT_THEME, typography: { body: 'site', heading: 'site', scale: 'site', levels: {} } }) as object)))
  const themed = parseTheme({ ...DEFAULT_THEME, typography: { body: 'inter', heading: 'custom:Titre' } }, ['Titre'])
  assert.deepEqual((themed as { typography: unknown }).typography, { body: 'inter', heading: 'custom:Titre', scale: 'site', levels: {} })
  assert.equal(parseTheme({ ...DEFAULT_THEME, typography: { body: 'custom:Titre' } }), 'Police du texte inconnue.')
  // La feuille de style d'un thème sans typographie est celle d'avant, au caractère près.
  assert.ok(themeCss(DEFAULT_THEME).endsWith('}') && !themeCss(DEFAULT_THEME).includes('font'))
  assert.ok(themeCss({ ...DEFAULT_THEME, typography: { body: 'inter', heading: 'site', scale: 'site', levels: {} } }).includes('@font-face'))
})
