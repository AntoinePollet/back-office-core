// Lecture et mise à jour de CHANGELOG.md : fonctions sans effet de bord, utilisées par scripts/release.mjs.
//
// Le fichier a une section par version, la plus récente en haut, précédée de la section « À venir » où l'on note
// les changements au fil de l'eau :
//
//   ## À venir
//   ### Nouveautés
//   - …
//   ## 0.5.0 — 2026-11-19
//   …

export const PENDING_TITLE = 'À venir'

/** Section « À venir » vide, remise en tête du fichier après chaque publication. */
export const PENDING_TEMPLATE = `## ${PENDING_TITLE}

<!-- Notez ici chaque changement au fil de l'eau, du point de vue de la personne qui met son site à jour.
     Rubriques possibles : ### Nouveautés, ### Correctifs, ### À faire dans votre site (action demandée au développeur). -->
`

const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Position d'une section de niveau 2 dont le titre commence par `title` : { start, bodyStart, end }, ou null. */
function locate(text, title) {
  const heading = new RegExp(`^## ${escape(title)}(?![\\w.])[^\\n]*\\n?`, 'm').exec(text)
  if (!heading) return null
  const bodyStart = heading.index + heading[0].length
  const next = /^## /m.exec(text.slice(bodyStart))
  return { start: heading.index, bodyStart, end: next ? bodyStart + next.index : text.length }
}

/** Y a-t-il autre chose que des lignes vides, des titres et des commentaires ? */
export function hasContent(body) {
  return body.replace(/<!--[\s\S]*?-->/g, '').split('\n').some(line => line.trim() && !line.trim().startsWith('#'))
}

/** Notes d'une version (« 0.5.1 » ou « v0.5.1 »), sans le titre. Null si la section manque ou est vide. */
export function releaseNotes(text, version) {
  const section = locate(text, String(version).replace(/^v/, ''))
  if (!section) return null
  const body = text.slice(section.bodyStart, section.end).trim()
  return hasContent(body) ? body : null
}

/** Ce qui est noté dans « À venir », sans le commentaire d'aide. Null si la section manque ou ne contient rien. */
export function pendingNotes(text) {
  const section = locate(text, PENDING_TITLE)
  if (!section) return null
  const body = text.slice(section.bodyStart, section.end).replace(/<!--[\s\S]*?-->/g, '').trim()
  return hasContent(body) ? body : null
}

/**
 * Publie « À venir » sous le numéro de la version : la section devient « ## x.y.z — date » et une section
 * « À venir » vide reprend sa place. Lève une erreur si « À venir » manque ou est vide, ou si la version y est déjà.
 */
export function stampRelease(text, version, date) {
  const notes = pendingNotes(text)
  if (!notes) throw new Error(`La section « ## ${PENDING_TITLE} » de CHANGELOG.md est vide ou absente.`)
  if (locate(text, version)) throw new Error(`CHANGELOG.md contient déjà une section « ## ${version} ».`)
  const section = locate(text, PENDING_TITLE)
  return `${text.slice(0, section.start)}${PENDING_TEMPLATE}\n## ${version} — ${date}\n\n${notes}\n\n${text.slice(section.end)}`.replace(/\n+$/, '\n')
}
