import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { diskBucket } from './disk-bucket'

const temp = () => mkdtempSync(join(tmpdir(), 'cms-disk-bucket-'))
const text = async (object: { body: ReadableStream<Uint8Array> }) => new TextDecoder().decode(await new Response(object.body).arrayBuffer())

test('écrire, lire, lister, supprimer', async () => {
  const dir = temp()
  const bucket = diskBucket(dir)
  const key = 'abc-123/Photo d\'été & co (1).txt'
  assert.equal(await bucket.get(key), null)
  await bucket.put(key, new TextEncoder().encode('bonjour'), { httpMetadata: { contentType: 'text/plain' } })
  const got = (await bucket.get(key))!
  assert.equal(got.size, 7)
  assert.equal(got.httpMetadata?.contentType, 'text/plain')
  assert.match(got.httpEtag, /^"[0-9a-f]+-[0-9a-f]+"$/)
  assert.equal(await text(got), 'bonjour')
  // Un objet demandé puis abandonné ne bloque rien.
  await (await bucket.get(key))!.body.cancel()

  await bucket.put('_sauvegardes/petit.gz', 'x', { httpMetadata: { contentType: 'application/gzip' } })
  const listed = await bucket.list({ prefix: '_sauvegardes/' })
  assert.deepEqual(listed.objects.map(o => o.key), ['_sauvegardes/petit.gz'])
  assert.ok(listed.objects[0]!.uploaded instanceof Date && listed.objects[0]!.size === 1 && !listed.truncated)
  // Les dossiers internes ne sont jamais listés.
  assert.deepEqual((await bucket.list({})).objects.map(o => o.key).sort(), ['_sauvegardes/petit.gz', key].sort())

  await bucket.delete([key, '_sauvegardes/petit.gz', 'inexistant/x'])
  assert.equal(await bucket.get(key), null)
  assert.deepEqual((await bucket.list({})).objects, [])
  // Les dossiers vidés sont retirés, pas la racine.
  assert.ok(existsSync(dir) && !readdirSync(dir).includes('abc-123') && !readdirSync(dir).includes('_sauvegardes'))
  rmSync(dir, { recursive: true })
})

test('envoi par morceaux : visible seulement une fois terminé', async () => {
  const dir = temp()
  const bucket = diskBucket(dir)
  const part = new Uint8Array(1024 * 1024).fill(65)
  const upload = await bucket.createMultipartUpload('_sauvegardes/gros.gz', { httpMetadata: { contentType: 'application/gzip' } })
  const parts = [await upload.uploadPart(1, part), await upload.uploadPart(2, part), await upload.uploadPart(3, new Uint8Array(10).fill(66))]
  assert.equal(await bucket.get('_sauvegardes/gros.gz'), null, 'pas encore visible')
  await upload.complete(parts)
  const big = (await bucket.get('_sauvegardes/gros.gz'))!
  assert.equal(big.size, 2 * 1024 * 1024 + 10)
  assert.equal(big.httpMetadata?.contentType, 'application/gzip')
  const bytes = new Uint8Array(await new Response(big.body).arrayBuffer())
  assert.deepEqual([bytes.length, bytes[0], bytes.at(-1)], [big.size, 65, 66])

  const aborted = await bucket.createMultipartUpload('_sauvegardes/abandon.gz')
  await aborted.uploadPart(1, part)
  await aborted.abort()
  assert.deepEqual((await bucket.list({})).objects.map(o => o.key), ['_sauvegardes/gros.gz'])
  assert.deepEqual(readdirSync(join(dir, '.tmp')), [], 'aucun fichier temporaire oublié')
  rmSync(dir, { recursive: true })
})

test('une clé ne sort jamais du dossier', async () => {
  const dir = temp()
  const bucket = diskBucket(join(dir, 'media'))
  for (const bad of ['../x', 'a/../../x', '.meta/x', '.tmp/x', '/abs', 'a//b', 'a/./b', 'a\\b', '']) {
    assert.equal(await bucket.get(bad), null, bad)
    await assert.rejects(() => bucket.put(bad, 'x'), /clé de fichier refusée/, bad)
    await assert.rejects(() => bucket.createMultipartUpload(bad), /clé de fichier refusée/, bad)
    await bucket.delete(bad)
  }
  assert.deepEqual(readdirSync(dir).filter(name => name !== 'media'), [], 'rien n\'a été écrit hors du dossier')
  rmSync(dir, { recursive: true })
})
