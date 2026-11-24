/**
 * Référencement assisté : logique pure, partagée par le formulaire (aperçus et conseils pendant la saisie),
 * par la vue d'ensemble du back-office (serveur) et par `useCmsSeo` (titre de la page sur le site).
 *
 * Tout ce qui est un seuil est regroupé dans `SEO_LIMITS`, avec sa justification : c'est le seul endroit à modifier
 * pour ajuster un conseil. Aucun de ces seuils n'est une règle de Google : ce sont des repères d'affichage (à partir
 * d'où un texte est coupé, une image recadrée) ou, quand c'est dit, de simples appréciations.
 */
import { type AnyField, isVisible } from './format'

type Fields = Record<string, AnyField>
type Values = Record<string, unknown>

// ───────────────────────── Seuils ─────────────────────────

export const SEO_LIMITS = {
  /**
   * Largeur (en pixels) au-delà de laquelle Google coupe un titre dans ses résultats sur ordinateur.
   * Le titre y est écrit en Arial 20 px dans une colonne de 600 px ; la coupe arrive vers 580 px, soit 55 à 65
   * caractères selon les lettres (« i » est quatre fois plus étroit que « W »). D'où une mesure en largeur
   * plutôt qu'en nombre de caractères.
   */
  titleMaxPx: 580,
  /** Taille du titre dans les résultats de Google (Arial 20 px), pour la mesure ci-dessus. */
  titleFontPx: 20,
  /**
   * Titre très court (caractères, suffixe du site compris). Appréciation, pas une règle : en dessous, le titre se
   * réduit en général à un mot (« Accueil », « Contact ») qui ne dit ni le sujet ni le site.
   */
  titleMinChars: 15,
  /**
   * Longueur (caractères) au-delà de laquelle Google coupe la description sur ordinateur : deux lignes de 14 px
   * dans la même colonne, soit 155 à 160 caractères.
   */
  descriptionMaxChars: 160,
  /** Même coupe sur téléphone (écran plus étroit) : environ 120 caractères. Sert à l'aperçu « téléphone ». */
  descriptionMobileChars: 120,
  /**
   * Description très courte (caractères). Appréciation : en dessous d'une phrase, elle ne donne aucune raison
   * de cliquer, et Google la remplace souvent par un extrait de la page.
   */
  descriptionMinChars: 50,
  /**
   * Image de partage : taille minimale pour une grande carte. En dessous de 600 × 315 px, Facebook et LinkedIn
   * l'affichent en petite vignette, ou pas du tout (documentation de Facebook sur les images de partage).
   */
  imageMinWidth: 600,
  imageMinHeight: 315,
  /** Taille conseillée par ces mêmes plateformes, citée dans le conseil. */
  imageIdealWidth: 1200,
  imageIdealHeight: 630,
  /**
   * Proportions d'une carte de partage : 1,91 de large pour 1 de haut. L'image est recadrée pour y entrer ; le
   * conseil n'apparaît que si le recadrage enlève plus d'un quart de l'image (`imageCropTolerance`) : une photo
   * 3:2 ou 16:9 passe, une image carrée ou en hauteur est signalée.
   */
  imageRatio: 1.91,
  imageCropTolerance: 0.25,
  /** Types de fichiers que les cartes de partage savent afficher. Un SVG, par exemple, n'apparaît pas. */
  imageMimes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  /**
   * Adresse de la page (la partie propre à la page, après le dernier « / ») : longue au-delà de 60 caractères.
   * Appréciation : Google n'impose rien, mais une adresse longue est coupée dans les résultats et se recopie mal.
   */
  slugMaxChars: 60,
  /**
   * Texte très court (nombre de mots de tous les textes du contenu). Appréciation : moins qu'un court paragraphe.
   * Vérifié seulement si le contenu a un champ de texte mis en forme, c'est-à-dire un texte principal.
   */
  bodyMinWords: 50,
  /**
   * Texte long sans intertitre (mots). Appréciation : au-delà de quelques paragraphes, des titres de section (H2, H3)
   * aident le lecteur à s'y retrouver et Google à comprendre de quoi parle chaque partie.
   */
  sectionWords: 300,
} as const

// ───────────────────────── Titre de la page ─────────────────────────

/** Réglages du site utiles au référencement (voir `site` dans `format.ts`). */
export type SeoSite = { name: string; url?: string; titleSuffix?: string; shareImage?: string }

const squash = (text: unknown) => (typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '')
/** Forme de comparaison : sans majuscules ni espaces en trop. Deux textes de même forme sont « identiques ». */
export const seoComparable = (text: unknown) => squash(text).toLocaleLowerCase('fr')

/**
 * Titre de la page tel que le site l'affiche (balise `<title>`) : le titre, suivi du suffixe du site.
 * - le suffixe n'est pas répété si le titre le contient déjà (« Cabinet Durand, avocats à Lyon ») ;
 * - sans titre, c'est le suffixe seul si `alone` (réglage `site.titleSuffix`), sinon rien : le site garde son titre par défaut.
 */
export function seoPageTitle(title: string | null | undefined, suffix?: string | null, alone = true): string | null {
  const own = squash(title)
  const end = squash(suffix)
  if (!own) return end && alone ? end : null
  if (!end || seoComparable(own).includes(seoComparable(end))) return own
  return `${own} — ${end}`
}

// ───────────────────────── Troncature, comme dans les résultats de recherche ─────────────────────────

/** Largeur des caractères en Arial, en millièmes de la taille du texte (métriques de la police). */
const ARIAL: Record<string, number> = {
  ' ': 278, '!': 278, '"': 355, '#': 556, '$': 556, '%': 889, '&': 667, '\'': 191, '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556, '@': 1015, '[': 278, '\\': 278, ']': 278, '^': 469, '_': 556, '`': 333, '{': 334, '|': 260, '}': 334, '~': 584,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  '’': 222, '‘': 222, '“': 333, '”': 333, '«': 556, '»': 556, '–': 556, '—': 1000, '…': 1000, '€': 556, '·': 278, '•': 350, ' ': 278, ' ': 200, 'œ': 944, 'Œ': 1000, 'æ': 889, 'Æ': 1000,
}

function charWidth(char: string): number {
  const known = ARIAL[char]
  if (known !== undefined) return known
  if (/\d/.test(char)) return 556
  // Lettre accentuée : la largeur de la lettre sans son accent.
  const base = char.normalize('NFD')[0]!
  if (base !== char && ARIAL[base] !== undefined) return ARIAL[base]!
  // Idéogrammes, émojis : un carré entier. Le reste : une lettre moyenne.
  return char.codePointAt(0)! > 0x2e7f ? 1000 : 556
}

/** Largeur approximative d'un texte écrit en Arial, en pixels. */
export function textWidth(text: string, fontPx: number): number {
  let total = 0
  for (const char of text) total += charWidth(char)
  return total * fontPx / 1000
}

export type Truncated = {
  /** Le texte tel qu'il est affiché : entier, ou coupé et suivi de « … ». */
  text: string
  cut: boolean
  /** Nombre de caractères du texte d'origine qui restent visibles (sa longueur s'il n'est pas coupé). */
  kept: number
}

/** Recule jusqu'à la fin d'un mot, comme le font les moteurs de recherche, et retire la ponctuation qui traîne. */
function cutAtWord(text: string, max: number): number {
  let end = max
  if (text[end] !== ' ' && text.lastIndexOf(' ', end) > 0) end = text.lastIndexOf(' ', end)
  while (end > 0 && /[\s,;:.\-–—·|]/.test(text[end - 1]!)) end--
  return end || max
}

/** Coupe un texte à une largeur donnée (titre d'un résultat de recherche). */
export function truncateToWidth(input: string, maxPx: number = SEO_LIMITS.titleMaxPx, fontPx: number = SEO_LIMITS.titleFontPx): Truncated {
  const text = squash(input)
  if (textWidth(text, fontPx) <= maxPx) return { text, cut: false, kept: text.length }
  const room = maxPx - textWidth(' …', fontPx)
  let width = 0
  let fit = 0
  for (const char of text) {
    width += charWidth(char) * fontPx / 1000
    if (width > room) break
    fit += char.length
  }
  const kept = cutAtWord(text, fit)
  return { text: text.slice(0, kept) + ' …', cut: true, kept }
}

/** Coupe un texte à un nombre de caractères (description d'un résultat de recherche). */
export function truncateToChars(input: string, max: number = SEO_LIMITS.descriptionMaxChars): Truncated {
  const text = squash(input)
  if (text.length <= max) return { text, cut: false, kept: text.length }
  const kept = cutAtWord(text, max - 2)
  return { text: text.slice(0, kept) + ' …', cut: true, kept }
}

// ───────────────────────── Ce que le site affichera, replis compris ─────────────────────────

export type SeoDef = { kind: string; label: string; path?: string; titleField?: string; fields: Fields }

export type SeoView = {
  /** Titre sans le suffixe du site : celui du référencement, sinon le titre du contenu. Vide s'il n'y en a pas. */
  baseTitle: string
  /** D'où vient ce titre : saisi dans l'onglet Référencement, repris du contenu, ou absent. */
  titleFrom: 'seo' | 'content' | 'none'
  /** Balise `<title>` de la page, suffixe compris ; null : le site garde son titre par défaut. */
  pageTitle: string | null
  description: string
  /** Titre de la carte de partage : celui du partage s'il est saisi, sinon le titre de la page. */
  shareTitle: string | null
  shareTitleOwn: boolean
  shareDescription: string
  shareDescriptionOwn: boolean
  /** Image de partage du contenu (identifiant de la médiathèque), ou null. */
  imageId: string | null
  /** Image par défaut du site, utilisée quand le contenu n'en a pas. */
  fallbackImage: string | null
  noindex: boolean
}

/**
 * Calcule ce que le site affichera pour un contenu, à partir de ses valeurs enregistrées (`shared` : champs communs
 * aux langues, `values` : champs de la langue). Mêmes replis que `toPublicEntry` (serveur) et `useCmsSeo` (site).
 */
export function seoView(def: SeoDef, shared: Values, values: Values, site: SeoSite): SeoView {
  const common = (shared.seo ?? {}) as Values
  const local = (values.seo ?? {}) as Values
  const own = squash(local.title)
  const fromContent = def.kind === 'collection' && def.titleField ? squash(({ ...shared, ...values })[def.titleField]) : ''
  const baseTitle = own || fromContent
  const pageTitle = seoPageTitle(baseTitle, site.titleSuffix)
  const description = squash(local.description)
  const shareTitle = squash(local.shareTitle)
  const shareDescription = squash(local.shareDescription)
  return {
    baseTitle,
    titleFrom: own ? 'seo' : fromContent ? 'content' : 'none',
    pageTitle,
    description,
    shareTitle: shareTitle || pageTitle,
    shareTitleOwn: !!shareTitle,
    shareDescription: shareDescription || description,
    shareDescriptionOwn: !!shareDescription,
    imageId: typeof common.image === 'string' && common.image ? common.image : null,
    fallbackImage: site.shareImage || null,
    noindex: !!common.noindex,
  }
}

/** Adresse de la page dans une langue, comme `publicPath` côté serveur. `slug` vide : la partie variable est omise. */
export const seoPath = (def: { path?: string }, locale: string, defaultLocale: string, slug: string | null | undefined) =>
  (def.path ? (locale === defaultLocale ? '' : `/${locale}`) + def.path.replace('[slug]', slug ?? '') : null)

// ───────────────────────── Images et textes du contenu ─────────────────────────

function walk(fields: Fields, values: Values, visit: (field: AnyField, value: unknown) => void) {
  for (const [key, field] of Object.entries(fields)) {
    // Un champ masqué par une condition n'est pas affiché sur le site : il n'est pas examiné.
    if (!isVisible(field, values)) continue
    const value = values[key]
    if (field.type === 'repeater') {
      for (const item of Array.isArray(value) ? value : []) if (item && typeof item === 'object') walk(field.fields as Fields, item as Values, visit)
    }
    else visit(field, value)
  }
}

/** Identifiants des images du contenu (champs image, galeries, répéteurs), sans doublon, dans l'ordre du formulaire. */
export function contentImageIds(fields: Fields, values: Values): string[] {
  const ids = new Set<string>()
  walk(fields, values, (field, value) => {
    if (field.type !== 'image') return
    for (const item of Array.isArray(value) ? value : [value]) {
      const id = item && typeof item === 'object' ? (item as { media?: unknown }).media : item
      if (typeof id === 'string' && id) ids.add(id)
    }
  })
  return [...ids]
}

const plain = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/g, 'x')

/** Nombre de mots de tous les textes du contenu (texte, texte long, texte mis en forme, y compris dans les répéteurs). */
export function contentWordCount(fields: Fields, values: Values): number {
  let words = 0
  walk(fields, values, (field, value) => {
    if (typeof value !== 'string' || !['text', 'textarea', 'richText'].includes(field.type)) return
    if (field.type === 'text' && field.format && field.format !== 'plain') return
    words += (field.type === 'richText' ? plain(value) : value).split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length
  })
  return words
}

/** Un texte mis en forme du contenu propose-t-il les titres de section (H2, H3) ? */
function contentAllowsHeadings(fields: Fields, values: Values): boolean {
  let allowed = false
  walk(fields, values, (field) => {
    if (field.type === 'richText' && (!field.features || (field.features as readonly string[]).includes('heading'))) allowed = true
  })
  return allowed
}
/** Le contenu a-t-il au moins un titre de section dans ses textes mis en forme ? */
function contentHasHeadings(fields: Fields, values: Values): boolean {
  let found = false
  walk(fields, values, (field, value) => {
    if (field.type === 'richText' && typeof value === 'string' && /<h[2-6][\s>]/i.test(value)) found = true
  })
  return found
}

// ───────────────────────── Conseils ─────────────────────────

export type SeoMedia = { name: string; mime: string; width: number | null; height: number | null; alt: Record<string, string> }

/** Une autre page du site, dans la même langue, pour repérer les doublons. */
export type SeoOther = { name: string; title: string; description: string; to?: string }

export type SeoTip = {
  /** Identifiant stable du conseil ('title-long', 'alt-missing'…). */
  id: string
  /** `important` : un oubli ou un doublon ; `conseil` : une amélioration possible ; `rappel` : rien à corriger, juste à savoir. */
  level: 'important' | 'conseil' | 'rappel'
  /** Ce qui ne va pas, en quelques mots. */
  title: string
  /** Ce qu'il faut faire, en une phrase. */
  advice: string
  /** Champ concerné, pour le situer dans l'onglet. */
  field: 'title' | 'description' | 'image' | 'content' | 'address' | 'visibility' | 'structure'
  /** Liens utiles : la page en doublon, les fichiers à compléter dans la médiathèque. */
  links?: { label: string; to: string }[]
}

export type SeoInput = {
  def: SeoDef
  site: SeoSite
  locale: string
  defaultLocale: string
  /** Champs communs aux langues et champs de la langue, tels qu'enregistrés (brouillon). */
  shared: Values
  values: Values
  /** Partie de l'adresse propre à la page (collections avec `[slug]`). */
  slug?: string | null
  /** La page est en ligne dans cette langue. */
  published: boolean
  /** Fichier de la médiathèque, par identifiant. */
  media: (id: string) => SeoMedia | undefined
  /** Les autres pages du site dans la même langue. */
  others: SeoOther[]
}

const quote = (text: string) => `« ${text} »`
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`
/** Adresse d'un fichier dans la médiathèque du back-office. */
export const seoMediaLink = (id: string) => `/admin/media?file=${encodeURIComponent(id)}`

/**
 * Les points à voir pour une page, dans l'ordre de l'onglet. Liste vide : rien à signaler.
 * Une page masquée des moteurs de recherche ne reçoit pas les conseils qui concernent Google (titre, description,
 * adresse, texte) : seuls restent ceux du partage et des images.
 */
export function seoTips(input: SeoInput): SeoTip[] {
  const { def, site, shared, values, locale } = input
  const L = SEO_LIMITS
  const view = seoView(def, shared, values, site)
  const merged = { ...shared, ...values }
  const tips: SeoTip[] = []
  const add = (tip: SeoTip) => tips.push(tip)
  const searchable = !view.noindex

  if (view.noindex && input.published) {
    add({ id: 'hidden-published', level: 'rappel', field: 'visibility', title: 'Page publiée, mais masquée des moteurs de recherche', advice: 'Elle n\'apparaîtra pas dans Google : si ce n\'est pas voulu, désactivez « Masquer cette page des moteurs de recherche ».' })
  }

  if (searchable) {
    // ── Titre
    if (view.titleFrom === 'none') {
      add({
        id: 'title-missing', level: 'important', field: 'title', title: 'Pas de titre',
        advice: `${view.pageTitle ? `Google n'affichera que ${quote(view.pageTitle)}. ` : ''}Écrivez un titre qui dit en quelques mots ce qu'on trouve sur cette page.`,
      })
    }
    else {
      const shown = truncateToWidth(view.pageTitle!)
      const twin = input.others.find(o => o.title && seoComparable(o.title) === seoComparable(view.baseTitle))
      if (twin) {
        add({
          id: 'title-duplicate', level: 'important', field: 'title', title: `Même titre que la page ${quote(twin.name)}`,
          advice: 'Donnez à chaque page un titre qui lui est propre : avec deux titres identiques, Google ne sait pas laquelle montrer.',
          ...(twin.to ? { links: [{ label: `Ouvrir ${quote(twin.name)}`, to: twin.to }] } : {}),
        })
      }
      if (shown.cut) {
        const last = shown.text.slice(0, -2).split(' ').slice(-3).join(' ')
        add({ id: 'title-long', level: 'conseil', field: 'title', title: 'Titre trop long', advice: `Google le coupera après ${quote(last)} : raccourcissez-le, ou placez l'essentiel au début.` })
      }
      else if (view.pageTitle!.length < L.titleMinChars) {
        add({ id: 'title-short', level: 'conseil', field: 'title', title: 'Titre très court', advice: 'Complétez-le avec le sujet de la page ou un mot que les gens tapent pour la trouver (un métier, une ville…).' })
      }
    }

    // ── Description
    if (!view.description) {
      add({ id: 'description-missing', level: 'important', field: 'description', title: 'Pas de description', advice: 'Résumez la page en une ou deux phrases : sans cela, Google choisit lui-même un extrait du texte.' })
    }
    else {
      const twin = input.others.find(o => o.description && seoComparable(o.description) === seoComparable(view.description))
      if (twin) {
        add({
          id: 'description-duplicate', level: 'important', field: 'description', title: `Même description que la page ${quote(twin.name)}`,
          advice: 'Écrivez une description propre à cette page, qui dise ce qu\'elle a de particulier.',
          ...(twin.to ? { links: [{ label: `Ouvrir ${quote(twin.name)}`, to: twin.to }] } : {}),
        })
      }
      if (view.description.length > L.descriptionMaxChars) {
        add({ id: 'description-long', level: 'conseil', field: 'description', title: 'Description trop longue', advice: `Google la coupera vers ${L.descriptionMaxChars} caractères (elle en fait ${view.description.length}) : gardez l'essentiel dans les deux premières lignes.` })
      }
      else if (view.description.length < L.descriptionMinChars) {
        add({ id: 'description-short', level: 'conseil', field: 'description', title: 'Description très courte', advice: 'Ajoutez une phrase qui donne envie de cliquer : ce que la page apporte, à qui elle s\'adresse.' })
      }
    }
  }

  // ── Image de partage
  const image = view.imageId ? input.media(view.imageId) : undefined
  if (!view.imageId && !view.fallbackImage) {
    add({ id: 'image-missing', level: 'conseil', field: 'image', title: 'Pas d\'image de partage', advice: `Choisissez une image (${L.imageIdealWidth} × ${L.imageIdealHeight} px dans l'idéal) : sans elle, le lien partagé sur les réseaux ou par message s'affiche sans illustration.` })
  }
  else if (image) {
    if (!(L.imageMimes as readonly string[]).includes(image.mime)) {
      add({ id: 'image-format', level: 'important', field: 'image', title: 'Image de partage dans un format non reconnu', advice: 'Les réseaux sociaux n\'affichent pas ce type de fichier : choisissez une image JPEG ou PNG.' })
    }
    else if (image.width && image.height) {
      const ratio = image.width / image.height
      if (image.width < L.imageMinWidth || image.height < L.imageMinHeight) {
        add({ id: 'image-small', level: 'conseil', field: 'image', title: `Image de partage trop petite (${image.width} × ${image.height} px)`, advice: `Choisissez une image d'au moins ${L.imageMinWidth} × ${L.imageMinHeight} px (${L.imageIdealWidth} × ${L.imageIdealHeight} dans l'idéal) : en dessous, elle s'affiche en petite vignette ou pas du tout.` })
      }
      else if (ratio < L.imageRatio * (1 - L.imageCropTolerance) || ratio > L.imageRatio / (1 - L.imageCropTolerance)) {
        add({ id: 'image-ratio', level: 'conseil', field: 'image', title: ratio < L.imageRatio ? 'Image de partage trop haute' : 'Image de partage trop allongée', advice: `Une carte de partage est un rectangle large (${L.imageIdealWidth} × ${L.imageIdealHeight} px) : cette image sera recadrée, vérifiez l'aperçu ou choisissez-en une plus adaptée.` })
      }
    }
  }

  // ── Images du contenu sans texte alternatif (celui de la langue, sinon celui de la langue par défaut, comme sur le site)
  const silent = contentImageIds(def.fields, merged).flatMap((id) => {
    const file = input.media(id)
    return file && file.mime.startsWith('image/') && !squash(file.alt[locale]) && !squash(file.alt[input.defaultLocale]) ? [{ id, name: file.name }] : []
  })
  if (silent.length) {
    add({
      id: 'alt-missing', level: 'conseil', field: 'content',
      title: `${plural(silent.length, 'image', 'images')} sans texte alternatif`,
      advice: 'Décrivez chaque image en une phrase dans la médiathèque : c\'est ce texte que lisent Google et les personnes qui ne voient pas l\'image.',
      links: silent.slice(0, 5).map(file => ({ label: file.name, to: seoMediaLink(file.id) })),
    })
  }

  if (searchable) {
    // ── Adresse de la page
    const slug = input.slug ?? ''
    if (def.kind === 'collection' && def.path?.includes('[slug]') && slug) {
      const moved = input.published ? ' L\'ancienne adresse continuera de mener à la page.' : ''
      if (/(^|-)copie(-\d+)?$/.test(slug)) {
        add({ id: 'slug-unclear', level: 'conseil', field: 'address', title: 'Adresse de la page peu lisible', advice: `Elle se termine par « copie » : remplacez-la par quelques mots qui décrivent la page (onglet Contenu).${moved}` })
      }
      else if (!/[a-z]/.test(slug)) {
        add({ id: 'slug-unclear', level: 'conseil', field: 'address', title: 'Adresse de la page peu lisible', advice: `Elle ne contient aucun mot : remplacez-la par quelques mots qui décrivent la page (onglet Contenu).${moved}` })
      }
      else if (slug.length > L.slugMaxChars) {
        add({ id: 'slug-long', level: 'conseil', field: 'address', title: 'Adresse de la page très longue', advice: `Gardez-en les trois ou quatre mots importants (onglet Contenu) : une adresse courte se lit et se partage mieux.${moved}` })
      }
    }

    // ── Texte principal
    if (Object.values(def.fields).some(f => f.type === 'richText')) {
      const words = contentWordCount(def.fields, merged)
      if (words < L.bodyMinWords) {
        add({ id: 'body-short', level: 'conseil', field: 'content', title: `Très peu de texte (${plural(words, 'mot', 'mots')})`, advice: 'Développez le contenu de la page : Google a besoin de texte pour comprendre de quoi elle parle.' })
      }
      else if (words >= L.sectionWords && contentAllowsHeadings(def.fields, merged) && !contentHasHeadings(def.fields, merged)) {
        add({ id: 'headings-none', level: 'conseil', field: 'structure', title: `Texte long sans intertitre (${plural(words, 'mot', 'mots')})`, advice: 'Découpez-le avec des « Titres de section » (H2) et des « Sous-titres » (H3), en reprenant les mots que les gens cherchent : la page se lit mieux, et Google comprend chaque partie.' })
      }
    }
  }
  return tips
}

/** État d'une page dans la vue d'ensemble. Un simple rappel ne compte pas comme un point à améliorer. */
export type SeoState = 'complete' | 'improve' | 'hidden'
export const seoPoints = (tips: SeoTip[]) => tips.filter(t => t.level !== 'rappel').length
export const seoState = (tips: SeoTip[], noindex: boolean): SeoState => (noindex ? 'hidden' : seoPoints(tips) ? 'improve' : 'complete')
export const SEO_STATE_LABELS: Record<SeoState, string> = { complete: 'Complet', improve: 'À améliorer', hidden: 'Masqué' }

// ───────────────────────── Plan de la page (titres H1 à H6) ─────────────────────────

/** Un titre de la page telle qu'elle s'affiche (voir `readOutline` dans `shared/live-preview.ts`). */
export type SeoHeading = { level: number; text: string; place: string }

/** Mots qui comptent d'un texte : en minuscules, sans accents, d'au moins 4 lettres. */
const keywords = (text: string) => new Set(text.toLocaleLowerCase('fr').normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 4))

/**
 * Conseils sur les titres de la page, lus dans la page rendue avec la saisie en cours. Ils complètent `seoTips`,
 * qui ne voit que les valeurs du formulaire : le titre principal (H1) est placé par le gabarit du site, souvent à
 * partir d'un champ du contenu, et le back-office ne peut le connaître qu'en regardant la page.
 * `baseTitle` : titre de la page sans le suffixe du site. Une page masquée des moteurs de recherche n'en reçoit aucun.
 */
export function seoOutlineTips(headings: SeoHeading[], page: { baseTitle: string; noindex: boolean }): SeoTip[] {
  if (page.noindex) return []
  const tips: SeoTip[] = []
  const h1 = headings.filter(h => h.level === 1)
  if (!h1.length) {
    tips.push({
      id: 'h1-missing', level: 'important', field: 'structure', title: 'Pas de titre principal (H1)',
      advice: 'C\'est lui qui annonce le sujet de la page à Google. Il vient en général d\'un champ du contenu (titre, accroche) : vérifiez qu\'il est rempli. S\'il manque encore, c\'est le gabarit de la page qui est à compléter.',
    })
  }
  else if (h1.length > 1) {
    tips.push({
      id: 'h1-multiple', level: 'conseil', field: 'structure', title: `${h1.length} titres principaux (H1)`,
      advice: `Gardez un seul H1, qui dit le sujet de la page (${h1.map(h => quote(h.text || 'vide')).join(', ')}) : les autres peuvent devenir des titres de section (H2).`,
    })
  }
  if (h1.length && h1.every(h => !h.text)) {
    tips.push({ id: 'h1-empty', level: 'important', field: 'structure', title: 'Titre principal (H1) vide', advice: 'Le titre principal s\'affiche sans texte : remplissez le champ dont il vient (titre, accroche).' })
  }
  const empty = headings.filter(h => h.level > 1 && !h.text).length
  if (empty) {
    tips.push({ id: 'heading-empty', level: 'conseil', field: 'structure', title: `${plural(empty, 'titre vide', 'titres vides')}`, advice: 'Un titre sans texte n\'apporte rien et gêne les lecteurs d\'écran : retirez la mise en forme de titre de cette ligne, ou écrivez-le.' })
  }
  // Niveau sauté en descendant (H2 puis H4) : en remontant (H4 puis H2), c'est normal.
  for (let i = 1; i < headings.length; i++) {
    const before = headings[i - 1]!, here = headings[i]!
    if (here.level > before.level + 1) {
      tips.push({
        id: 'heading-skip', level: 'conseil', field: 'structure', title: `Niveau de titre sauté (H${before.level} puis H${here.level})`,
        advice: `${quote(here.text || 'titre vide')} est un H${here.level} placé juste après un H${before.level} : faites-en un H${before.level + 1}, pour que le plan de la page reste lisible par Google et par les lecteurs d'écran.`,
      })
      break
    }
  }
  // Le H1 et le titre de la page doivent parler de la même chose : au moins un mot important en commun.
  const main = h1.length === 1 ? h1[0]!.text : ''
  if (main && page.baseTitle) {
    const inTitle = keywords(page.baseTitle)
    const inH1 = keywords(main)
    if (inTitle.size && inH1.size && ![...inH1].some(w => inTitle.has(w))) {
      tips.push({
        id: 'h1-unrelated', level: 'conseil', field: 'structure', title: 'Titre principal (H1) sans rapport avec le titre de la page',
        advice: `Google compare ${quote(main)} et ${quote(page.baseTitle)} : reprenez dans l'un les mots importants de l'autre, pour qu'ils annoncent le même sujet.`,
      })
    }
  }
  return tips
}
