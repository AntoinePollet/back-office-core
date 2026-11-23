import { resolve } from 'node:path'
import type { H3Event } from 'h3'
import { images } from '#cms-images'
import { diskBucket } from './node/disk-bucket'
import { s3Bucket } from './node/s3-bucket'
import { sqliteDatabase } from './node/sqlite'
import type { Bucket, Platform } from './types'

/**
 * Hébergement sur un serveur Node ordinaire (Docker, VPS, machine du client…) :
 * - base : un fichier SQLite, `<dossier de données>/cms.sqlite` ;
 * - fichiers : le dossier `<dossier de données>/media`, ou un stockage compatible S3 si `NUXT_S3_ENDPOINT` et
 *   `NUXT_S3_BUCKET` sont renseignés ;
 * - images : sharp, s'il est installé dans le projet du site ;
 * - pas de cache partagé à vider ; les tâches planifiées sont déclenchées par le core lui-même.
 *
 * Le dossier de données (`NUXT_DATA_DIR`, par défaut `.data`) est à conserver : c'est le volume du conteneur.
 */

type Settings = {
  dataDir?: string
  s3Endpoint?: string; s3Bucket?: string; s3BackupBucket?: string; s3Region?: string; s3AccessKeyId?: string; s3SecretAccessKey?: string
  trustProxy?: boolean | string
}

const settings = (event?: H3Event) => useRuntimeConfig(event) as unknown as Settings
const dataDir = (event?: H3Event) => resolve(String(settings(event).dataDir || '.data'))

const buckets = new Map<string, Bucket>()
const once = (id: string, create: () => Bucket) => buckets.get(id) ?? buckets.set(id, create()).get(id)!

/** Le stockage S3 nommé, ou `undefined` si le site range ses fichiers sur le disque. */
function s3(event: H3Event, bucket: string | undefined) {
  const config = settings(event)
  if (!config.s3Endpoint || !bucket) return undefined
  if (!config.s3AccessKeyId || !config.s3SecretAccessKey)
    throw createError({ statusCode: 500, message: 'Stockage S3 : les variables NUXT_S3_ACCESS_KEY_ID et NUXT_S3_SECRET_ACCESS_KEY manquent.' })
  const options = { endpoint: config.s3Endpoint, bucket, region: config.s3Region || 'us-east-1', accessKeyId: config.s3AccessKeyId, secretAccessKey: config.s3SecretAccessKey }
  return once(`s3:${options.endpoint}:${bucket}:${options.accessKeyId}`, () => s3Bucket(options))
}

const media = (event: H3Event) => s3(event, settings(event).s3Bucket) ?? once(`disk:${dataDir(event)}`, () => diskBucket(resolve(dataDir(event), 'media')))

/**
 * Un réglage S3 à moitié rempli rangerait les fichiers et les sauvegardes sur le disque sans rien dire : le serveur
 * refuse de démarrer et nomme ce qui manque.
 */
function checkS3() {
  const config = settings()
  const given = [config.s3Endpoint, config.s3Bucket, config.s3BackupBucket, config.s3AccessKeyId, config.s3SecretAccessKey]
  if (!given.some(Boolean)) return
  const missing = [
    !config.s3Endpoint && 'NUXT_S3_ENDPOINT',
    !config.s3Bucket && !config.s3BackupBucket && 'NUXT_S3_BUCKET (ou NUXT_S3_BACKUP_BUCKET)',
    !config.s3AccessKeyId && 'NUXT_S3_ACCESS_KEY_ID',
    !config.s3SecretAccessKey && 'NUXT_S3_SECRET_ACCESS_KEY',
  ].filter(Boolean)
  if (missing.length) throw new Error(`[cms] Stockage S3 incomplet, il manque : ${missing.join(', ')}. Renseignez-les, ou videz toutes les variables NUXT_S3_* pour ranger les fichiers sur le disque.`)
}

/**
 * Derrière un serveur frontal (Caddy, Nginx, Traefik…), l'adresse du visiteur est dans `X-Forwarded-For`.
 * `NUXT_TRUST_PROXY=true` la fait lire ; un nombre indique combien de serveurs frontaux se suivent (`true` = 1).
 * Chaque serveur frontal ajoute à la fin de la liste l'adresse qu'il a vue : on lit donc en partant de la fin,
 * jamais le début, que le visiteur peut écrire lui-même. Sans serveur frontal, l'en-tête entier vient du visiteur
 * et ne doit pas être cru : c'est l'adresse de la connexion qui compte.
 */
function clientIp(event: H3Event) {
  const trust = settings(event).trustProxy
  const hops = trust === true || trust === 'true' ? 1 : Math.max(0, Math.floor(Number(trust)) || 0)
  if (hops) {
    const list = (getRequestHeader(event, 'x-forwarded-for') ?? '').split(',').map(part => part.trim()).filter(Boolean)
    const ip = list[Math.max(0, list.length - hops)]
    if (ip) return ip
  }
  return getRequestIP(event)
}

export const platform: Platform = {
  name: 'node',
  database: event => sqliteDatabase(resolve(dataDir(event), 'cms.sqlite')),
  mediaBucket: media,
  /** Le bucket `NUXT_S3_BACKUP_BUCKET` s'il est renseigné, sinon le stockage de la médiathèque. */
  backupBucket(event) {
    const dedicated = s3(event, settings(event).s3BackupBucket)
    return { bucket: dedicated ?? media(event), dedicated: !!dedicated }
  },
  images: () => images,
  sharedCache: false,
  cachePurger: () => undefined,
  clientIp,
  ownScheduler: true,
  /** La base est ouverte et mise à niveau tout de suite : une migration qui échoue arrête le démarrage, bien en vue. */
  start() {
    checkS3()
    sqliteDatabase(resolve(dataDir(), 'cms.sqlite'))
  },
}
