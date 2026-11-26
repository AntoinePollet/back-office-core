import { createReadStream, promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { isPlainKey } from '../../../shared/media'
import type { Bucket, BucketOptions } from '../types'

/**
 * Stockage de fichiers dans un dossier du serveur, sous la forme de R2. Chaque fichier est rangé à sa clé
 * (`<dossier>/<identifiant>/<nom>`) ; son type est noté à côté, dans `.meta/`. Un fichier s'écrit d'abord dans
 * `.tmp/`, puis prend sa place d'un coup : un envoi interrompu ne laisse pas de fichier à moitié écrit.
 */

const RESERVED = ['.meta', '.tmp']

/** Les morceaux d'une clé, ou null si elle sortirait du dossier ou toucherait aux dossiers internes. */
function segments(key: string) {
  const parts = key.split('/')
  if (!isPlainKey(key) || RESERVED.includes(parts[0]!)) return null
  return parts
}

const toBytes = async (value: ArrayBuffer | ArrayBufferView | ReadableStream | string) =>
  typeof value === 'string' ? Buffer.from(value)
    : value instanceof ArrayBuffer ? new Uint8Array(value)
      : ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        : new Uint8Array(await new Response(value).arrayBuffer())

const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT'

/** Lit le fichier seulement quand la réponse commence à être envoyée : un objet demandé puis ignoré n'ouvre rien. */
function fileStream(path: string): ReadableStream<Uint8Array> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      reader ??= (Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>).getReader()
      const { done, value } = await reader.read()
      if (done) controller.close()
      else controller.enqueue(value)
    },
    cancel: reason => reader?.cancel(reason),
  }, { highWaterMark: 0 })
}

export function diskBucket(root: string): Bucket {
  const fileOf = (parts: string[]) => join(root, ...parts)
  const metaOf = (parts: string[]) => `${join(root, '.meta', ...parts)}.json`
  const located = (key: string) => {
    const parts = segments(key)
    if (!parts) throw new Error(`[cms] clé de fichier refusée : ${JSON.stringify(key)}`)
    return parts
  }
  const temporary = async () => {
    await fs.mkdir(join(root, '.tmp'), { recursive: true })
    return join(root, '.tmp', randomUUID())
  }
  /** Met un fichier temporaire à sa place définitive et note son type. */
  const settle = async (temp: string, parts: string[], options?: BucketOptions) => {
    await fs.mkdir(dirname(fileOf(parts)), { recursive: true })
    await fs.mkdir(dirname(metaOf(parts)), { recursive: true })
    await fs.writeFile(metaOf(parts), JSON.stringify({ contentType: options?.httpMetadata?.contentType ?? null }))
    await fs.rename(temp, fileOf(parts))
  }
  /** Retire les dossiers devenus vides, sans jamais retirer la racine. */
  const prune = async (path: string, stop: string) => {
    for (let dir = dirname(path); dir.length > stop.length && dir.startsWith(stop); dir = dirname(dir)) {
      if (!await fs.rmdir(dir).then(() => true, () => false)) return
    }
  }
  const walk = async (dir: string, prefix: string, out: { key: string; size: number; uploaded: Date }[]) => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch((error) => { if (missing(error)) return []; throw error })
    for (const entry of entries) {
      if (!prefix && RESERVED.includes(entry.name)) continue
      const key = prefix + entry.name
      if (entry.isDirectory()) await walk(join(dir, entry.name), `${key}/`, out)
      else if (entry.isFile()) {
        const stat = await fs.stat(join(dir, entry.name)).catch(() => null)
        if (stat) out.push({ key, size: stat.size, uploaded: stat.mtime })
      }
    }
  }

  return {
    async get(key) {
      const parts = segments(key)
      if (!parts) return null
      const stat = await fs.stat(fileOf(parts)).catch(() => null)
      if (!stat?.isFile()) return null
      const meta = await fs.readFile(metaOf(parts), 'utf8').then(text => JSON.parse(text) as { contentType?: string | null }, () => ({} as { contentType?: string | null }))
      return {
        body: fileStream(fileOf(parts)),
        size: stat.size,
        httpEtag: `"${stat.size.toString(16)}-${Math.round(stat.mtimeMs).toString(16)}"`,
        httpMetadata: { contentType: meta.contentType ?? undefined },
      }
    },
    async put(key, value, options) {
      const parts = located(key)
      const temp = await temporary()
      try {
        await fs.writeFile(temp, await toBytes(value))
        await settle(temp, parts, options)
      }
      catch (error) {
        await fs.rm(temp, { force: true })
        throw error
      }
    },
    async delete(key) {
      for (const one of [key].flat()) {
        const parts = segments(one)
        if (!parts) continue
        await fs.rm(fileOf(parts), { force: true })
        await fs.rm(metaOf(parts), { force: true })
        await prune(fileOf(parts), root)
        await prune(metaOf(parts), join(root, '.meta'))
      }
    },
    async list({ prefix = '' }) {
      const objects: { key: string; size: number; uploaded: Date }[] = []
      await walk(root, '', objects)
      return { objects: objects.filter(o => o.key.startsWith(prefix)).sort((a, b) => (a.key < b.key ? -1 : 1)), truncated: false }
    },
    async createMultipartUpload(key, options) {
      const parts = located(key)
      const temp = await temporary()
      await fs.writeFile(temp, '')
      return {
        async uploadPart(partNumber, value) {
          await fs.appendFile(temp, await toBytes(value))
          return { partNumber, etag: String(partNumber) }
        },
        complete: () => settle(temp, parts, options),
        abort: () => fs.rm(temp, { force: true }),
      }
    },
  }
}
