import { isPrivateKey } from '../../../shared/backup'
import { eq } from 'drizzle-orm'
import { RESIZABLE_TYPES, cropRect, imageQuery, imageVariant, isPlainKey } from '../../../shared/media'
import { canSeeTrashItem } from '../../../shared/trash'
import type { ImagesBinding } from '../../platform/types'

/**
 * Recadrage autour du point d'intérêt avec le moteur local de wrangler, qui ne connaît de `gravity` que les bords
 * (`left`, `right`, `top`, `bottom`) et ignore les coordonnées : on coupe en deux passes, un côté puis l'autre, pour
 * obtenir le même rectangle que Cloudflare en ligne (`cropRect`). Sert seulement au développement et aux tests.
 */
async function cropLocally(images: ImagesBinding, body: ReadableStream, source: { width: number; height: number }, crop: { width: number; height: number }, rect: { left: number; top: number; width: number; height: number }, output: { format: string; quality: number }) {
  const horizontal = rect.width < source.width
  // Première passe, sans perte de taille : on retire ce qui dépasse à droite (ou en bas) du rectangle gardé.
  const kept = horizontal ? { width: rect.left + rect.width, height: source.height } : { width: source.width, height: rect.top + rect.height }
  const first = await images.input(body).transform({ ...kept, fit: 'cover', gravity: horizontal ? 'left' : 'top' }).output({ format: 'image/png', quality: 100 })
  // Seconde passe : on retire ce qui dépasse à gauche (ou en haut), à la taille demandée.
  return images.input(first.image()).transform({ ...crop, fit: 'cover', gravity: horizontal ? 'right' : 'bottom' }).output(output)
}

/**
 * Sert un fichier de la médiathèque depuis le stockage du site (R2 chez Cloudflare, disque ou S3 ailleurs).
 * L'adresse contient un identifiant unique : la réponse se garde sans limite.
 * Avec `?w=800`, une image est réduite à cette largeur et convertie en WebP si le navigateur l'accepte.
 * Avec `?w=800&r=16x9`, elle est en plus recadrée à ces proportions autour du point d'intérêt du fichier.
 * Seules les largeurs et proportions des listes fermées de shared/media.ts sont servies (voir `imageVariant`).
 */
export default defineEventHandler(async (event) => {
  let key = ''
  try { key = decodeURIComponent(getRouterParam(event, 'key') ?? '') }
  catch { /* adresse mal écrite : aucun fichier ne porte cette clé */ }
  // Seule une clé bien formée est cherchée : avec `./` ou `../`, le stockage désignerait un autre fichier que celui
  // contrôlé ici. Les sauvegardes sont rangées dans le même stockage : elles ne se lisent jamais par l'adresse publique.
  if (!isPlainKey(key) || isPrivateKey(key)) throw createError({ statusCode: 404, message: 'Fichier introuvable.' })
  const bucket = useBucket(event)
  // Un fichier à la corbeille n'est plus servi au public. Seul l'écran « Corbeille » l'affiche encore (`?corbeille=1`),
  // à une personne connectée qui a le droit de l'y voir, et sans mise en cache.
  const trashed = await trashedMedia(event, key)
  if (trashed && !(getQuery(event).corbeille && await requireUser(event).then(user => canSeeTrashItem(user, { kind: 'media' }), () => false)))
    throw createError({ statusCode: 404, message: 'Fichier introuvable.' })
  const object = await bucket.get(key)
  if (!object) throw createError({ statusCode: 404, message: 'Fichier introuvable.' })

  const type = object.httpMetadata?.contentType ?? 'application/octet-stream'
  const common = {
    'cache-control': trashed ? NO_CACHE : 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  }
  const images = usePlatform().images(event)
  const query = getQuery(event)

  if (Number(query.w) > 0 && RESIZABLE_TYPES.includes(type)) {
    // Un recadrage dépend du fichier (dimensions, point d'intérêt) : on le relit. Une simple réduction, non.
    const cropping = query.r !== undefined || query.f !== undefined
    const [row] = cropping && !trashed
      ? await useDb(event).select({ key: schema.media.key, width: schema.media.width, height: schema.media.height, focus: schema.media.focus }).from(schema.media).where(eq(schema.media.id, key.split('/')[0] ?? ''))
      : []
    const media = row?.key === key ? row : { width: null, height: null, focus: null }
    const found = imageVariant(query, media)!
    // Une demande hors liste (largeur, proportions) ou dont le point d'intérêt n'est pas celui du fichier est ramenée
    // à la seule adresse de cette version, par redirection : une seule image calculée par version. Même règle pour un
    // paramètre en double ou inconnu : l'adresse reçue doit être exactement celle de la version.
    const url = getRequestURL(event)
    const exact = 'redirect' in found ? found.redirect : imageQuery(media, Number(query.w), found.ratio)
    if ('redirect' in found || url.search.replace(/&corbeille=[^&]*$/, '') !== `?${exact}`) {
      await object.body.cancel().catch(() => {})
      // L'adresse d'un recadrage change avec le point d'intérêt : sa redirection ne se garde pas.
      return sendRedirect(event, `${url.pathname}?${exact}`, cropping ? 302 : 301)
    }
    const variant = found
    if (images) {
      try {
        // Le format dépend du navigateur : `Vary` fait garder une version par cas.
        const webp = (getRequestHeader(event, 'accept') ?? '').includes('image/webp')
        const output = { format: webp ? 'image/webp' : type === 'image/png' ? 'image/png' : 'image/jpeg', quality: 82 }
        let result
        if (!variant.ratio) {
          result = await images.input(object.body).transform({ width: variant.width, fit: 'scale-down' }).output(output) // ne jamais agrandir une petite image
        }
        else {
          const crop = { width: variant.width, height: variant.height }
          const rect = cropRect(media, variant.ratio)
          // `cover` remplit exactement les dimensions demandées (calculées pour ne jamais agrandir) ; `gravity` garde
          // le point d'intérêt à la même position relative dans le cadre que dans l'image.
          result = import.meta.dev && usePlatform().name === 'cloudflare' && variant.focus && rect && media.width && media.height
            ? await cropLocally(images, object.body, { width: media.width, height: media.height }, crop, rect, output)
            : await images.input(object.body).transform({ ...crop, fit: 'cover', ...(variant.focus ? { gravity: variant.focus } : {}) }).output(output)
          // Le cadrage servi, pour le vérifier d'un coup d'œil (`curl -I`) : en ligne, ce sont les paramètres transmis au service d'images.
          setResponseHeader(event, 'x-cms-image', `width=${crop.width},height=${crop.height},fit=cover${variant.focus ? `,gravity=${variant.focus.x}x${variant.focus.y}` : ''}`)
        }
        setResponseHeaders(event, { ...common, 'content-type': result.contentType(), 'vary': 'Accept' })
        return result.image()
      }
      catch (error) {
        // Une image que le service ne sait pas traiter reste affichable : on sert l'originale.
        console.error('[cms] redimensionnement impossible, image d\'origine servie', error)
        const original = await bucket.get(key)
        if (!original) throw createError({ statusCode: 404, message: 'Fichier introuvable.' })
        removeResponseHeader(event, 'x-cms-image')
        setResponseHeaders(event, { ...common, 'content-type': type, 'cache-control': trashed ? NO_CACHE : 'public, max-age=300' })
        return original.body
      }
    }
  }

  setResponseHeaders(event, {
    ...common,
    'content-type': type,
    'content-length': object.size,
    'etag': object.httpEtag,
    // Un SVG peut contenir du script : il est servi sans droit d'exécution.
    ...(type === 'image/svg+xml' ? { 'content-security-policy': 'default-src \'none\'; style-src \'unsafe-inline\'; sandbox' } : {}),
  })
  return object.body
})
