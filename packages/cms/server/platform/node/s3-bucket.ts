import { AwsClient } from 'aws4fetch'
import { isPlainKey } from '../../../shared/media'
import type { Bucket, BucketListed } from '../types'

/**
 * Stockage de fichiers dans un service compatible S3 (MinIO, Scaleway, OVH, AWS, R2…), sous la forme de R2.
 * Les adresses sont du type `<adresse du service>/<bucket>/<clé>` (« path-style »), acceptées par tous ces services.
 *
 * Une adresse est résolue avant d'être envoyée : une clé `./x` y deviendrait `x`, `.` le bucket lui-même (sa liste),
 * et `../autre/x` un fichier d'un autre bucket. Seule une clé bien formée (`isPlainKey`) atteint donc le service :
 * lire une autre clé ne trouve rien, l'écrire est une erreur.
 */

export type S3Options = { endpoint: string; bucket: string; region: string; accessKeyId: string; secretAccessKey: string }

const toBytes = async (value: ArrayBuffer | ArrayBufferView | ReadableStream | string) =>
  typeof value === 'string' ? new TextEncoder().encode(value)
    : value instanceof ArrayBuffer ? new Uint8Array(value)
      : ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        : new Uint8Array(await new Response(value).arrayBuffer())

const unescapeXml = (text: string) => text.replace(/&(lt|gt|quot|apos|amp);/g, (_, name: string) => ({ lt: '<', gt: '>', quot: '"', apos: '\'', amp: '&' })[name]!)
const escapeXml = (text: string) => text.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', '\'': '&apos;' })[c]!)
const tag = (xml: string, name: string) => { const found = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)); return found ? unescapeXml(found[1]!) : undefined }

export function s3Bucket(options: S3Options): Bucket {
  const client = new AwsClient({ accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey, service: 's3', region: options.region })
  const base = `${options.endpoint.replace(/\/+$/, '')}/${encodeURIComponent(options.bucket)}`
  const urlOf = (key: string, query = '') => {
    if (!isPlainKey(key)) throw new Error(`[cms] clé de fichier refusée : ${JSON.stringify(key)}`)
    return `${base}/${key.split('/').map(encodeURIComponent).join('/')}${query}`
  }

  /** Appelle le service ; toute réponse en erreur (hors celles de `accepted`) lève une erreur lisible dans les journaux. */
  const call = async (what: string, url: string, init: RequestInit = {}, accepted: number[] = []) => {
    const response = await client.fetch(url, init)
    if (!response.ok && !accepted.includes(response.status)) {
      const detail = await response.text().catch(() => '')
      throw new Error(`[cms] stockage S3 : ${what} a échoué (${response.status}) ${tag(detail, 'Code') ?? ''} ${tag(detail, 'Message') ?? ''}`.trim())
    }
    return response
  }

  return {
    async get(key) {
      if (!isPlainKey(key)) return null
      const response = await call('la lecture', urlOf(key), {}, [404])
      if (response.status === 404 || !response.body) {
        await response.body?.cancel().catch(() => {})
        return null
      }
      return {
        body: response.body,
        size: Number(response.headers.get('content-length') ?? 0),
        httpEtag: response.headers.get('etag') ?? '',
        httpMetadata: { contentType: response.headers.get('content-type') ?? undefined },
      }
    },
    async put(key, value, putOptions) {
      const type = putOptions?.httpMetadata?.contentType
      await call('l\'écriture', urlOf(key), { method: 'PUT', body: await toBytes(value) as BodyInit, headers: type ? { 'content-type': type } : {} })
    },
    async delete(key) {
      // Un fichier déjà absent n'est pas une erreur.
      for (const one of [key].flat()) if (isPlainKey(one)) await call('la suppression', urlOf(one), { method: 'DELETE' }, [404])
    },
    async list({ prefix, cursor, limit }) {
      const query = new URLSearchParams({ 'list-type': '2', 'encoding-type': 'url' })
      if (prefix) query.set('prefix', prefix)
      if (cursor) query.set('continuation-token', cursor)
      if (limit) query.set('max-keys', String(limit))
      const xml = await (await call('la liste des fichiers', `${base}?${query}`)).text()
      const objects: BucketListed[] = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map(([, item]) => ({
        // Les clés sont demandées encodées (`encoding-type=url`) : un nom avec des caractères spéciaux reste lisible.
        key: decodeURIComponent((tag(item!, 'Key') ?? '').replace(/\+/g, ' ')),
        size: Number(tag(item!, 'Size') ?? 0),
        uploaded: new Date(tag(item!, 'LastModified') ?? 0),
      }))
      const truncated = tag(xml, 'IsTruncated') === 'true'
      return { objects, truncated, cursor: truncated ? tag(xml, 'NextContinuationToken') : undefined }
    },
    async createMultipartUpload(key, uploadOptions) {
      const type = uploadOptions?.httpMetadata?.contentType
      const created = await (await call('l\'ouverture d\'un envoi par morceaux', urlOf(key, '?uploads='), { method: 'POST', headers: type ? { 'content-type': type } : {} })).text()
      const uploadId = tag(created, 'UploadId')
      if (!uploadId) throw new Error('[cms] stockage S3 : envoi par morceaux refusé (pas d\'identifiant d\'envoi dans la réponse).')
      const id = `uploadId=${encodeURIComponent(uploadId)}`
      return {
        async uploadPart(partNumber, value) {
          const response = await call(`l'envoi du morceau ${partNumber}`, urlOf(key, `?partNumber=${partNumber}&${id}`), { method: 'PUT', body: await toBytes(value) as BodyInit })
          await response.body?.cancel().catch(() => {})
          return { partNumber, etag: response.headers.get('etag') ?? '' }
        },
        async complete(parts) {
          const body = `<CompleteMultipartUpload>${parts.map(p => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${escapeXml(p.etag)}</ETag></Part>`).join('')}</CompleteMultipartUpload>`
          const text = await (await call('la fin de l\'envoi par morceaux', urlOf(key, `?${id}`), { method: 'POST', body, headers: { 'content-type': 'application/xml' } })).text()
          // Ce service répond parfois 200 avec une erreur dans le corps.
          if (/<Error>/.test(text)) throw new Error(`[cms] stockage S3 : la fin de l'envoi par morceaux a échoué (${tag(text, 'Code') ?? ''} ${tag(text, 'Message') ?? ''})`)
        },
        async abort() {
          await call('l\'abandon de l\'envoi par morceaux', urlOf(key, `?${id}`), { method: 'DELETE' }, [404])
        },
      }
    },
  }
}
