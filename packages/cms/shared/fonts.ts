/**
 * Typographie du site : les polices proposées, celles qu'on envoie, et la feuille de style qui en découle.
 * Logique pure, partagée par l'écran Apparence (aperçu), le serveur (validation) et le site (styles appliqués).
 *
 * Deux niveaux de réglage :
 * - simple : une police pour le texte, une pour les titres, et une échelle de tailles pour les titres ;
 * - fin : pour le texte courant et chaque niveau de titre (H1 à H4), police, graisse, taille, interligne, espacement.
 * Tout est facultatif : ce qui n'est pas réglé reste décidé par le code du site, et un thème sans typographie
 * n'ajoute aucune règle.
 *
 * Les polices proposées sont des polices libres (licence SIL Open Font), dont les fichiers voyagent avec le core
 * (dossier `fonts/`) et sont servis par le site lui-même, sous `/_cms/fonts/` : aucune requête ne part vers un
 * service tiers, l'adresse des visiteurs n'est transmise à personne. Seules les polices choisies sont chargées.
 */

// ───────────────────────── Polices proposées ─────────────────────────

export type FontCategory = 'sans' | 'serif' | 'display' | 'mono'
export const FONT_CATEGORIES: Record<FontCategory, string> = { sans: 'Sans empattement', serif: 'Avec empattement', display: 'De caractère', mono: 'À chasse fixe' }

/** Une police proposée : une police variable (toutes les graisses de `weights` dans un seul fichier). */
export type BuiltinFont = { id: string; family: string; category: FontCategory; weights: [number, number]; italic: boolean }

export const BUILTIN_FONTS: BuiltinFont[] = [
  { id: 'inter', family: 'Inter', category: 'sans', weights: [100, 900], italic: true },
  { id: 'dm-sans', family: 'DM Sans', category: 'sans', weights: [100, 1000], italic: true },
  { id: 'figtree', family: 'Figtree', category: 'sans', weights: [300, 900], italic: true },
  { id: 'manrope', family: 'Manrope', category: 'sans', weights: [200, 800], italic: false },
  { id: 'montserrat', family: 'Montserrat', category: 'sans', weights: [100, 900], italic: true },
  { id: 'nunito', family: 'Nunito', category: 'sans', weights: [200, 1000], italic: true },
  { id: 'open-sans', family: 'Open Sans', category: 'sans', weights: [300, 800], italic: true },
  { id: 'outfit', family: 'Outfit', category: 'sans', weights: [100, 900], italic: false },
  { id: 'plus-jakarta-sans', family: 'Plus Jakarta Sans', category: 'sans', weights: [200, 800], italic: true },
  { id: 'raleway', family: 'Raleway', category: 'sans', weights: [100, 900], italic: true },
  { id: 'work-sans', family: 'Work Sans', category: 'sans', weights: [100, 900], italic: true },
  { id: 'crimson-pro', family: 'Crimson Pro', category: 'serif', weights: [200, 900], italic: true },
  { id: 'eb-garamond', family: 'EB Garamond', category: 'serif', weights: [400, 800], italic: true },
  { id: 'lora', family: 'Lora', category: 'serif', weights: [400, 700], italic: true },
  { id: 'source-serif-4', family: 'Source Serif 4', category: 'serif', weights: [200, 900], italic: true },
  { id: 'bricolage-grotesque', family: 'Bricolage Grotesque', category: 'display', weights: [200, 800], italic: false },
  { id: 'fraunces', family: 'Fraunces', category: 'display', weights: [100, 900], italic: true },
  { id: 'oswald', family: 'Oswald', category: 'display', weights: [200, 700], italic: false },
  { id: 'playfair-display', family: 'Playfair Display', category: 'display', weights: [400, 900], italic: true },
  { id: 'space-grotesk', family: 'Space Grotesk', category: 'display', weights: [300, 700], italic: false },
  { id: 'jetbrains-mono', family: 'JetBrains Mono', category: 'mono', weights: [100, 800], italic: true },
]

/** Polices déjà présentes sur l'appareil du visiteur : rien à télécharger. */
export const SYSTEM_FONTS: Record<string, { label: string; stack: string }> = {
  'system-sans': { label: 'Police du système (sans empattement)', stack: 'ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif' },
  'system-serif': { label: 'Police du système (avec empattement)', stack: 'ui-serif,Georgia,Cambria,"Times New Roman",Times,serif' },
  'system-mono': { label: 'Police du système (chasse fixe)', stack: 'ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace' },
}

/** Polices de repli, selon la famille : celles qui s'affichent pendant le chargement, ou si le fichier manque. */
const FALLBACK: Record<FontCategory, string> = { sans: SYSTEM_FONTS['system-sans']!.stack, serif: SYSTEM_FONTS['system-serif']!.stack, display: SYSTEM_FONTS['system-sans']!.stack, mono: SYSTEM_FONTS['system-mono']!.stack }

/** Où le site sert les polices proposées (voir module.ts). */
export const BUILTIN_FONTS_URL = '/_cms/fonts'

/** Parties d'une police proposée : alphabet latin courant, puis lettres accentuées plus rares (langues d'Europe centrale…). Le navigateur ne télécharge que celles dont la page a besoin. */
const SUBSETS = [
  { id: 'latin', range: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD' },
  { id: 'latin-ext', range: 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF' },
] as const

const builtinFile = (font: BuiltinFont, subset: string, style: 'normal' | 'italic') => `${BUILTIN_FONTS_URL}/${font.id}/${font.id}-${subset}-wght-${style}.woff2`

// ───────────────────────── Polices envoyées ─────────────────────────

export const FONT_FORMATS = {
  woff2: { mime: 'font/woff2', css: 'woff2' },
  woff: { mime: 'font/woff', css: 'woff' },
  ttf: { mime: 'font/ttf', css: 'truetype' },
  otf: { mime: 'font/otf', css: 'opentype' },
} as const
export type FontFormat = keyof typeof FONT_FORMATS
/** Poids maximal d'un fichier de police envoyé. Un fichier WOFF2 pèse 20 à 150 Ko ; au-delà de 2 Mo, ce n'est pas une police pour le web. */
export const FONT_MAX_SIZE = 2 * 1024 * 1024
/** Nombre maximal de fichiers de police envoyés sur un site. */
export const FONT_MAX_FILES = 40

/**
 * Un fichier de police envoyé depuis l'écran Apparence. Une famille (« Maison Neue ») regroupe plusieurs fichiers :
 * un par graisse et par style, ou un seul fichier variable qui couvre une étendue de graisses.
 */
export type CustomFont = {
  /** Identifiant du fichier dans le stockage du site, et son adresse. */
  id: string
  url: string
  /** Nom du fichier envoyé, et son poids. */
  name: string
  size: number
  format: FontFormat
  family: string
  /** Graisse (400, 700…), ou étendue d'une police variable ([100, 900]). */
  weight: number | [number, number]
  style: 'normal' | 'italic'
}

const FAMILY = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,59}$/u
/** Nom de famille acceptable : lettres, chiffres, espaces et quelques signes, 60 caractères au plus (il est écrit dans une feuille de style). */
export const isFontFamily = (value: unknown): value is string => typeof value === 'string' && FAMILY.test(value.trim()) && !isGenericFamily(value)
const isGenericFamily = (value: string) => /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|inherit|initial|unset)$/i.test(value.trim())

/** Format d'un fichier de police d'après ses premiers octets, ou null si ce n'en est pas un. L'extension ne fait pas foi. */
export function fontFormatOf(bytes: Uint8Array): FontFormat | null {
  if (bytes.length < 12) return null
  const tag = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!)
  if (tag === 'wOF2') return 'woff2'
  if (tag === 'wOFF') return 'woff'
  if (tag === 'OTTO') return 'otf'
  if (tag === 'true' || (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0)) return 'ttf'
  return null
}

const WEIGHT_WORDS: [RegExp, number][] = [
  [/^(extra|ultra)light$/, 200], [/^(semi|demi)bold$/, 600], [/^(extra|ultra)bold$/, 800],
  [/^(thin|hairline)$/, 100], [/^light$/, 300], [/^(regular|normal|book|roman)$/, 400], [/^medium$/, 500], [/^bold$/, 700], [/^(black|heavy)$/, 900],
]

/**
 * Ce qu'un nom de fichier laisse deviner d'une police : « OpenSans-BoldItalic.woff2 » → Open Sans, 700, italique ;
 * « Inter-VariableFont_wght.ttf » → Inter, variable. Une proposition, que la personne corrige dans l'écran.
 */
export function guessFont(filename: string): Pick<CustomFont, 'family' | 'weight' | 'style'> {
  const base = filename.replace(/\.[a-z0-9]+$/i, '')
  // « BoldItalic », « OpenSans » : les mots collés sont séparés avant d'être lus.
  const words = base.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\[[^\]]*\]/g, ' variable ').split(/[\s_\-.,]+/).filter(Boolean)
  let weight: CustomFont['weight'] = 400
  let style: CustomFont['style'] = 'normal'
  const kept: string[] = []
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!.toLowerCase()
    // « Extra Bold », « Semi Bold » écrits en deux mots.
    const pair = /^(extra|ultra|semi|demi)$/.test(word) && /^(light|bold)$/i.test(words[i + 1] ?? '') ? word + words[i + 1]!.toLowerCase() : null
    const named = WEIGHT_WORDS.find(([pattern]) => pattern.test(pair ?? word))
    if (named) { if (!Array.isArray(weight)) weight = named[1]; if (pair) i++; continue }
    if (/^(italic|oblique|ital)$/.test(word)) { style = 'italic'; continue }
    if (/^(variable|var|vf|wght|variablefont|font)$/.test(word)) { if (word !== 'font') weight = [100, 900]; continue }
    if (/^[1-9]00$/.test(word)) { if (!Array.isArray(weight)) weight = Number(word); continue }
    if (/^(webfont|web|subset|latin)$/.test(word)) continue
    kept.push(words[i]!)
  }
  const family = kept.join(' ').trim().slice(0, 60)
  return { family: isFontFamily(family) ? family : 'Ma police', weight, style }
}

/** Graisse reçue de l'écran : un nombre de 100 à 1000, ou une étendue croissante. Null si elle est mal formée. */
export function parseFontWeight(value: unknown): CustomFont['weight'] | null {
  const ok = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 1000
  if (ok(value)) return value
  if (Array.isArray(value) && value.length === 2 && ok(value[0]) && ok(value[1]) && value[0] < value[1]) return [value[0], value[1]]
  return null
}

/** Familles envoyées, avec leurs fichiers, dans l'ordre alphabétique. */
export function customFamilies(fonts: CustomFont[]): { family: string; files: CustomFont[] }[] {
  const out = new Map<string, CustomFont[]>()
  for (const font of fonts) out.set(font.family, [...(out.get(font.family) ?? []), font])
  return [...out].map(([family, files]) => ({ family, files })).sort((a, b) => a.family.localeCompare(b.family, 'fr'))
}

// ───────────────────────── Réglages ─────────────────────────

/**
 * Choix d'une police : `site` (celle que prévoit le code du site, rien n'est changé), une police du système
 * (`system-sans`…), l'identifiant d'une police proposée (`inter`), ou `custom:Nom de la famille` pour une police envoyée.
 */
export type FontChoice = string
export const SITE_FONT = 'site'
export const customChoice = (family: string): FontChoice => `custom:${family}`

export const TYPE_LEVELS = ['body', 'h1', 'h2', 'h3', 'h4'] as const
export type TypeLevel = typeof TYPE_LEVELS[number]
export const TYPE_LEVEL_LABELS: Record<TypeLevel, string> = { body: 'Texte courant', h1: 'Titre principal (H1)', h2: 'Titre de section (H2)', h3: 'Sous-titre (H3)', h4: 'Intertitre (H4)' }

/** Réglage fin d'un niveau. Une propriété absente n'est pas touchée. */
export type LevelStyle = {
  /** Police propre à ce niveau (titres seulement) ; absente : celle des titres. */
  font?: FontChoice
  weight?: number
  /** Taille en rem (1 rem = 16 px sur la plupart des appareils). */
  size?: number
  /** Interligne, en proportion de la taille (1,5 = une fois et demie). */
  lineHeight?: number
  /** Espacement des lettres, en em (0,02 = 2 % de la taille ; négatif pour resserrer). */
  letterSpacing?: number
}

export const TYPE_SCALES = {
  site: { label: 'Celles du site', help: 'Les tailles prévues par le code du site.' },
  compact: { label: 'Compacte', help: 'Des titres discrets : pour un site dense, beaucoup de texte.' },
  normal: { label: 'Normale', help: 'Des titres bien marqués.' },
  ample: { label: 'Ample', help: 'De grands titres, pour un site aéré.' },
} as const
export type TypeScale = keyof typeof TYPE_SCALES

/**
 * Tailles des titres de chaque échelle, en rem : sur un téléphone, puis sur un grand écran. Entre les deux, la taille
 * suit la largeur de l'écran (voir `fluidSize`) : un grand titre ne déborde pas d'un petit écran.
 */
const SCALE_SIZES: Record<Exclude<TypeScale, 'site'>, Record<Exclude<TypeLevel, 'body'>, [number, number]>> = {
  compact: { h1: [1.75, 2.25], h2: [1.375, 1.75], h3: [1.2, 1.375], h4: [1.0625, 1.125] },
  normal: { h1: [2, 3], h2: [1.625, 2.125], h3: [1.375, 1.625], h4: [1.125, 1.25] },
  ample: { h1: [2.5, 4], h2: [2, 2.75], h3: [1.5, 2], h4: [1.25, 1.5] },
}

export type Typography = {
  /** Police du texte, et police des titres (`site` : celle du texte, ou celle que prévoit le site). */
  body: FontChoice
  heading: FontChoice
  scale: TypeScale
  levels: Partial<Record<TypeLevel, LevelStyle>>
}

export const DEFAULT_TYPOGRAPHY: Typography = { body: SITE_FONT, heading: SITE_FONT, scale: 'site', levels: {} }

/** Bornes des réglages fins : au-delà, le texte devient illisible ou la page se casse. */
export const TYPE_LIMITS = {
  weight: [100, 1000], bodySize: [0.8, 1.375], headingSize: [0.875, 6], lineHeight: [0.9, 2.2], letterSpacing: [-0.08, 0.3],
} as const

/** Vrai si la typographie ne change rien au site (aucune règle à écrire). */
export const isDefaultTypography = (t: Typography | null | undefined) =>
  !t || (t.body === SITE_FONT && t.heading === SITE_FONT && t.scale === 'site' && !Object.values(t.levels ?? {}).some(l => l && Object.keys(l).length))

/** Le choix désigne-t-il une police qui existe ? `families` : noms des familles envoyées. */
export function isKnownChoice(choice: unknown, families: string[]): choice is FontChoice {
  if (typeof choice !== 'string') return false
  if (choice === SITE_FONT || choice in SYSTEM_FONTS || BUILTIN_FONTS.some(f => f.id === choice)) return true
  return choice.startsWith('custom:') && families.includes(choice.slice(7))
}

/** Nom lisible d'un choix de police. */
export function fontLabel(choice: FontChoice): string {
  if (choice === SITE_FONT) return 'Police du site'
  if (choice in SYSTEM_FONTS) return SYSTEM_FONTS[choice]!.label
  return BUILTIN_FONTS.find(f => f.id === choice)?.family ?? choice.replace(/^custom:/, '')
}

const between = (value: unknown, [min, max]: readonly [number, number]) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max

/**
 * Vérifie une typographie reçue de l'écran. Renvoie la typographie nettoyée (propriétés inconnues retirées), ou un
 * message d'erreur. `families` : noms des familles envoyées sur ce site.
 */
export function parseTypography(input: unknown, families: string[]): Typography | string {
  if (input == null) return { ...DEFAULT_TYPOGRAPHY, levels: {} }
  if (typeof input !== 'object' || Array.isArray(input)) return 'Typographie invalide.'
  const raw = input as Record<string, unknown>
  const body = raw.body ?? SITE_FONT, heading = raw.heading ?? SITE_FONT, scale = raw.scale ?? 'site'
  if (!isKnownChoice(body, families)) return 'Police du texte inconnue.'
  if (!isKnownChoice(heading, families)) return 'Police des titres inconnue.'
  if (typeof scale !== 'string' || !(scale in TYPE_SCALES)) return 'Échelle des titres inconnue.'
  const levels: Typography['levels'] = {}
  const given = raw.levels && typeof raw.levels === 'object' && !Array.isArray(raw.levels) ? raw.levels as Record<string, unknown> : {}
  for (const level of TYPE_LEVELS) {
    const style = given[level]
    if (style == null) continue
    if (typeof style !== 'object' || Array.isArray(style)) return `${TYPE_LEVEL_LABELS[level]} : réglage invalide.`
    const s = style as Record<string, unknown>
    const out: LevelStyle = {}
    if (s.font != null && s.font !== SITE_FONT && level !== 'body') {
      if (!isKnownChoice(s.font, families)) return `${TYPE_LEVEL_LABELS[level]} : police inconnue.`
      out.font = s.font
    }
    const number = (key: 'weight' | 'size' | 'lineHeight' | 'letterSpacing', range: readonly [number, number], what: string) => {
      if (s[key] == null || s[key] === '') return null
      if (!between(s[key], range)) return `${TYPE_LEVEL_LABELS[level]} : ${what} entre ${String(range[0]).replace('.', ',')} et ${String(range[1]).replace('.', ',')}.`
      out[key] = Math.round((s[key] as number) * 1000) / 1000
      return null
    }
    const error = number('weight', TYPE_LIMITS.weight, 'graisse')
      ?? number('size', level === 'body' ? TYPE_LIMITS.bodySize : TYPE_LIMITS.headingSize, 'taille')
      ?? number('lineHeight', TYPE_LIMITS.lineHeight, 'interligne')
      ?? number('letterSpacing', TYPE_LIMITS.letterSpacing, 'espacement')
    if (error) return error
    if (out.weight !== undefined) out.weight = Math.round(out.weight)
    if (Object.keys(out).length) levels[level] = out
  }
  return { body, heading, scale: scale as TypeScale, levels }
}

// ───────────────────────── Feuille de style ─────────────────────────

const round = (n: number) => String(Math.round(n * 1000) / 1000)

/**
 * Taille qui suit la largeur de l'écran : `min` rem sur un téléphone (360 px), `max` rem à partir de 1200 px, et une
 * progression régulière entre les deux. Le navigateur ne descend ni ne monte au-delà.
 */
export function fluidSize(min: number, max: number): string {
  if (max - min < 0.01) return `${round(max)}rem`
  const slope = (max - min) / (75 - 22.5)
  return `clamp(${round(min)}rem,${round(min - slope * 22.5)}rem + ${round(slope * 100)}vw,${round(max)}rem)`
}

/** Taille d'un titre réglée à la main : au-delà de 1,5 rem, elle se réduit sur les petits écrans (jusqu'à 70 %). */
const customSize = (size: number) => (size <= 1.5 ? `${round(size)}rem` : fluidSize(Math.max(1.5, size * 0.7), size))

type Face = { family: string; src: string; weight: string; style: string; range?: string }

/** Les fichiers d'un choix de police, et la liste de polices (avec replis) à écrire dans `font-family`. */
function resolveFont(choice: FontChoice, custom: CustomFont[]): { stack: string; faces: Face[]; preload: string | null } | null {
  if (choice === SITE_FONT) return null
  if (choice in SYSTEM_FONTS) return { stack: SYSTEM_FONTS[choice]!.stack, faces: [], preload: null }
  const builtin = BUILTIN_FONTS.find(f => f.id === choice)
  if (builtin) {
    const faces = (['normal', ...(builtin.italic ? ['italic'] : [])] as ('normal' | 'italic')[]).flatMap(style => SUBSETS.map(subset => ({
      family: builtin.family, src: `url("${builtinFile(builtin, subset.id, style)}") format("woff2")`, weight: builtin.weights.join(' '), style, range: subset.range,
    })))
    return { stack: `"${builtin.family}",${FALLBACK[builtin.category]}`, faces, preload: builtinFile(builtin, 'latin', 'normal') }
  }
  const family = choice.replace(/^custom:/, '')
  const files = custom.filter(f => f.family === family && isFontFamily(f.family))
  // Famille dont tous les fichiers ont été supprimés depuis : la police du système, plutôt qu'un nom qui ne mène à rien.
  if (!files.length) return { stack: FALLBACK.sans, faces: [], preload: null }
  const faces = files.map(f => ({
    family, src: `url("${f.url.replace(/["\\\n]/g, '')}") format("${FONT_FORMATS[f.format].css}")`, weight: Array.isArray(f.weight) ? f.weight.join(' ') : String(f.weight), style: f.style,
  }))
  // À précharger : le fichier du texte ordinaire (droit, la graisse la plus proche de 400).
  const distance = (f: CustomFont) => (Array.isArray(f.weight) ? (f.weight[0] <= 400 && f.weight[1] >= 400 ? 0 : Math.min(Math.abs(f.weight[0] - 400), Math.abs(f.weight[1] - 400))) : Math.abs(f.weight - 400)) + (f.style === 'normal' ? 0 : 1000)
  const regular = [...files].sort((a, b) => distance(a) - distance(b))[0]!
  return { stack: `"${family}",${FALLBACK.sans}`, faces, preload: regular.format === 'woff2' ? regular.url : null }
}

const faceCss = (face: Face) =>
  `@font-face{font-family:"${face.family}";font-style:${face.style};font-weight:${face.weight};font-display:swap;src:${face.src}${face.range ? `;unicode-range:${face.range}` : ''}}`

export type TypographyOutput = {
  /** Règles `@font-face` des polices utilisées, puis règles qui les appliquent. Vide si rien n'est réglé. */
  css: string
  /** Fichiers à précharger : celui du texte courant, pour qu'il s'affiche sans à-coup. */
  preload: string[]
}

/**
 * La feuille de style d'une typographie.
 * - `root` : ce à quoi elle s'applique. Sur le site, `html:root` : les règles l'emportent alors sur les classes
 *   utilitaires du site (`text-3xl`), puisque c'est le back-office qui décide. Dans l'aperçu du back-office, le bloc d'aperçu.
 * - `text` : l'élément qui porte le texte courant (`html:root body` sur le site).
 * Un titre marqué de la classe `cms-type-off` garde le style prévu par le code du site.
 * Les variables `--cms-font-body` et `--cms-font-heading` sont posées pour le code du site qui voudrait s'en servir.
 */
export function typographyCss(typography: Typography | null | undefined, custom: CustomFont[] = [], target: { root: string; text: string } = { root: 'html:root', text: 'html:root body' }): TypographyOutput {
  if (isDefaultTypography(typography)) return { css: '', preload: [] }
  const t = typography!
  const faces = new Map<string, Face>()
  const use = (choice: FontChoice | undefined) => {
    const font = choice ? resolveFont(choice, custom) : null
    for (const face of font?.faces ?? []) faces.set(`${face.family}|${face.style}|${face.weight}|${face.src}`, face)
    return font
  }
  const rules: string[] = []
  const heading = (level: string) => `${target.root} ${level}:not(.cms-type-off)`
  const declare = (style: LevelStyle | undefined, size: string | null) => [
    style?.weight !== undefined ? `font-weight:${style.weight}` : '',
    size ? `font-size:${size}` : '',
    style?.lineHeight !== undefined ? `line-height:${round(style.lineHeight)}` : '',
    style?.letterSpacing !== undefined ? `letter-spacing:${round(style.letterSpacing)}em` : '',
  ].filter(Boolean)

  const body = use(t.body)
  const headings = use(t.heading)
  const vars = [body ? `--cms-font-body:${body.stack}` : '', headings ? `--cms-font-heading:${headings.stack}` : ''].filter(Boolean)
  if (vars.length) rules.push(`${target.root}{${vars.join(';')}}`)
  const text = [body ? 'font-family:var(--cms-font-body)' : '', ...declare(t.levels.body, t.levels.body?.size !== undefined ? `${round(t.levels.body.size)}rem` : null)].filter(Boolean)
  if (text.length) rules.push(`${target.text}{${text.join(';')}}`)
  if (headings) rules.push(`${heading(':is(h1,h2,h3,h4,h5,h6)')}{font-family:var(--cms-font-heading)}`)
  for (const level of ['h1', 'h2', 'h3', 'h4'] as const) {
    const style = t.levels[level]
    const own = use(style?.font)
    const preset = t.scale === 'site' ? null : SCALE_SIZES[t.scale][level]
    const size = style?.size !== undefined ? customSize(style.size) : preset ? fluidSize(...preset) : null
    const declarations = [own ? `font-family:${own.stack}` : '', ...declare(style, size)].filter(Boolean)
    if (declarations.length) rules.push(`${heading(level)}{${declarations.join(';')}}`)
  }
  return { css: [...[...faces.values()].map(faceCss), ...rules].join(''), preload: body?.preload ? [body.preload] : [] }
}
