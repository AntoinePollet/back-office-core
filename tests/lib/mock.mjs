// Faux service HTTP : joue Brevo (/v3/smtp/email), Cloudflare (statistiques, Turnstile) et les adresses appelées
// par les workflows, et garde la trace des appels.
import http from 'node:http'
import { cloudflareGraphql, siteverify, TURNSTILE_SCRIPT } from './mock-cloudflare.mjs'

/**
 * - POST /v3/smtp/email → 201, comme Brevo
 * - GET /v3/account → le compte Brevo, ou 401 avec la clé « mauvaise-cle »
 * - POST /client/v4/graphql → statistiques Cloudflare Web Analytics (voir mock-cloudflare.mjs)
 * - POST /turnstile/v0/siteverify → vérification d'un jeton Turnstile ; GET /turnstile/v0/api.js → faux script Turnstile
 * - /echec → 500
 * - toute autre adresse → 200
 * - GET /_calls → les appels reçus (pour déboguer à la main)
 * - Stripe, sous /stripe : POST /stripe/v1/checkout/sessions → une session (cs_test_<n>) ; GET /stripe/v1/checkout/sessions →
 *   liste vide, 401 avec la clé « rk_test_mauvaise », 403 avec « rk_test_sans-droit » ; GET /stripe/checkout/<id> → la « page de paiement »
 * - GitHub (avis de nouvelle version) : GET /github/releases/latest → la dernière version publiée du core ;
 *   POST /github/_regler { tag, status, delay } change la suite des réponses (version, panne, lenteur en ms)
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
      catch { body = req.headers['content-type']?.includes('urlencoded') ? Object.fromEntries(new URLSearchParams(raw)) : raw }
      calls.push({ url: req.url, key: req.headers['api-key'] ?? req.headers.authorization?.replace(/^Bearer /, '') ?? null, auth: req.headers.authorization ?? null, version: req.headers['stripe-version'] ?? null, body })
      if (req.url.startsWith('/stripe/')) return stripe(req, res, body)
      if (req.url.startsWith('/github/')) return github(req, res, body)
      if (req.url === '/turnstile/v0/api.js') {
        res.setHeader('content-type', 'text/javascript')
        return res.end(TURNSTILE_SCRIPT)
      }
      if (req.url === '/turnstile/v0/siteverify') return res.end(JSON.stringify(siteverify(body)))
      if (req.url === '/client/v4/graphql') {
        const { status, json } = cloudflareGraphql(req.headers.authorization, body)
        res.statusCode = status
        return res.end(JSON.stringify(json))
      }
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
  // Stripe : les deux appels du module (créer une session, vérifier la clé) et la page de paiement où le site redirige.
  let sessions = 0
  function stripe(req, res, body) {
    const key = req.headers.authorization?.replace(/^Bearer /, '')
    if (req.url.startsWith('/stripe/checkout/')) { res.setHeader('content-type', 'text/html'); return res.end('<h1>Page de paiement Stripe (factice)</h1>') }
    if (key === 'rk_test_mauvaise') { res.statusCode = 401; return res.end('{"error":{"type":"invalid_request_error","message":"Invalid API Key provided"}}') }
    if (key === 'rk_test_sans-droit') { res.statusCode = 403; return res.end('{"error":{"type":"invalid_request_error","message":"The provided key does not have the required permissions"}}') }
    if (req.method === 'GET' && req.url.startsWith('/stripe/v1/checkout/sessions')) return res.end('{"object":"list","data":[],"has_more":false}')
    if (req.method === 'POST' && req.url === '/stripe/v1/checkout/sessions') {
      const id = `cs_test_session${String(++sessions).padStart(4, '0')}`
      return res.end(JSON.stringify({ id, object: 'checkout.session', url: `http://localhost:${port}/stripe/checkout/${id}`, amount_total: Number(body['line_items[0][price_data][unit_amount]']) * Number(body['line_items[0][quantity]']) }))
    }
    res.statusCode = 404
    res.end('{"error":{"message":"Unrecognized request URL"}}')
  }
  // GitHub : la dernière version publiée du core, réglable par la suite (voir 21-mises-a-jour).
  const release = { tag: 'v0.0.1', status: 200, delay: 0 }
  function github(req, res, body) {
    if (req.url === '/github/_regler') { Object.assign(release, body); return res.end('{}') }
    // Comme le vrai GitHub : pas de réponse sans en-tête User-Agent.
    if (!req.headers['user-agent']) { res.statusCode = 403; return res.end('{"message":"Request forbidden by administrative rules"}') }
    setTimeout(() => {
      res.statusCode = release.status
      if (release.status !== 200) return res.end('{"message":"API rate limit exceeded"}')
      res.end(JSON.stringify({ tag_name: release.tag, html_url: `https://github.com/exemple/core/releases/tag/${release.tag}`, draft: false, prerelease: false, body: 'Notes de version' }))
    }, release.delay)
  }
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
