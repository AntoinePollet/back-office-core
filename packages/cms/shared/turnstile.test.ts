import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isTurnstileSiteKey, isTurnstileTestKey, isTurnstileToken, secretRefused, turnstileSettingsErrors, visitorMessage } from './turnstile.ts'

test('clé du site : format vérifié, rien d\'injectable dans la page', () => {
  assert.ok(isTurnstileSiteKey('0x4AAAAAAABkMYinukE8nzY'))
  assert.ok(isTurnstileSiteKey('1x00000000000000000000AA'))
  assert.equal(isTurnstileSiteKey('0x4AAA"><script>'), false)
  assert.equal(isTurnstileSiteKey('court'), false)
  assert.equal(isTurnstileSiteKey(undefined), false)
  assert.deepEqual(turnstileSettingsErrors({ siteKey: '0x4AAAAAAABkMYinukE8nzY' }), {})
  assert.deepEqual(turnstileSettingsErrors({}), {})
  assert.match(turnstileSettingsErrors({ siteKey: 'ma clé' }).siteKey!, /sans espace/)
})

test('clés de test officielles reconnues (elles ne protègent de rien)', () => {
  for (const key of ['1x00000000000000000000AA', '2x00000000000000000000AB', '1x00000000000000000000BB', '3x00000000000000000000FF', '1x0000000000000000000000000000000AA', '2x0000000000000000000000000000000AA', '3x0000000000000000000000000000000AA']) {
    assert.ok(isTurnstileTestKey(key), key)
  }
  assert.equal(isTurnstileTestKey('0x4AAAAAAABkMYinukE8nzY'), false)
})

test('jeton et réponse de Siteverify', () => {
  assert.ok(isTurnstileToken('XXXX.DUMMY.TOKEN.XXXX'))
  assert.equal(isTurnstileToken(''), false)
  assert.equal(isTurnstileToken('x'.repeat(2049)), false)
  assert.equal(isTurnstileToken(42), false)
  assert.ok(secretRefused({ 'success': false, 'error-codes': ['invalid-input-secret'] }))
  assert.equal(secretRefused({ 'success': false, 'error-codes': ['invalid-input-response'] }), false)
  assert.match(visitorMessage({ 'error-codes': ['timeout-or-duplicate'] }), /expiré/)
  assert.match(visitorMessage({ 'error-codes': ['invalid-input-response'] }), /a échoué/)
})
