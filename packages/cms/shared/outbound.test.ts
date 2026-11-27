import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import { MAX_REDIRECTS, PrivateAddressError, fetchPublic } from './outbound.ts'

/** Un petit serveur local, joignable par `127.0.0.1` (tenu ici pour public) et par `localhost` (tenu pour privé). */
async function server(handle: (req: IncomingMessage, res: ServerResponse) => void) {
  const seen: string[] = []
  const http = createServer((req, res) => { seen.push(`${req.method} ${req.url}`); handle(req, res) })
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve))
  const port = (http.address() as AddressInfo).port
  return { seen, port, open: `http://127.0.0.1:${port}`, closed: `http://localhost:${port}`, close: () => new Promise(resolve => http.close(resolve)) }
}
const guard = { isPrivate: (host: string) => host === 'localhost' || host === '10.0.0.7' }

test('une adresse privée n\'est jamais appelée', async () => {
  const s = await server((_, res) => res.end('ok'))
  await assert.rejects(() => fetchPublic(`${s.closed}/x`, {}, guard), PrivateAddressError)
  assert.deepEqual(s.seen, [])
  // La règle du core, sans rien préciser : la machine elle-même, un réseau privé, le service de métadonnées.
  for (const url of ['http://localhost/', 'http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data', 'http://10.1.2.3/', 'http://[::1]/', 'http://2130706433/'])
    await assert.rejects(() => fetchPublic(url), PrivateAddressError, url)
  await assert.rejects(() => fetchPublic('file:///etc/passwd'), TypeError)
  // En développement et dans les tests, une adresse de la machine est permise.
  assert.equal(await (await fetchPublic(`${s.closed}/x`, {}, { ...guard, allowLocal: true })).text(), 'ok')
  await s.close()
})

test('une redirection vers une adresse privée n\'est pas suivie', async () => {
  const s = await server((req, res) => {
    if (req.url === '/piege') { res.writeHead(302, { location: `http://localhost:${s.port}/interne` }); return res.end() }
    if (req.url === '/detour') { res.writeHead(301, { location: '/arrivee' }); return res.end() }
    res.end(`arrivé à ${req.url}`)
  })
  await assert.rejects(() => fetchPublic(`${s.open}/piege`, {}, guard), PrivateAddressError)
  assert.deepEqual(s.seen, ['GET /piege'], 'l\'adresse interne n\'a pas été appelée')
  // Une redirection ordinaire est suivie, adresse relative comprise.
  assert.equal(await (await fetchPublic(`${s.open}/detour`, {}, guard)).text(), 'arrivé à /arrivee')
  await s.close()
})

test('un nom de domaine qui désigne une adresse privée est refusé', async () => {
  const s = await server((_, res) => res.end('ok'))
  const resolve = async (host: string) => (host === '127.0.0.1' ? ['10.0.0.7'] : [])
  await assert.rejects(() => fetchPublic(`${s.open}/x`, {}, { ...guard, resolve }), PrivateAddressError)
  assert.deepEqual(s.seen, [])
  // Un nom que l'hébergement ne sait pas résoudre n'empêche rien : l'appel répond de lui-même.
  assert.equal((await fetchPublic(`${s.open}/x`, {}, { ...guard, resolve: async () => { throw new Error('ENOTFOUND') } })).status, 200)
  await s.close()
})

test('redirections : comme un navigateur, et en nombre limité', async () => {
  const s = await server((req, res) => {
    if (req.url === '/303' || req.url === '/302') { res.writeHead(Number(req.url.slice(1)), { location: '/fin' }); return res.end() }
    if (req.url === '/307') { res.writeHead(307, { location: '/fin' }); return res.end() }
    if (req.url === '/boucle') { res.writeHead(302, { location: '/boucle' }); return res.end() }
    res.end()
  })
  const post = { method: 'POST', body: '{"a":1}', headers: { 'content-type': 'application/json' } }
  for (const [start, then] of [['/303', 'GET /fin'], ['/302', 'GET /fin'], ['/307', 'POST /fin']] as const) {
    s.seen.length = 0
    await fetchPublic(s.open + start, post, guard)
    assert.deepEqual(s.seen, [`POST ${start}`, then])
  }
  s.seen.length = 0
  await assert.rejects(() => fetchPublic(`${s.open}/boucle`, {}, guard), /Trop de redirections/)
  assert.equal(s.seen.length, MAX_REDIRECTS + 1)
  await s.close()
})
