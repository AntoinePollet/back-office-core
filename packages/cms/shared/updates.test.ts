import assert from 'node:assert/strict'
import { test } from 'node:test'
import { UPDATE_CHECK_INTERVAL_MS, compareVersions, isNewerVersion, isUpdateCheckDue, parseVersion, readLatestRelease, readUpdateCheckState, updateStatus } from './updates.ts'

test('numéros de version : lecture et comparaison', () => {
  assert.deepEqual(parseVersion('0.5.1'), [0, 5, 1])
  assert.deepEqual(parseVersion('v12.0.3'), [12, 0, 3])
  for (const bad of ['', '0.5', 'v0.5.1-beta.1', '1.2.3.4', 'main', ' ', null, undefined, 51, 'v1.2.x']) assert.equal(parseVersion(bad), null, String(bad))
  assert.ok(compareVersions('0.5.1', '0.5.0') > 0)
  assert.ok(compareVersions('0.10.0', '0.9.9') > 0, 'comparaison par nombres, pas par texte')
  assert.ok(compareVersions('1.0.0', '0.99.99') > 0)
  assert.ok(compareVersions('0.5.0', '0.5.1') < 0)
  assert.equal(compareVersions('v0.5.0', '0.5.0'), 0)
  assert.equal(compareVersions('main', '0.5.0'), 0, 'un numéro illisible ne déclenche rien')
  assert.ok(isNewerVersion('0.5.1', '0.5.0'))
  assert.equal(isNewerVersion('0.5.0', '0.5.0'), false)
  assert.equal(isNewerVersion('0.4.9', '0.5.0'), false)
  assert.equal(isNewerVersion('n\'importe quoi', '0.5.0'), false)
})

test('réponse de GitHub : seule une version publiée lisible est retenue', () => {
  const release = { tag_name: 'v0.5.1', html_url: 'https://github.com/x/y/releases/tag/v0.5.1', draft: false, prerelease: false, body: 'notes' }
  assert.deepEqual(readLatestRelease(release), { version: '0.5.1', url: 'https://github.com/x/y/releases/tag/v0.5.1' })
  assert.equal(readLatestRelease({ ...release, draft: true }), null)
  assert.equal(readLatestRelease({ ...release, prerelease: true }), null)
  assert.equal(readLatestRelease({ ...release, tag_name: 'v0.6.0-rc.1' }), null)
  assert.equal(readLatestRelease({ ...release, tag_name: undefined }), null)
  assert.equal(readLatestRelease({ ...release, html_url: 'javascript:alert(1)' }), null, 'l\'adresse finit dans un lien : web uniquement')
  assert.equal(readLatestRelease({ ...release, html_url: 'https://x.fr/"><script>' }), null)
  assert.equal(readLatestRelease({ message: 'API rate limit exceeded' }), null)
  for (const bad of [null, undefined, 'texte', 42, []]) assert.equal(readLatestRelease(bad), null)
})

test('une interrogation par jour au plus', () => {
  const now = Date.UTC(2026, 10, 20, 12)
  assert.equal(isUpdateCheckDue(null, now), true, 'jamais interrogé')
  assert.equal(isUpdateCheckDue({ checkedAt: now - 1000, latest: null }, now), false, 'un échec récent compte aussi')
  assert.equal(isUpdateCheckDue({ checkedAt: now - UPDATE_CHECK_INTERVAL_MS + 1, latest: null }, now), false)
  assert.equal(isUpdateCheckDue({ checkedAt: now - UPDATE_CHECK_INTERVAL_MS, latest: null }, now), true)
  assert.equal(isUpdateCheckDue({ checkedAt: now + 5 * UPDATE_CHECK_INTERVAL_MS, latest: null }, now), true, 'date dans le futur : on revérifie')
})

test('état gardé en base : relu avec méfiance', () => {
  const latest = { version: '0.5.1', url: 'https://github.com/x/y/releases/tag/v0.5.1' }
  assert.deepEqual(readUpdateCheckState({ checkedAt: 5, latest }), { checkedAt: 5, latest })
  assert.deepEqual(readUpdateCheckState({ checkedAt: 5, latest: null }), { checkedAt: 5, latest: null })
  assert.deepEqual(readUpdateCheckState({ checkedAt: 5, latest: { version: 'x', url: 'y' } }), { checkedAt: 5, latest: null })
  for (const bad of [null, 'x', {}, { checkedAt: 'hier' }]) assert.equal(readUpdateCheckState(bad), null)
})

test('avis affiché seulement si la version connue dépasse la version installée', () => {
  const latest = { version: '0.5.1', url: 'https://github.com/x/y/releases/tag/v0.5.1' }
  assert.deepEqual(updateStatus('0.5.0', { checkedAt: 1, latest }), { current: '0.5.0', latest: '0.5.1', url: latest.url })
  assert.deepEqual(updateStatus('0.5.1', { checkedAt: 1, latest }), { current: '0.5.1', latest: null, url: null }, 'site à jour')
  assert.deepEqual(updateStatus('0.6.0', { checkedAt: 1, latest }), { current: '0.6.0', latest: null, url: null }, 'site en avance (lien local)')
  assert.deepEqual(updateStatus('0.5.0', { checkedAt: 1, latest: null }), { current: '0.5.0', latest: null, url: null })
  assert.deepEqual(updateStatus('0.5.0', null), { current: '0.5.0', latest: null, url: null })
})
