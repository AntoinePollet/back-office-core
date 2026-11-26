import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  INITIAL_STATE, alertEmail, alertRecipients, browserFamily, checkVerdict, cleanBrowserError, errorFingerprint, formatDowntime, incidents, monitoringSettingsErrors, nextState,
  parseDsn, safePath, sentryAuth, sentryEnvelope, sentryFrames, serverError, topFrame, uptimePercent,
} from './monitoring.ts'

const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

test('réglages : adresse Sentry, destinataires, adresse à surveiller', () => {
  assert.deepEqual(parseDsn('https://abc123@o42.ingest.sentry.io/4507'), { key: 'abc123', host: 'o42.ingest.sentry.io', projectId: '4507', envelopeUrl: 'https://o42.ingest.sentry.io/api/4507/envelope/' })
  assert.equal(parseDsn('https://abc@sentry.exemple.fr/sous/dossier/7')!.envelopeUrl, 'https://sentry.exemple.fr/sous/dossier/api/7/envelope/')
  for (const bad of ['', 'abc', 'http://abc@o42.ingest.sentry.io/1', 'https://o42.ingest.sentry.io/1', 'https://abc@o42.ingest.sentry.io/projet']) assert.equal(parseDsn(bad), null, bad)
  assert.deepEqual(alertRecipients(' Claire@Exemple.fr, marc@exemple.fr ;'), ['claire@exemple.fr', 'marc@exemple.fr'])
  assert.deepEqual(monitoringSettingsErrors({ alertEmail: 'claire@exemple.fr', dsn: 'https://abc@o42.ingest.sentry.io/1', checkUrl: 'https://exemple.fr/' }), {})
  assert.deepEqual(Object.keys(monitoringSettingsErrors({ alertEmail: 'pas une adresse', dsn: 'x', checkUrl: 'http://exemple.fr' })).sort(), ['alertEmail', 'checkUrl', 'dsn'])
})

test('rien de personnel : adresse sans paramètres, famille du navigateur seulement', () => {
  assert.equal(safePath('https://site.fr/contact?email=a@b.fr#haut'), '/contact')
  assert.equal(safePath('/merci?session_id=cs_test_1'), '/merci')
  assert.equal(safePath(''), '/')
  assert.equal(browserFamily(CHROME), 'Chrome (macOS)')
  assert.equal(browserFamily('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'), 'Safari (iOS)')
  assert.equal(browserFamily('Mozilla/5.0 (compatible; Googlebot/2.1)'), 'Robot')
  assert.equal(browserFamily(undefined), '')
})

test('erreur du navigateur : contrôlée, tronquée ; bruit et robots écartés', () => {
  const ok = cleanBrowserError({ type: 'TypeError', message: 'x is not a function', stack: 'TypeError: x is not a function\n    at envoyer (https://site.fr/_nuxt/contact.a1b2c3d4.js:12:5)', path: 'https://site.fr/contact?nom=Jeanne' }, CHROME)!
  assert.deepEqual([ok.source, ok.type, ok.message, ok.path, ok.browser, ok.status], ['browser', 'TypeError', 'x is not a function', '/contact', 'Chrome (macOS)', null])
  assert.equal(cleanBrowserError({ message: 'm'.repeat(900), stack: 's'.repeat(9000) }, CHROME)!.message.length, 500)
  for (const noise of ['Script error.', '', 'ResizeObserver loop completed with undelivered notifications.', 'Failed to fetch', 'Load failed', 'The operation was aborted.'])
    assert.equal(cleanBrowserError({ message: noise }, CHROME), null, noise)
  assert.equal(cleanBrowserError({ message: 'x', stack: 'at f (chrome-extension://abc/content.js:1:1)' }, CHROME), null)
  assert.equal(cleanBrowserError({ message: 'x is not a function' }, 'Googlebot/2.1'), null)
  assert.equal(cleanBrowserError({ message: 42 }, CHROME), null)
  assert.equal(cleanBrowserError(null, CHROME), null)
})

test('erreur du serveur : l\'erreur d\'origine dit plus que son enveloppe', () => {
  const error = new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { name: 'ConnectError' }) })
  const captured = serverError(error, { path: '/api/content/services?page=2', method: 'get', status: 500 })
  assert.deepEqual([captured.source, captured.type, captured.message, captured.path, captured.method, captured.status], ['server', 'ConnectError', 'connect ECONNREFUSED 127.0.0.1:5432', '/api/content/services', 'GET', 500])
  assert.equal(serverError('texte brut', { path: '/', method: 'GET', status: null }).message, 'texte brut')
})

test('regroupement : même erreur malgré les nombres, les identifiants et les empreintes de fichier', () => {
  const at = (message: string, stack: string) => errorFingerprint({ source: 'server', type: 'Error', message, stack, path: '/a', method: 'GET', status: 500, browser: '' })
  const stack = (file: string, line: number) => `Error: x\n    at lire (${file}:${line}:9)\n    at suite (autre.js:1:1)`
  assert.equal(at('Contenu 42 introuvable', stack('/app/server/chunks/lire.js', 10)), at('Contenu 7 introuvable', stack('/app/server/chunks/lire.js', 10)))
  assert.equal(at('Session "abc" expirée', stack('lire-a1b2c3d4e5.mjs', 10)), at('Session "xyz" expirée', stack('lire-f6g7h8i9j0.mjs', 10)))
  assert.notEqual(at('Contenu introuvable', stack('lire.js', 10)), at('Base injoignable', stack('lire.js', 10)))
  assert.notEqual(at('x', stack('lire.js', 10)), at('x', stack('ecrire.js', 10)))
  assert.equal(topFrame('Error: x\n    at lire (/app/lire.js?v=3:10:9)'), 'at lire (/app/lire.js)')
  assert.match(at('x', ''), /^[0-9a-f]{16}$/)
})

test('Sentry : pile dans l\'ordre attendu, enveloppe en trois lignes, aucune adresse IP', () => {
  const frames = sentryFrames('TypeError: x\n    at envoyer (https://site.fr/_nuxt/a.js:12:5)\n    at node_modules/vue/dist/vue.js:3:1\nlire@https://site.fr/b.js:7:2')
  assert.deepEqual(frames, [
    { function: 'lire', filename: 'https://site.fr/b.js', lineno: 7, colno: 2, in_app: true },
    { filename: 'node_modules/vue/dist/vue.js', lineno: 3, colno: 1, in_app: false },
    { function: 'envoyer', filename: 'https://site.fr/_nuxt/a.js', lineno: 12, colno: 5, in_app: true },
  ])
  const dsn = 'https://abc123@o42.ingest.sentry.io/4507'
  const envelope = sentryEnvelope({ source: 'browser', type: 'TypeError', message: 'x is not a function', stack: 'at f (a.js:1:2)', path: '/contact', method: 'GET', status: null, browser: 'Chrome (macOS)' }, { dsn, eventId: 'a'.repeat(32), at: Date.UTC(2026, 10, 26, 12), release: 'backoffice-core@0.14.0', site: 'cabinet-durand.fr', environment: 'production' })
  const [header, item, event] = envelope.trimEnd().split('\n').map(line => JSON.parse(line))
  assert.deepEqual(header, { event_id: 'a'.repeat(32), sent_at: '2026-11-26T12:00:00.000Z', dsn })
  assert.deepEqual(item, { type: 'event', content_type: 'application/json' })
  assert.deepEqual([event.platform, event.level, event.release, event.transaction, event.request.url, event.user.ip_address, event.tags.browser], ['javascript', 'error', 'backoffice-core@0.14.0', 'GET /contact', 'https://cabinet-durand.fr/contact', null, 'Chrome (macOS)'])
  assert.deepEqual(event.exception.values[0], { type: 'TypeError', value: 'x is not a function', stacktrace: { frames: [{ function: 'f', filename: 'a.js', lineno: 1, colno: 2, in_app: true }] } })
  assert.equal(sentryAuth(parseDsn(dsn)!, '0.14.0'), 'Sentry sentry_version=7, sentry_key=abc123, sentry_client=backoffice-core/0.14.0')
})

test('vérification : page en erreur, trop lente, sans réponse, base injoignable', () => {
  assert.deepEqual(checkVerdict({ status: 200, ms: 320, database: true }), { ok: true, status: 200, ms: 320, detail: '' })
  assert.match(checkVerdict({ status: 500, ms: 80, database: true }).detail, /répond 500/)
  assert.match(checkVerdict({ status: 200, ms: 6200, database: true }).detail, /a mis 6,2 s/)
  assert.equal(checkVerdict({ status: null, ms: 10_000, database: true, error: 'Le site n\'a pas répondu après 10 secondes.' }).detail, 'Le site n\'a pas répondu après 10 secondes.')
  assert.match(checkVerdict({ status: 200, ms: 100, database: false }).detail, /base de données/)
  assert.equal(checkVerdict({ status: 301, ms: 100, database: true }).ok, true)
})

test('alertes : une seule par panne, au deuxième échec ; le retour n\'est annoncé que si la panne l\'a été', () => {
  const bad = { ok: false, status: 500, ms: 50, detail: 'La page d\'accueil répond 500.' }, good = { ok: true, status: 200, ms: 50, detail: '' }
  let step = nextState(INITIAL_STATE, bad, 1000)
  assert.deepEqual([step.alert, step.state.failures, step.state.downSince, step.state.alerted], [null, 1, 1000, false])
  // Un raté isolé : pas d'e-mail, ni à l'aller ni au retour.
  assert.deepEqual(nextState(step.state, good, 2000), { state: INITIAL_STATE, alert: null })
  step = nextState(step.state, bad, 2000)
  assert.deepEqual([step.alert, step.state.failures, step.state.downSince, step.state.alerted], ['down', 2, 1000, true])
  step = nextState(step.state, bad, 3000)
  assert.deepEqual([step.alert, step.state.failures], [null, 3])
  assert.deepEqual(nextState(step.state, good, 4000), { state: INITIAL_STATE, alert: 'up' })
})

test('e-mails d\'alerte : texte échappé, durée de la panne, heure du site', () => {
  const input = { siteName: 'Cabinet <Durand>', url: 'https://cabinet-durand.fr/', adminUrl: 'https://cabinet-durand.fr/admin/monitoring', now: Date.UTC(2026, 10, 26, 13, 5), since: Date.UTC(2026, 10, 26, 11), timeZone: 'Europe/Paris' }
  const down = alertEmail('down', { ...input, detail: 'La page d\'accueil répond 500.' })
  assert.equal(down.subject, 'Cabinet <Durand> ne répond plus')
  assert.ok(down.html.includes('depuis le 26 novembre 2026 à 12:00') && down.html.includes('La page d&#39;accueil répond 500.') && down.html.includes('/admin/monitoring'))
  const up = alertEmail('up', input)
  assert.ok(up.subject.endsWith('répond de nouveau') && up.html.includes('environ 2 h 05'))
  const error = alertEmail('error', { ...input, error: { type: 'TypeError', message: '<script>x</script> is not a function', path: '/contact', source: 'browser' } })
  assert.ok(error.subject === 'Nouvelle erreur sur Cabinet <Durand>' && error.html.includes('&lt;script&gt;') && !error.html.includes('<script>') && error.html.includes('navigateur d&#39;un visiteur') === false && error.html.includes('dans le navigateur'))
  assert.deepEqual([formatDowntime(30_000), formatDowntime(12 * 60_000), formatDowntime(125 * 60_000), formatDowntime(3 * 86_400_000)], ['1 minute', '12 minutes', '2 h 05', '3 jours'])
})

test('disponibilité : jamais « 100 % » après un échec ; pannes du premier échec au retour', () => {
  const ok = { ok: true }, ko = { ok: false }
  assert.equal(uptimePercent([]), null)
  assert.equal(uptimePercent([ok, ok, ok]), '100 %')
  assert.equal(uptimePercent([...Array(1999).fill(ok), ko]), '99,9 %')
  assert.equal(uptimePercent([ok, ko, ok, ok]), '75,0 %')
  const list = incidents([{ at: 1, ok: true, detail: '' }, { at: 2, ok: false, detail: 'a' }, { at: 3, ok: false, detail: 'b' }, { at: 4, ok: true, detail: '' }, { at: 5, ok: false, detail: 'c' }])
  assert.deepEqual(list, [{ from: 5, to: null, detail: 'c' }, { from: 2, to: 4, detail: 'a' }])
})
