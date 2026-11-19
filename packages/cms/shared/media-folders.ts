/**
 * Dossiers de la médiathèque : règles communes au serveur (qui fait foi), à l'interface et à l'outil d'import.
 *
 * Un dossier est une donnée du back-office (table `cms_media_folders`), pas un chemin dans le stockage : ranger un
 * fichier ne change ni sa clé R2 ni son adresse publique (`/media/<id>/<nom>`). Les dossiers s'imbriquent, sur
 * quelques niveaux seulement : un fil d'Ariane reste lisible, une arborescence profonde ne l'est plus.
 *
 * Fonctions pures, sans dépendance.
 */

export type MediaFolder = { id: string; name: string; parentId: string | null }

/** Longueur maximale d'un nom de dossier. */
export const FOLDER_NAME_MAX = 60
/** Niveaux d'imbrication au plus : « Chantiers › Isolation › 2026 ». */
export const FOLDER_MAX_DEPTH = 3
/** Nom de la racine, à afficher. */
export const MEDIA_ROOT_LABEL = 'Médiathèque'

/**
 * Nom de dossier nettoyé (espaces en trop retirés), ou le message d'erreur à afficher.
 * Interdits : « / » (il sépare les niveaux dans l'outil d'import), « \ » et les caractères invisibles.
 */
export function cleanFolderName(input: unknown): { name: string; error?: undefined } | { name?: undefined; error: string } {
  if (typeof input !== 'string') return { error: 'Donnez un nom au dossier.' }
  const name = input.normalize('NFC').replace(/\s+/g, ' ').trim()
  if (!name) return { error: 'Donnez un nom au dossier.' }
  if (name.length > FOLDER_NAME_MAX) return { error: `Nom trop long : ${FOLDER_NAME_MAX} caractères au maximum.` }
  if (/[/\\]/.test(name)) return { error: 'Le nom d\'un dossier ne peut pas contenir « / » ni « \\ ».' }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(name)) return { error: 'Le nom contient un caractère invisible.' }
  if (name === '.' || name === '..') return { error: 'Choisissez un autre nom.' }
  return { name }
}

/** Clé de comparaison des noms : « Chantiers » et « chantiers » désignent le même dossier. */
export const folderKey = (name: string) => name.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('fr')

/** Vrai si un autre dossier du même dossier parent porte déjà ce nom (`exceptId` : le dossier renommé lui-même). */
export function nameTaken(folders: readonly MediaFolder[], parentId: string | null, name: string, exceptId?: string) {
  const key = folderKey(name)
  return folders.some(f => f.id !== exceptId && (f.parentId ?? null) === (parentId ?? null) && folderKey(f.name) === key)
}

/** Dossiers de la racine jusqu'à celui-ci inclus. Vide pour la racine ou un dossier inconnu. */
export function folderPath(folders: readonly MediaFolder[], id: string | null | undefined): MediaFolder[] {
  const byId = new Map(folders.map(f => [f.id, f]))
  const path: MediaFolder[] = []
  let current = id ? byId.get(id) : undefined
  // Garde-fou contre une boucle (donnée abîmée) : jamais plus de tours que de dossiers.
  while (current && path.length <= folders.length) {
    path.unshift(current)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return path
}

/** « Chantiers › Isolation », ou le nom de la racine. */
export const folderLabel = (folders: readonly MediaFolder[], id: string | null | undefined, separator = ' › ') =>
  folderPath(folders, id).map(f => f.name).join(separator) || MEDIA_ROOT_LABEL

/** Niveau d'un dossier : 1 pour un dossier de la racine, 0 pour la racine elle-même. */
export const folderDepth = (folders: readonly MediaFolder[], id: string | null | undefined) => folderPath(folders, id).length

/** Identifiants de tous les sous-dossiers, à tous les niveaux (sans le dossier lui-même). */
export function descendantIds(folders: readonly MediaFolder[], id: string): Set<string> {
  const out = new Set<string>()
  let frontier = [id]
  while (frontier.length) {
    frontier = folders.filter(f => f.parentId && frontier.includes(f.parentId) && !out.has(f.id) && f.id !== id).map(f => f.id)
    for (const f of frontier) out.add(f)
  }
  return out
}

/** Nombre de niveaux sous un dossier (0 s'il n'a pas de sous-dossier). */
export function subtreeHeight(folders: readonly MediaFolder[], id: string): number {
  const below = descendantIds(folders, id)
  let height = 0
  for (const d of below) height = Math.max(height, folderDepth(folders, d) - folderDepth(folders, id))
  return height
}

/**
 * Peut-on créer un dossier dans `parentId` ? Renvoie le message d'erreur, ou null.
 */
export function checkFolderCreate(folders: readonly MediaFolder[], parentId: string | null, name: string): string | null {
  if (parentId && !folders.some(f => f.id === parentId)) return 'Dossier parent introuvable.'
  if (folderDepth(folders, parentId) + 1 > FOLDER_MAX_DEPTH) return `Pas plus de ${FOLDER_MAX_DEPTH} niveaux de dossiers.`
  if (nameTaken(folders, parentId, name)) return `Un dossier « ${name} » existe déjà ici.`
  return null
}

/**
 * Peut-on déplacer le dossier `id` dans `parentId` (null : la racine) ? Renvoie le message d'erreur, ou null.
 * Refusé : dans lui-même ou l'un de ses sous-dossiers, au-delà de la profondeur permise, ou si le nom est déjà pris.
 */
export function checkFolderMove(folders: readonly MediaFolder[], id: string, parentId: string | null): string | null {
  const folder = folders.find(f => f.id === id)
  if (!folder) return 'Dossier introuvable.'
  if (parentId && !folders.some(f => f.id === parentId)) return 'Dossier de destination introuvable.'
  if (parentId === id || (parentId && descendantIds(folders, id).has(parentId))) return 'Un dossier ne peut pas être rangé dans lui-même.'
  if (folderDepth(folders, parentId) + 1 + subtreeHeight(folders, id) > FOLDER_MAX_DEPTH) return `Pas plus de ${FOLDER_MAX_DEPTH} niveaux de dossiers.`
  if ((folder.parentId ?? null) !== (parentId ?? null) && nameTaken(folders, parentId, folder.name, id)) return `Un dossier « ${folder.name} » existe déjà à cet endroit.`
  return null
}

/**
 * Chemin de dossier écrit dans l'outil d'import : « Chantiers/Isolation » (« / » sépare les niveaux).
 * Renvoie les noms de chaque niveau, ou le message d'erreur.
 */
export function parseFolderPath(input: unknown): { names: string[]; error?: undefined } | { names?: undefined; error: string } {
  if (typeof input !== 'string') return { error: 'chemin de dossier attendu, comme "Chantiers/Isolation"' }
  const parts = input.split('/').map(p => p.trim()).filter(Boolean)
  if (!parts.length) return { error: 'chemin de dossier vide' }
  if (parts.length > FOLDER_MAX_DEPTH) return { error: `pas plus de ${FOLDER_MAX_DEPTH} niveaux de dossiers` }
  const names: string[] = []
  for (const part of parts) {
    const clean = cleanFolderName(part)
    if (clean.error) return { error: `« ${part} » : ${clean.error.charAt(0).toLowerCase()}${clean.error.slice(1)}` }
    names.push(clean.name!)
  }
  return { names }
}

/** Dossiers dans l'ordre d'un arbre (parent puis ses enfants, par nom), avec leur niveau : pour une liste « Déplacer vers… ». */
export function folderTree(folders: readonly MediaFolder[]): { folder: MediaFolder; depth: number }[] {
  const out: { folder: MediaFolder; depth: number }[] = []
  const byName = (a: MediaFolder, b: MediaFolder) => a.name.localeCompare(b.name, 'fr', { numeric: true })
  const walk = (parentId: string | null, depth: number) => {
    for (const f of folders.filter(f => (f.parentId ?? null) === parentId).sort(byName)) {
      if (out.some(o => o.folder.id === f.id)) continue
      out.push({ folder: f, depth })
      walk(f.id, depth + 1)
    }
  }
  walk(null, 1)
  return out
}
