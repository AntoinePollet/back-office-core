/**
 * Largeurs d'image servies par le site. La liste est fermée : chaque largeur demandée est une image
 * calculée puis gardée en cache, et une liste ouverte permettrait d'en faire fabriquer à l'infini.
 */
export const IMAGE_WIDTHS = [160, 320, 480, 640, 800, 1024, 1280, 1600, 1920, 2560] as const

/**
 * Proportions (largeur/hauteur) dans lesquelles une image peut être recadrée par le serveur. Liste fermée, pour la même
 * raison que les largeurs : une proportion demandée hors liste est ramenée à la plus proche.
 */
export const IMAGE_RATIOS = ['1/1', '5/4', '4/3', '3/2', '16/10', '16/9', '2/1', '21/9', '3/1', '4/5', '3/4', '2/3', '9/16'] as const
export type ImageRatio = typeof IMAGE_RATIOS[number]

/** Formats que l'on sait redimensionner et recadrer. Les SVG, GIF animés et PDF sont servis tels quels. */
export const RESIZABLE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif']

/** Plus petite largeur servie qui couvre la largeur voulue. */
export const snapWidth = (width: number) => IMAGE_WIDTHS.find(w => w >= width) ?? IMAGE_WIDTHS[IMAGE_WIDTHS.length - 1]!

// ───────────── Point d'intérêt ─────────────

/**
 * Point d'intérêt d'une image : là où se trouve le sujet (un visage, un produit). `x` va de 0 (bord gauche) à 1 (bord droit),
 * `y` de 0 (haut) à 1 (bas), au centième près. C'est une propriété du fichier, réglée dans la médiathèque ; `null` : le centre.
 * Quand l'image est recadrée (par le navigateur ou par le serveur), c'est autour de ce point.
 */
export type Focus = { x: number; y: number }

/** Un fichier peut-il recevoir un point d'intérêt ? (Les images que l'on sait recadrer.) */
export const canHaveFocus = (mime: string | null | undefined) => !!mime && RESIZABLE_TYPES.includes(mime)

const clampUnit = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 100) / 100

/**
 * Met un point d'intérêt reçu sous sa forme enregistrée : coordonnées bornées entre 0 et 1, au centième.
 * Le centre exact, ou une valeur qui n'est pas un point, donne `null` (pas de point : recadrage au centre).
 */
export function normalizeFocus(value: unknown): Focus | null {
  if (!value || typeof value !== 'object') return null
  const { x, y } = value as Record<string, unknown>
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null
  const focus = { x: clampUnit(x), y: clampUnit(y) }
  return focus.x === 0.5 && focus.y === 0.5 ? null : focus
}

/** Une valeur reçue est-elle un point d'intérêt acceptable (`null` compris) ? Sert à refuser une saisie mal formée. */
export function isFocusInput(value: unknown) {
  if (value === null) return true
  if (!value || typeof value !== 'object') return false
  const { x, y } = value as Record<string, unknown>
  return typeof x === 'number' && typeof y === 'number' && x >= 0 && x <= 1 && y >= 0 && y <= 1
}

const percent = (n: number) => Math.round(n * 100)

/**
 * Valeur CSS `object-position` qui garde le point d'intérêt visible quand le navigateur recadre l'image
 * (`object-fit: cover`). Rien si le fichier n'a pas de point : le navigateur centre, comme avant.
 */
export function cmsObjectPosition(media: { focus?: Focus | null } | null | undefined) {
  const focus = normalizeFocus(media?.focus)
  return focus ? `${percent(focus.x)}% ${percent(focus.y)}%` : undefined
}

// ───────────── Proportions ─────────────

/** Lit des proportions : `'16/9'`, `'16:9'`, `'16x9'`, `'1.5'` ou un nombre (largeur divisée par hauteur). */
export function parseRatio(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null
  if (typeof value !== 'string') return null
  const match = /^\s*(\d+(?:\.\d+)?)\s*(?:[/:x]\s*(\d+(?:\.\d+)?))?\s*$/.exec(value)
  if (!match) return null
  const ratio = Number(match[1]) / (match[2] === undefined ? 1 : Number(match[2]))
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null
}

const ratioNumber = (ratio: ImageRatio) => parseRatio(ratio)!

/** Proportions servies les plus proches de celles demandées ; `null` si la demande n'est pas lisible. */
export function snapRatio(value: unknown): ImageRatio | null {
  const wanted = parseRatio(value)
  if (wanted === null) return null
  let best: ImageRatio = IMAGE_RATIOS[0]
  // L'écart se mesure en proportion (16/9 est aussi loin de 4/3 que 9/16 l'est de 3/4).
  for (const r of IMAGE_RATIOS) if (Math.abs(Math.log(ratioNumber(r) / wanted)) < Math.abs(Math.log(ratioNumber(best) / wanted))) best = r
  return best
}

type Sized = { width?: number | null; height?: number | null; focus?: Focus | null }

/**
 * Rectangle gardé quand une image est recadrée à des proportions données : le plus grand rectangle de ces proportions
 * qui tient dans l'image, placé pour que le point d'intérêt occupe dans le rectangle la même position relative que dans
 * l'image (c'est la règle de `object-position` en CSS et celle de `gravity` chez Cloudflare : les deux recadrages coïncident).
 * En pixels de l'image d'origine. `null` si les dimensions de l'image ne sont pas connues.
 */
export function cropRect(media: Sized, ratio: unknown) {
  const r = parseRatio(ratio)
  const sw = media.width, sh = media.height
  if (!r || !sw || !sh || sw <= 0 || sh <= 0) return null
  const focus = normalizeFocus(media.focus) ?? { x: 0.5, y: 0.5 }
  // Image plus large que le cadre : on coupe à gauche et à droite ; sinon en haut et en bas.
  const wide = sw / sh > r
  const width = wide ? Math.max(1, Math.round(sh * r)) : sw
  const height = wide ? sh : Math.max(1, Math.min(sh, Math.round(sw / r)))
  return { left: Math.round((sw - width) * focus.x), top: Math.round((sh - height) * focus.y), width, height }
}

/**
 * Dimensions de l'image recadrée servie pour une largeur demandée : jamais plus grande que ce que l'image d'origine
 * contient (on n'agrandit pas). Sans dimensions connues, la largeur demandée est prise telle quelle.
 */
export function cropSize(media: Sized, ratio: ImageRatio, width: number) {
  const r = ratioNumber(ratio)
  const rect = cropRect(media, r)
  const w = Math.max(1, Math.min(width, rect?.width ?? width))
  return { width: w, height: Math.max(1, Math.min(Math.round(w / r), rect?.height ?? Infinity)) }
}

// ───────────── Adresses ─────────────

type Resizable = { url: string; mime?: string; width?: number | null; height?: number | null; focus?: Focus | null }

const resizable = (media: Resizable) => !media.mime || RESIZABLE_TYPES.includes(media.mime)
const ratioToken = (ratio: ImageRatio) => ratio.replace('/', 'x')
const focusToken = (focus: Focus | null) => (focus ? `${percent(focus.x)}-${percent(focus.y)}` : '')

/**
 * Paramètres d'une version d'image, sous leur seule forme acceptée par la route /media : `w=640`, ou, recadrée,
 * `w=640&r=16x9` suivi de `&f=30-20` (point d'intérêt, en pour cent) si le fichier en a un. Le point fait partie de
 * l'adresse : quand il change, l'adresse change, et aucun cache ne peut resservir l'ancien cadrage.
 */
export function imageQuery(media: { focus?: Focus | null }, width: number, ratio?: unknown) {
  const r = ratio == null || ratio === '' ? null : snapRatio(ratio)
  const f = r ? focusToken(normalizeFocus(media.focus)) : ''
  return `w=${snapWidth(width)}${r ? `&r=${ratioToken(r)}` : ''}${f ? `&f=${f}` : ''}`
}

/**
 * Adresse d'une image à une largeur donnée (arrondie à la largeur servie supérieure).
 * Avec `ratio` (`'1/1'`, `'16/9'`… voir `IMAGE_RATIOS`), l'image est recadrée par le serveur à ces proportions,
 * autour du point d'intérêt réglé dans la médiathèque : `cmsImageUrl(photo, 640, '1/1')`.
 */
export function cmsImageUrl(media: Resizable | null | undefined, width: number, ratio?: string | number | null) {
  if (!media) return ''
  return resizable(media) ? `${media.url}?${imageQuery(media, width, ratio)}` : media.url
}

/**
 * Liste des versions d'une image pour l'attribut `srcset` : le navigateur choisit la plus adaptée à l'écran.
 * On ne propose pas de version plus large que l'image d'origine (ou, avec `ratio`, que sa partie gardée).
 */
export function cmsImageSrcset(media: Resizable | null | undefined, maxWidth: number = IMAGE_WIDTHS[IMAGE_WIDTHS.length - 1]!, ratio?: string | number | null) {
  if (!media || !resizable(media)) return undefined
  const available = (ratio != null && ratio !== '' ? cropRect(media, snapRatio(ratio)) : null)?.width ?? media.width ?? maxWidth
  const limit = Math.min(maxWidth, available)
  const widths = IMAGE_WIDTHS.filter(w => w < limit)
  // La dernière version couvre la largeur maximale utile.
  widths.push(snapWidth(limit) as never)
  return [...new Set(widths)].map(w => `${media.url}?${imageQuery(media, w, ratio)} ${w}w`).join(', ')
}

// ───────────── Route /media ─────────────

/**
 * Ce que la route /media fait d'une demande de version (`?w=…&r=…&f=…`) pour un fichier donné :
 * - `redirect` : la demande n'est pas sous sa forme unique (largeur ou proportions hors liste, point d'intérêt absent,
 *   périmé ou inventé) ; on renvoie vers la bonne adresse. Un visiteur ne peut donc faire calculer, pour un fichier,
 *   que `IMAGE_WIDTHS.length × (1 + IMAGE_RATIOS.length)` images, quel que soit ce qu'il écrit dans l'adresse ;
 * - sinon, la largeur à servir et, si l'image est recadrée, ses dimensions exactes et le point à garder.
 */
export type ImageVariant =
  | { redirect: string; cropped: boolean }
  | { width: number; ratio?: undefined }
  | { width: number; height: number; ratio: ImageRatio; focus: Focus | null }

export function imageVariant(query: { w?: unknown; r?: unknown; f?: unknown }, media: Sized): ImageVariant | null {
  const first = (v: unknown) => (Array.isArray(v) ? v[0] : v)
  const w = Number(first(query.w))
  if (!(w > 0)) return null
  const asked = first(query.r)
  const ratio = asked == null || asked === '' ? null : snapRatio(String(asked))
  const canonical = imageQuery(media, w, ratio)
  const given = `w=${first(query.w)}${asked !== undefined ? `&r=${asked}` : ''}${first(query.f) !== undefined ? `&f=${first(query.f)}` : ''}`
  if (given !== canonical) return { redirect: canonical, cropped: !!ratio || asked !== undefined || query.f !== undefined }
  const width = snapWidth(w)
  if (!ratio) return { width }
  return { ...cropSize(media, ratio, width), ratio, focus: normalizeFocus(media.focus) }
}
