// Faux service HTTP : joue Brevo (/v3/smtp/email) et les adresses appelées par les workflows, et garde la trace des appels.
import http from 'node:http'

/**
 * - POST /v3/smtp/email → 201, comme Brevo
 * - GET /v3/account → le compte Brevo, ou 401 avec la clé « mauvaise-cle »
 * - /echec → 500
 * - toute autre adresse → 200
 * - GET /_calls → les appels reçus (pour déboguer à la main)
 */
export async function startMock(port) {
  const calls = []
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.url === '/_calls') return res.end(JSON.stringify(calls))
    let raw = ''
    req.on('data', c => raw += c)
    req.on('end', () => {
      let body = null
      try { body = JSON.parse(raw || 'null') }
      catch { body = raw }
      calls.push({ url: req.url, key: req.headers['api-key'] ?? null, body })
      if (req.url === '/echec') { res.statusCode = 500; return res.end('{}') }
      // Compte Brevo : sert à vérifier une clé d'API. « mauvaise-cle » est refusée, comme une clé inconnue de Brevo.
      if (req.url === '/v3/account') {
        if (req.headers['api-key'] === 'mauvaise-cle') { res.statusCode = 401; return res.end('{"code":"unauthorized","message":"Key not found"}') }
        return res.end('{"email":"contact@cabinet-durand.fr","companyName":"Cabinet Durand"}')
      }
      res.statusCode = req.url === '/v3/smtp/email' ? 201 : 200
      res.end('{"messageId":"test"}')
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', e => reject(e.code === 'EADDRINUSE' ? new Error(`Le port ${port} du faux service est déjà utilisé (E2E_MOCK_PORT pour en changer).`) : e))
    server.listen(port, resolve)
  })
  return {
    url: `http://localhost:${port}`,
    /** Copie des appels reçus jusqu'ici. */
    calls: () => [...calls],
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()) }),
  }
}
