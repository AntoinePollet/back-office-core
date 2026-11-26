/**
 * Recherche sur le site : logique pure, partagée par la route publique `/api/search` et ses tests.
 *
 * La recherche lit les contenus publiés et compare sans tenir compte des majuscules ni des accents (`foldText`,
 * comme la palette du back-office). Chaque mot cherché doit se trouver dans la page ; une page dont le titre
 * correspond passe avant une page où les mots ne sont que dans le texte.
 */
import { type AnyField, isVisible } from './format'
import { foldText, matchScore, searchWords } from './search'

type Fields = Record<string, AnyField>
type Values = Record<string, unknown>

export const SITE_SEARCH = {
  /** Longueur minimale de la recherche (lettres et chiffres, tous mots réunis) : en dessous, tout correspondrait. */
  minChars: 2,
  /** Longueur maximale de la recherche lue. */
  maxChars: 100,
  /** Nombre de mots pris en compte. */
  maxWords: 8,
  /** Résultats renvoyés par défaut, et au plus. */
  defaultLimit: 10,
  maxLimit: 50,
  /** Longueur visée de l'extrait (caractères). */
  excerptChars: 160,
} as const

/** Un contenu est-il cherchable ? Par défaut, oui s'il a une page à lui (`path`) ; `search: false` l'exclut. */
export const isSearchable = (def: { path?: string; search?: boolean }) => (def.search === undefined ? !!def.path : def.search && !!def.path)

/** Les mots d'une recherche de visiteur, ou `null` si elle est trop courte pour être lancée. */
export function siteSearchWords(query: unknown): string[] | null {
  const words = searchWords(String(query ?? '').slice(0, SITE_SEARCH.maxChars)).slice(0, SITE_SEARCH.maxWords)
  return words.join('').length >= SITE_SEARCH.minChars ? words : null
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ', laquo: '«', raquo: '»', hellip: '…', rsquo: '’', lsquo: '‘', ndash: '–', mdash: '—', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç' }

/**
 * Texte d'un HTML : balises retirées, entités courantes décodées. Une balise de bloc (paragraphe, titre, élément de
 * liste) sépare deux mots ; une mise en forme dans la ligne (gras, italique, lien) ne laisse rien : « <strong>mot</strong>. »
 * reste « mot. ».
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<\/?(strong|em|b|i|u|s|a|span|mark|small|sub|sup|code)(\s[^>]*)?>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (whole, name) => ENTITIES[name.toLowerCase()] ?? whole)
    .replace(/\s+/g, ' ').trim()
}

/**
 * Les textes d'un contenu, dans l'ordre du formulaire : champs texte, texte long et texte mis en forme, y compris
 * dans les répéteurs. Un champ masqué par une condition, une adresse e-mail, un téléphone ou une adresse web ne
 * sont pas du texte à chercher. `skip` : champ à laisser de côté (le titre, cherché à part).
 */
export function contentTexts(fields: Fields, values: Values, skip?: string): string[] {
  const out: string[] = []
  for (const [key, field] of Object.entries(fields)) {
    if (key === skip || !isVisible(field, values)) continue
    const value = values[key]
    if (field.type === 'repeater') {
      for (const item of Array.isArray(value) ? value : []) if (item && typeof item === 'object') out.push(...contentTexts(field.fields as Fields, item as Values))
      continue
    }
    if (typeof value !== 'string' || !value.trim()) continue
    if (field.type === 'richText') { const text = htmlToText(value); if (text) out.push(text) }
    else if (field.type === 'textarea' || (field.type === 'text' && (!field.format || field.format === 'plain'))) out.push(value.replace(/\s+/g, ' ').trim())
  }
  return out
}

/** Un contenu prêt à être cherché. */
export type SearchDoc = { title: string; description: string; texts: string[] }

/**
 * Pertinence d'un contenu pour une recherche, ou `null` s'il ne correspond pas. Plus petit : plus pertinent.
 * 0 à 2 : tous les mots sont dans le titre (voir `matchScore`) ; 3 : dans la description ; 4 : dans le texte ;
 * 5 : répartis entre le titre, la description et le texte.
 */
export function siteSearchScore(doc: SearchDoc, words: string[]): number | null {
  if (!words.length) return null
  const inTitle = matchScore(doc.title, words)
  if (inTitle !== null) return inTitle
  if (matchScore(doc.description, words) !== null) return 3
  if (doc.texts.some(t => matchScore(t, words) !== null)) return 4
  const all = foldText([doc.title, doc.description, ...doc.texts].join(' '))
  return words.every(w => all.includes(w)) ? 5 : null
}

/** Un morceau d'extrait ; `match` : il correspond à un mot cherché (à mettre en évidence). */
export type ExcerptPart = { text: string; match: boolean }

/**
 * Forme comparable d'un texte, caractère par caractère : `map[i]` est la position, dans le texte d'origine, du
 * caractère qui a donné le i-ème caractère plié (« œ » en donne deux). Sert à retrouver, dans le texte d'origine,
 * ce qui a été trouvé sans accents ni majuscules.
 */
function foldWithMap(text: string) {
  let folded = ''
  const map: number[] = []
  for (let i = 0; i < text.length; i++) {
    const piece = text[i]!.toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae').normalize('NFD').replace(/\p{M}/gu, '')
    for (const char of piece) { folded += char; map.push(i) }
  }
  return { folded, map }
}

/** Positions (début, fin) des mots cherchés dans un texte, fusionnées quand elles se touchent. */
function matchRanges(text: string, words: string[]): [number, number][] {
  const { folded, map } = foldWithMap(text)
  const ranges: [number, number][] = []
  for (const word of words) {
    for (let at = folded.indexOf(word); at !== -1; at = folded.indexOf(word, at + word.length))
      ranges.push([map[at]!, map[at + word.length - 1]! + 1])
  }
  ranges.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const r of ranges) {
    const last = merged.at(-1)
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push([...r])
  }
  return merged
}

/** Découpe un texte en morceaux, ceux qui correspondent à un mot cherché étant marqués. */
export function highlightParts(text: string, words: string[]): ExcerptPart[] {
  const parts: ExcerptPart[] = []
  let at = 0
  for (const [start, end] of matchRanges(text, words)) {
    if (start > at) parts.push({ text: text.slice(at, start), match: false })
    parts.push({ text: text.slice(start, end), match: true })
    at = end
  }
  if (at < text.length) parts.push({ text: text.slice(at), match: false })
  return parts
}

/**
 * Extrait à montrer sous un résultat : le passage, autour du premier mot trouvé, du texte qui contient le plus de mots
 * cherchés, coupé à des fins de mots, avec « … » là où il est coupé. Sans mot trouvé dans les textes : le début de la
 * description, sinon du premier texte.
 */
export function siteSearchExcerpt(doc: SearchDoc, words: string[], max: number = SITE_SEARCH.excerptChars): ExcerptPart[] {
  const candidates = [doc.description, ...doc.texts].filter(Boolean)
  // Le texte qui contient le plus de mots cherchés ; à égalité, le premier (la description, puis l'ordre du formulaire).
  const found = (text: string) => { const folded = foldText(text); return words.filter(w => folded.includes(w)).length }
  const source = candidates.reduce<string | undefined>((best, text) => (best === undefined || found(text) > found(best) ? text : best), undefined)
  if (!source) return []
  const first = matchRanges(source, words)[0]?.[0] ?? 0
  // Le passage commence un peu avant le mot trouvé, au début d'un mot.
  let start = Math.max(0, first - Math.floor(max / 3))
  if (start > 0) { const space = source.indexOf(' ', start); start = space !== -1 && space < first ? space + 1 : first }
  let end = Math.min(source.length, start + max)
  if (end < source.length) { const space = source.lastIndexOf(' ', end); if (space > start + max / 2) end = space }
  const passage = source.slice(start, end).replace(/[\s,;:–—-]+$/, '')
  const parts = highlightParts(passage, words)
  if (start > 0) parts.unshift({ text: '… ', match: false })
  if (start + passage.length < source.length) parts.push({ text: ' …', match: false })
  return parts
}
