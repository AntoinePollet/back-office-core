import type { H3Event } from 'h3'

/**
 * Ce que le core demande à son hébergement. Deux réponses existent : Cloudflare (`cloudflare.ts` : D1, R2, Images,
 * cache du réseau) et un serveur Node ordinaire (`node.ts` : fichier SQLite, disque ou stockage S3, sharp).
 * Le module choisit l'une ou l'autre à la construction du site (alias `#cms-platform`, voir module.ts).
 *
 * Les formes décrites ici sont celles de D1 et de R2 : c'est le serveur Node qui les imite, pas l'inverse.
 * Elles sont écrites à la main pour ne pas dépendre des types Cloudflare installés (ou non) dans le projet client.
 */

// ───────────── Base de données (forme de D1) ─────────────

export type SqlResult = { results?: Record<string, unknown>[]; meta?: { size_after?: number; changes?: number } }
export type SqlStatement = {
  bind: (...values: unknown[]) => SqlStatement
  all: () => Promise<SqlResult>
  run: () => Promise<SqlResult>
  /** Les lignes sous forme de tableaux de valeurs, dans l'ordre des colonnes (utilisé par Drizzle). */
  raw: () => Promise<unknown[][]>
}
export type SqlDatabase = {
  prepare: (sql: string) => SqlStatement
  /** Exécute les requêtes dans une seule transaction : tout réussit, ou rien n'est changé. */
  batch: (statements: SqlStatement[]) => Promise<SqlResult[]>
}

// ───────────── Stockage de fichiers (forme de R2) ─────────────

export type BucketOptions = { httpMetadata?: { contentType?: string } }
export type BucketObject = { body: ReadableStream<Uint8Array>; size: number; httpEtag: string; httpMetadata?: { contentType?: string } }
export type BucketPart = { partNumber: number; etag: string }
export type BucketListed = { key: string; size: number; uploaded: Date }
export type Bucket = {
  get: (key: string) => Promise<BucketObject | null>
  put: (key: string, value: ArrayBuffer | ArrayBufferView | ReadableStream | string, options?: BucketOptions) => Promise<unknown>
  delete: (key: string | string[]) => Promise<void>
  list: (options: { prefix?: string; cursor?: string; limit?: number }) => Promise<{ objects: BucketListed[]; truncated: boolean; cursor?: string }>
  /** Envoi d'un gros fichier par morceaux, donnés dans l'ordre. */
  createMultipartUpload: (key: string, options?: BucketOptions) => Promise<{
    uploadPart: (partNumber: number, value: ArrayBuffer | ArrayBufferView) => Promise<BucketPart>
    complete: (parts: BucketPart[]) => Promise<unknown>
    abort: () => Promise<void>
  }>
}

// ───────────── Redimensionnement d'images (forme de la liaison Images de Cloudflare) ─────────────

export type ImageTransform = { width: number; height?: number; fit: 'scale-down' | 'cover'; gravity?: { x: number; y: number } | 'left' | 'right' | 'top' | 'bottom' }
export type ImagesBinding = {
  input: (stream: ReadableStream) => {
    transform: (options: ImageTransform) => {
      output: (options: { format: string; quality: number }) => Promise<{ image: () => ReadableStream; contentType: () => string }>
    }
  }
}

// ───────────── L'hébergement ─────────────

export type Platform = {
  name: 'cloudflare' | 'node'
  database: (event: H3Event) => SqlDatabase
  /** Stockage de la médiathèque. */
  mediaBucket: (event: H3Event) => Bucket
  /** Stockage des sauvegardes : `dedicated` s'il est distinct de celui de la médiathèque. */
  backupBucket: (event: H3Event) => { bucket: Bucket; dedicated: boolean }
  /** Service de redimensionnement, ou `undefined` : les images sont alors servies dans leur taille d'origine. */
  images: (event: H3Event) => ImagesBinding | undefined
  /**
   * Vrai si un cache partagé, que le core sait vider, garde les pages du site (le réseau Cloudflare).
   * Sinon les pages ne sont gardées par aucun intermédiaire : il n'y a rien à vider.
   */
  sharedCache: boolean
  /** De quoi vider ce cache, ou `undefined` s'il n'y en a pas ici (en local par exemple). */
  cachePurger: (event: H3Event) => (() => Promise<{ success: boolean; errors?: unknown }>) | undefined
  /** Adresse IP du visiteur, telle que l'hébergement la donne de façon fiable. */
  clientIp: (event: H3Event) => string | undefined
  /** Vrai si le core doit déclencher lui-même les tâches planifiées (pas de déclencheur fourni par l'hébergeur). */
  ownScheduler: boolean
  /** Au démarrage du serveur : ce qui doit être prêt (ou échouer) avant la première requête. */
  start?: () => void
}
