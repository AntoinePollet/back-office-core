// Recherche de la palette (⌘K) : mêmes règles sur le serveur (titres des contenus) et dans le navigateur (écrans, actions).

/** Met un texte sous une forme comparable : sans majuscules ni accents (« Études » → « etudes », « Œuvre » → « oeuvre »). */
export const foldText = (text: string) =>
  text.toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae').normalize('NFD').replace(/\p{M}/gu, '').trim()

/** Les mots d'une recherche, sous forme comparable. */
export const searchWords = (query: string) => foldText(query).split(/[\s'’-]+/).filter(Boolean)

/**
 * Pertinence d'un texte pour une recherche : 0 s'il commence par elle, 1 si chaque mot cherché commence un mot du texte,
 * 2 si chaque mot cherché s'y trouve quelque part, `null` sinon.
 */
export function matchScore(text: string, words: string[]): number | null {
  const folded = foldText(text)
  if (!words.length || !words.every(w => folded.includes(w))) return null
  const parts = folded.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  if (parts.join(' ').startsWith(words.join(' '))) return 0
  return words.every(w => parts.some(p => p.startsWith(w))) ? 1 : 2
}
