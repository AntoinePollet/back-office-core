import type { H3Event } from 'h3'
import type { Bucket, ImagesBinding, Platform, SqlDatabase } from './types'

/** Hébergement chez Cloudflare : base D1, stockage R2, service Images, cache du réseau. Tout vient des liaisons de wrangler.jsonc. */

type Env = { DB?: SqlDatabase; MEDIA?: Bucket; BACKUPS?: Bucket; IMAGES?: ImagesBinding }
type Purge = (options: { purgeEverything: true }) => Promise<{ success: boolean; errors?: unknown }>

const env = (event: H3Event) => event.context.cloudflare?.env as Env | undefined

export const platform: Platform = {
  name: 'cloudflare',
  database(event) {
    const d1 = env(event)?.DB
    if (!d1) throw createError({ statusCode: 500, message: 'Base D1 introuvable : la liaison « DB » manque dans wrangler.jsonc.' })
    return d1
  },
  mediaBucket(event) {
    const bucket = env(event)?.MEDIA
    if (!bucket) throw createError({ statusCode: 500, message: 'Bucket R2 introuvable : la liaison « MEDIA » manque dans wrangler.jsonc.' })
    return bucket
  },
  /** Le bucket `BACKUPS` s'il est déclaré dans wrangler.jsonc, sinon celui de la médiathèque. */
  backupBucket(event) {
    const bucket = env(event)?.BACKUPS ?? env(event)?.MEDIA
    if (!bucket) throw createError({ statusCode: 500, message: 'Stockage R2 introuvable : la liaison « MEDIA » manque dans wrangler.jsonc.' })
    return { bucket, dedicated: !!env(event)?.BACKUPS }
  },
  images: event => env(event)?.IMAGES,
  sharedCache: true,
  cachePurger(event) {
    const cache = (event.context.cloudflare?.context as { cache?: { purge?: Purge } } | undefined)?.cache
    return cache?.purge ? () => cache.purge!({ purgeEverything: true }) : undefined
  },
  clientIp: event => getRequestHeader(event, 'cf-connecting-ip') ?? getRequestIP(event),
  trustedHost: true,
  ownScheduler: false,
}
