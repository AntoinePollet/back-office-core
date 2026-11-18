import { IMAGE_WIDTHS, RESIZABLE_TYPES, snapWidth } from '../../../shared/media'

type ImagesBinding = {
  input: (stream: ReadableStream) => {
    transform: (options: { width: number; fit: 'scale-down' }) => {
      output: (options: { format: string; quality: number }) => Promise<{ image: () => ReadableStream; contentType: () => string }>
    }
  }
}

/**
 * Sert un fichier de la médiathèque depuis R2. L'adresse contient un identifiant unique : la réponse se garde sans limite.
 * Avec `?w=800`, une image est réduite à cette largeur et convertie en WebP si le navigateur l'accepte.
 */
export default defineEventHandler(async (event) => {
  const key = getRouterParam(event, 'key')
  const bucket = useBucket(event)
  const object = key ? await bucket.get(decodeURIComponent(key)) : null
  if (!object) throw createError({ statusCode: 404, message: 'Fichier introuvable.' })

  const type = object.httpMetadata?.contentType ?? 'application/octet-stream'
  const common = {
    'cache-control': 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  }
  const requested = Number(getQuery(event).w)
  const images = event.context.cloudflare?.env?.IMAGES as ImagesBinding | undefined

  if (requested > 0 && RESIZABLE_TYPES.includes(type)) {
    // Une largeur hors liste est ramenée à la largeur servie supérieure, par redirection : une seule adresse par version.
    if (!(IMAGE_WIDTHS as readonly number[]).includes(requested)) {
      await object.body.cancel().catch(() => {})
      return sendRedirect(event, `${getRequestURL(event).pathname}?w=${snapWidth(requested)}`, 301)
    }
    if (images) {
      try {
        // Le format dépend du navigateur : `Vary` fait garder une version par cas.
        const webp = (getRequestHeader(event, 'accept') ?? '').includes('image/webp')
        const result = await images.input(object.body)
          .transform({ width: requested, fit: 'scale-down' }) // ne jamais agrandir une petite image
          .output({ format: webp ? 'image/webp' : type === 'image/png' ? 'image/png' : 'image/jpeg', quality: 82 })
        setResponseHeaders(event, { ...common, 'content-type': result.contentType(), 'vary': 'Accept' })
        return result.image()
      }
      catch (error) {
        // Une image que le service ne sait pas traiter reste affichable : on sert l'originale.
        console.error('[cms] redimensionnement impossible, image d\'origine servie', error)
        const original = await bucket.get(decodeURIComponent(key!))
        if (!original) throw createError({ statusCode: 404, message: 'Fichier introuvable.' })
        setResponseHeaders(event, { ...common, 'content-type': type, 'cache-control': 'public, max-age=300' })
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
