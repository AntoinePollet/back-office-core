import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import { s3Bucket } from './s3-bucket'

/** Un faux service S3 : note chaque demande reçue et répond toujours 200. */
async function fakeS3() {
  const seen: string[] = []
  const server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`)
    res.writeHead(200, { 'content-type': 'application/xml', 'content-length': 5 })
    res.end('<ok/>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { seen, bucket: s3Bucket({ endpoint, bucket: 'media', region: 'us-east-1', accessKeyId: 'AK', secretAccessKey: 'SK' }), close: () => new Promise(resolve => server.close(resolve)) }
}

test('une clé bien formée est demandée telle quelle, caractères spéciaux encodés', async () => {
  const s3 = await fakeS3()
  const got = await s3.bucket.get('abc-123/Photo d\'été & co (1).txt')
  await got?.body.cancel()
  assert.deepEqual(s3.seen, ['GET /media/abc-123/Photo%20d\'%C3%A9t%C3%A9%20%26%20co%20(1).txt'])
  await s3.close()
})

test('une clé avec « . », « .. » ou un morceau vide n\'atteint jamais le service', async () => {
  const s3 = await fakeS3()
  // L'adresse serait résolue : `./_sauvegardes/x` deviendrait `_sauvegardes/x`, `.` la liste du bucket, `..` un autre bucket.
  const refused = ['.', '..', './_sauvegardes/x.ndjson.gz', 'a/../_sauvegardes/x.ndjson.gz', '../autre-bucket/x', 'a//b', '/a', 'a/', '']
  for (const key of refused) {
    assert.equal(await s3.bucket.get(key), null, `lecture de ${JSON.stringify(key)}`)
    await s3.bucket.delete(key)
    await assert.rejects(() => s3.bucket.put(key, 'x') as Promise<unknown>, /clé de fichier refusée/, `écriture de ${JSON.stringify(key)}`)
    await assert.rejects(() => s3.bucket.createMultipartUpload(key), /clé de fichier refusée/, `envoi par morceaux de ${JSON.stringify(key)}`)
  }
  assert.deepEqual(s3.seen, [])
  await s3.close()
})
