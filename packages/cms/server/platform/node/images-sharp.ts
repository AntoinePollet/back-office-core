// sharp est facultatif (voir module.ts) : ce fichier n'est chargé que s'il est installé, mais il est relu par
// TypeScript dans tous les projets, y compris ceux qui ne l'ont pas.
// @ts-ignore
import sharp from 'sharp'
import { cropRect } from '../../../shared/media'
import type { ImagesBinding } from '../types'

/**
 * Redimensionnement des images avec sharp, sous la forme de la liaison Images de Cloudflare.
 * Un recadrage autour d'un point d'intérêt garde le même rectangle que Cloudflare (`cropRect`).
 */
export const images: ImagesBinding | undefined = {
  input: stream => ({
    transform: options => ({
      async output({ format, quality }) {
        const source = Buffer.from(await new Response(stream).arrayBuffer())
        // `rotate()` sans angle : l'image est d'abord redressée selon son orientation (photo prise téléphone tourné).
        let image = sharp(source).rotate()
        if (options.fit === 'scale-down' || !options.height) {
          image = image.resize({ width: options.width, height: options.height, fit: 'inside', withoutEnlargement: true })
        }
        else if (typeof options.gravity === 'object') {
          const meta = await sharp(source).metadata()
          const turned = (meta.orientation ?? 1) >= 5
          const size = { width: (turned ? meta.height : meta.width) ?? 0, height: (turned ? meta.width : meta.height) ?? 0 }
          const rect = cropRect({ ...size, focus: options.gravity }, options.width / options.height)
          if (rect) image = image.extract(rect)
          image = image.resize({ width: options.width, height: options.height, fit: rect ? 'fill' : 'cover' })
        }
        else {
          image = image.resize({ width: options.width, height: options.height, fit: 'cover', position: options.gravity ?? 'centre' })
        }
        const type = format === 'image/webp' || format === 'image/png' ? format : 'image/jpeg'
        const encoded = await (type === 'image/webp' ? image.webp({ quality }) : type === 'image/png' ? image.png() : image.jpeg({ quality })).toBuffer()
        return { image: () => new Response(new Uint8Array(encoded)).body!, contentType: () => type }
      },
    }),
  }),
}
