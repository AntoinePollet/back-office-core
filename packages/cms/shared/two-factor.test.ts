import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  backupCodesText, formatTotpSecret, normalizeBackupCode, normalizeTotpCode, normalizeTwoFactorPolicy, parseOtpauth,
  twoFactorErrorMessage, twoFactorRequired, twoFactorSetupRequired,
} from './two-factor'

test('règle : valeur inconnue ou absente = au choix de chacun', () => {
  assert.equal(normalizeTwoFactorPolicy('admins'), 'admins')
  assert.equal(normalizeTwoFactorPolicy('all'), 'all')
  assert.equal(normalizeTwoFactorPolicy('off'), 'off')
  for (const value of [undefined, null, '', 'ALL', 'tous', 1, {}, ['all']]) assert.equal(normalizeTwoFactorPolicy(value), 'off')
})

test('règle : qui est concerné', () => {
  for (const role of ['admin', 'editor', 'writer', 'role-personnalise', null, undefined]) assert.equal(twoFactorRequired('off', role), false)
  assert.equal(twoFactorRequired('admins', 'admin'), true)
  for (const role of ['editor', 'writer', 'role-personnalise', 'Admin', '', null, undefined]) assert.equal(twoFactorRequired('admins', role), false)
  for (const role of ['admin', 'editor', 'writer', 'role-personnalise', null, undefined]) assert.equal(twoFactorRequired('all', role), true)
})

test('activation à faire : seulement si la règle concerne le compte et qu\'il ne l\'a pas activée', () => {
  assert.equal(twoFactorSetupRequired('admins', { role: 'admin', twoFactorEnabled: false }), true)
  assert.equal(twoFactorSetupRequired('admins', { role: 'admin', twoFactorEnabled: null }), true)
  assert.equal(twoFactorSetupRequired('admins', { role: 'admin' }), true)
  assert.equal(twoFactorSetupRequired('admins', { role: 'admin', twoFactorEnabled: true }), false)
  assert.equal(twoFactorSetupRequired('admins', { role: 'editor', twoFactorEnabled: false }), false)
  assert.equal(twoFactorSetupRequired('all', { role: 'writer', twoFactorEnabled: false }), true)
  assert.equal(twoFactorSetupRequired('all', { role: 'writer', twoFactorEnabled: true }), false)
  assert.equal(twoFactorSetupRequired('off', { role: 'admin', twoFactorEnabled: false }), false)
})

test('code de l\'application : 6 chiffres, espaces tolérés', () => {
  assert.equal(normalizeTotpCode('123456'), '123456')
  assert.equal(normalizeTotpCode(' 123 456 '), '123456')
  assert.equal(normalizeTotpCode('012345'), '012345')
  for (const bad of ['', '12345', '1234567', '12345a', '12-456', 'abcdef', '１２３４５６']) assert.equal(normalizeTotpCode(bad), null, bad)
})

test('code de secours : tiret remis, casse conservée, forme vérifiée', () => {
  assert.equal(normalizeBackupCode('aB3dE-fG7hI'), 'aB3dE-fG7hI')
  assert.equal(normalizeBackupCode('aB3dEfG7hI'), 'aB3dE-fG7hI')
  assert.equal(normalizeBackupCode('  aB3dE - fG7hI '), 'aB3dE-fG7hI')
  assert.equal(normalizeBackupCode('aB3dE–fG7hI'), 'aB3dE-fG7hI')
  for (const bad of ['', 'aB3dE-fG7h', 'aB3dE-fG7hIj', 'aB3d-EfG7hI', 'aB3dE_fG7hI', 'h1:abc', '123456']) assert.equal(normalizeBackupCode(bad), null, bad)
})

test('adresse otpauth : clé, site, compte', () => {
  const uri = 'otpauth://totp/Cabinet%20Durand:claire%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Cabinet+Durand&digits=6&period=30'
  assert.deepEqual(parseOtpauth(uri), { secret: 'JBSWY3DPEHPK3PXP', issuer: 'Cabinet Durand', account: 'claire@example.com', digits: 6, period: 30 })
  // Sans paramètre « issuer » : le site est lu dans le libellé ; valeurs par défaut de la norme.
  assert.deepEqual(parseOtpauth('otpauth://totp/Site:a%40b.fr?secret=jbswy3dp===='), { secret: 'JBSWY3DP', issuer: 'Site', account: 'a@b.fr', digits: 6, period: 30 })
  assert.equal(parseOtpauth('otpauth://totp/a%40b.fr?secret=JBSWY3DP')?.account, 'a@b.fr')
  for (const bad of ['', 'https://exemple.fr', 'otpauth://hotp/x?secret=JBSWY3DP', 'otpauth://totp/x', 'otpauth://totp/x?secret=', 'otpauth://totp/x?secret=pas+du+base32!', 'otpauth://totp/%E0%A4%A?secret=JBSWY3DP'])
    assert.equal(parseOtpauth(bad), null, bad)
})

test('clé à recopier : groupes de 4', () => {
  assert.equal(formatTotpSecret('JBSWY3DPEHPK3PXP'), 'JBSW Y3DP EHPK 3PXP')
  assert.equal(formatTotpSecret('JBSWY3DPEH'), 'JBSW Y3DP EH')
  assert.equal(formatTotpSecret(''), '')
  assert.equal(formatTotpSecret('JBSW Y3DP').replace(/\s/g, ''), 'JBSWY3DP')
})

test('fichier des codes de secours : site, compte, date, un code par ligne', () => {
  const text = backupCodesText('cabinet-durand.fr', 'claire@example.com', ['aaaaa-bbbbb', 'ccccc-ddddd'], new Date(2026, 10, 19))
  const lines = text.split('\n')
  assert.equal(lines[0], 'Codes de secours — cabinet-durand.fr')
  assert.equal(lines[1], 'Compte : claire@example.com')
  assert.match(lines[2]!, /^Créés le 19 novembre 2026$/)
  assert.deepEqual(lines.filter(l => /^[a-z]{5}-[a-z]{5}$/.test(l)), ['aaaaa-bbbbb', 'ccccc-ddddd'])
  assert.ok(text.endsWith('\n'))
})

test('messages d\'erreur : en français, sans rien révéler de plus', () => {
  assert.match(twoFactorErrorMessage('INVALID_CODE', 401)!, /^Code incorrect/)
  assert.match(twoFactorErrorMessage('INVALID_BACKUP_CODE', 401)!, /incorrect ou déjà utilisé/)
  assert.match(twoFactorErrorMessage('INVALID_TWO_FACTOR_COOKIE', 401)!, /mot de passe/)
  assert.match(twoFactorErrorMessage('TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE', 400)!, /mot de passe/)
  assert.match(twoFactorErrorMessage('ACCOUNT_TEMPORARILY_LOCKED', 429)!, /bloqué/)
  assert.match(twoFactorErrorMessage(undefined, 429)!, /Trop de tentatives/)
  // Erreur inconnue : le message d'origine est gardé par l'appelant.
  assert.equal(twoFactorErrorMessage('AUTRE_CHOSE', 400), null)
  assert.equal(twoFactorErrorMessage(undefined, 500), null)
})
