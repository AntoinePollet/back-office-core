/**
 * Largeurs d'image servies par le site. La liste est fermée : chaque largeur demandée est une image
 * calculée puis gardée en cache, et une liste ouverte permettrait d'en faire fabriquer à l'infini.
 */
export const IMAGE_WIDTHS = [160, 320, 480, 640, 800, 1024, 1280, 1600, 1920, 2560] as const

/** Formats que l'on sait redimensionner. Les SVG, GIF animés et PDF sont servis tels quels. */
export const RESIZABLE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif']

/** Plus petite largeur servie qui couvre la largeur voulue. */
export const snapWidth = (width: number) => IMAGE_WIDTHS.find(w => w >= width) ?? IMAGE_WIDTHS[IMAGE_WIDTHS.length - 1]!

type Resizable = { url: string; mime?: string; width?: number | null }

/** Adresse d'une image à une largeur donnée (arrondie à la largeur servie supérieure). */
export function cmsImageUrl(media: Resizable | null | undefined, width: number) {
  if (!media) return ''
  return media.mime && !RESIZABLE_TYPES.includes(media.mime) ? media.url : `${media.url}?w=${snapWidth(width)}`
}

/**
 * Liste des versions d'une image pour l'attribut `srcset` : le navigateur choisit la plus adaptée à l'écran.
 * On ne propose pas de version plus large que l'image d'origine.
 */
export function cmsImageSrcset(media: Resizable | null | undefined, maxWidth: number = IMAGE_WIDTHS[IMAGE_WIDTHS.length - 1]!) {
  if (!media || (media.mime && !RESIZABLE_TYPES.includes(media.mime))) return undefined
  const limit = Math.min(maxWidth, media.width ?? maxWidth)
  const widths = IMAGE_WIDTHS.filter(w => w < limit)
  // La dernière version couvre la largeur maximale utile.
  widths.push(snapWidth(limit) as never)
  return [...new Set(widths)].map(w => `${media.url}?w=${w} ${w}w`).join(', ')
}
