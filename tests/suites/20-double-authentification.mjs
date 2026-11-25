// Double authentification : application d'authentification (vrais codes TOTP calculés ici), codes de secours,
// appareil de confiance, règle « obligatoire », remise à zéro par un administrateur, mot de passe oublié.
import { spawnSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { api, check, clickText, find, jsonInit, login, parse, says, until, wait } from '../lib/harness.mjs'
import { config } from '../lib/config.mjs'

export const meta = {
  title: 'double authentification (codes TOTP, codes de secours, règle obligatoire, dépannage)',
  mock: true,
  // Le lien « mot de passe oublié » part par e-mail : le serveur l'envoie au faux Brevo.
  env: ({ mock }) => ({ NUXT_BREVO_API_KEY: 'cle-de-test', NUXT_BREVO_API_URL: `${mock}/v3`, NUXT_EMAIL_FROM: 'Cabinet Durand <contact@cabinet-durand.fr>' }),
}

// ───── Codes TOTP (RFC 6238 : HMAC-SHA-1, 6 chiffres, pas de 30 secondes) ─────

function base32Decode(text) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const c of text.replace(/[\s=]/g, '').toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, '0')
  return Buffer.from(bits.slice(0, bits.length - bits.length % 8).match(/.{8}/g).map(b => parseInt(b, 2)))
}
function totp(secret, counter) {
  const message = Buffer.alloc(8)
  message.writeBigUInt64BE(BigInt(counter))
  const mac = createHmac('sha1', base32Decode(secret)).update(message).digest()
  const offset = mac[mac.length - 1] & 15
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1e6).padStart(6, '0')
}
const step30 = () => Math.floor(Date.now() / 30_000)
/** Codes déjà présentés au serveur : il refuse qu'un code serve deux fois. */
const spent = new Set()
/**
 * Un code valable et pas encore utilisé. Le serveur accepte le code du moment, le précédent et le suivant :
 * on prend dans cet ordre le code du moment, le suivant, puis le précédent ; sinon on attend le prochain pas de 30 secondes.
 */
async function freshCode(secret) {
  for (;;) {
    // Le code précédent n'est proposé qu'en début de pas : il doit encore être « précédent » à l'arrivée de la requête.
    for (const counter of [step30(), step30() + 1, ...(Date.now() % 30_000 < 20_000 ? [step30() - 1] : [])]) {
      const code = totp(secret, counter)
      if (!spent.has(`${secret}:${code}`)) { spent.add(`${secret}:${code}`); return code }
    }
    await wait(1000)
  }
}
/** Un code à 6 chiffres qui n'est valable ni maintenant ni aux pas voisins. */
function wrongCode(secret) {
  const valid = [-2, -1, 0, 1, 2].map(d => totp(secret, step30() + d))
  for (let n = 111111; ; n += 7919) if (!valid.includes(String(n % 1e6).padStart(6, '0'))) return String(n % 1e6).padStart(6, '0')
}
const secretOf = uri => new URL(uri).searchParams.get('secret')

// ───── Lecture directe de la base locale (ce que contiendrait une copie de la base) ─────

function databaseFile() {
  if (config.target === 'node') return path.join(config.tmpDir, 'etat', 'cms.sqlite')
  const dir = path.join(config.tmpDir, 'etat', 'v3', 'd1', 'miniflare-D1DatabaseObject')
  const file = fs.readdirSync(dir).find(f => f.endsWith('.sqlite') && f !== 'metadata.sqlite')
  return path.join(dir, file)
}
const hasSqlite = spawnSync('sqlite3', ['-version']).status === 0
function sql(query, { write = false } = {}) {
  const r = spawnSync('sqlite3', [...(write ? [] : ['-readonly']), '-json', '-cmd', '.timeout 5000', databaseFile(), query], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error('sqlite3 : ' + r.stderr.slice(0, 300))
  return r.stdout.trim() ? JSON.parse(r.stdout) : []
}

export default async function (t) {
  const { B, step, admin, calls } = t
  const MARC = { name: 'Marc Petit', email: 'marc@example.com', password: 'mot-de-passe-de-marc' }
  const LINA = { name: 'Lina Roux', email: 'lina@example.com', password: 'mot-de-passe-de-lina' }
  const claire = { ...admin }
  const inviteApi = link => link.replace(/^.*\/admin\/invite\//, '/api/cms/invite/')
  const verifyTotp = (client, code, more = {}) => client.post('/api/auth/two-factor/verify-totp', { code, ...more })
  const verifyBackup = (client, code) => client.post('/api/auth/two-factor/verify-backup-code', { code })

  /** Connexion complète sans navigateur : mot de passe puis code. */
  async function signInWithCode(who, secret) {
    const client = t.http()
    const r = await client.signIn(who.email, who.password)
    check(r.status === 200 && r.json?.twoFactorRedirect === true, `étape du code attendue : ${r.status} ${r.text.slice(0, 150)}`)
    const v = await verifyTotp(client, await freshCode(secret))
    check(v.status === 200, `code refusé : ${v.status} ${v.text.slice(0, 150)}`)
    return client
  }
  /** Activation sans navigateur, pour préparer un compte. Renvoie sa clé et ses codes de secours. */
  async function enableByApi(client, who) {
    const r = await client.post('/api/auth/two-factor/enable', { password: who.password })
    check(r.status === 200 && r.json?.totpURI, `activation refusée : ${r.status} ${r.text.slice(0, 150)}`)
    const secret = secretOf(r.json.totpURI)
    const v = await verifyTotp(client, await freshCode(secret))
    check(v.status === 200, `premier code refusé : ${v.status} ${v.text.slice(0, 150)}`)
    return { secret, backupCodes: r.json.backupCodes }
  }
  /** Parcours d'activation dans la carte « Double authentification » déjà affichée. Renvoie la clé et les codes de secours. */
  async function enableInPage(page, who, { badCodeFirst = false } = {}) {
    await clickText(page, '[data-two-factor] button', 'Activer la double authentification')
    await page.type('[data-two-factor-password]', who.password)
    await clickText(page, '[data-two-factor] button', 'Continuer')
    await page.waitForSelector('[data-two-factor-qr]')
    const secret = (await page.$eval('[data-two-factor-secret]', e => e.textContent)).replace(/\s+/g, '')
    if (badCodeFirst) {
      await page.type('[data-two-factor-code]', wrongCode(secret))
      await clickText(page, '[data-two-factor] button', 'Vérifier et activer')
      await says(page, 'Code incorrect')
      check(await page.$eval('[data-two-factor-state]', e => e.textContent.trim()) === 'Non activée', 'activée malgré un mauvais code')
      await page.$eval('[data-two-factor-code]', e => { e.value = ''; e.dispatchEvent(new Event('input')) })
    }
    return { secret, finish: async () => {
      await page.type('[data-two-factor-code]', await freshCode(secret))
      await clickText(page, '[data-two-factor] button', 'Vérifier et activer')
      await says(page, 'La double authentification est activée.')
      const backupCodes = await page.$$eval('[data-two-factor-backup-codes] li', items => items.map(i => i.textContent.trim()))
      return backupCodes
    } }
  }
  /** Étape du code dans le formulaire de connexion. */
  async function typeLoginCode(page, code) {
    await page.waitForSelector('[data-login-code] input:not([type=checkbox])')
    await page.type('[data-login-code] input:not([type=checkbox])', code)
  }
  async function passwordStep(page, who) {
    await page.goto(B + '/admin/login', { waitUntil: 'networkidle0' })
    await page.type('form input[type=email]', who.email)
    await page.type('form input[type=password]', who.password)
    await clickText(page, 'form button', 'Se connecter')
  }

  const page = await t.newPage()
  /** Choix de la règle dans l'écran Utilisateurs ; attend la réponse du serveur. */
  const choosePolicy = value => Promise.all([
    page.waitForResponse(r => r.url().endsWith('/api/cms/two-factor/policy') && r.request().method() === 'PUT' && r.ok()),
    page.select('[data-two-factor-policy] select', value),
  ])
  const boss = t.http()
  let marcClient
  let secret, backupCodes

  await step('préparation : deux autres comptes, sans double authentification', async () => {
    check((await boss.signIn(claire.email, claire.password)).status === 200, 'connexion de l\'administratrice refusée')
    for (const who of [MARC, LINA]) {
      const { link } = await boss.json('/api/cms/users', { method: 'POST', body: { name: who.name, email: who.email, role: 'editor' } })
      check((await t.http().post(inviteApi(link), { password: who.password })).status === 200, 'choix du mot de passe refusé')
    }
    marcClient = t.http()
    const r = await marcClient.signIn(MARC.email, MARC.password)
    check(r.status === 200 && !r.json.twoFactorRedirect, 'par défaut, la connexion se fait sans code : ' + r.text.slice(0, 150))
    const me = await marcClient.json('/api/cms/me')
    check(me.twoFactor.enabled === false && me.twoFactor.setupRequired === false, JSON.stringify(me.twoFactor))
  })

  // ───── Activation ─────

  let activation
  await step('Mon compte : mot de passe demandé, puis code QR et clé à saisir', async () => {
    await login(page, B)
    await page.goto(B + '/admin/account', { waitUntil: 'networkidle0' })
    await says(page, 'Double authentification')
    check(await page.$eval('[data-two-factor-state]', e => e.textContent.trim()) === 'Non activée', 'état initial')
    // Mauvais mot de passe : rien ne commence.
    await clickText(page, '[data-two-factor] button', 'Activer la double authentification')
    await page.type('[data-two-factor-password]', 'pas-le-bon-mot-de-passe')
    await clickText(page, '[data-two-factor] button', 'Continuer')
    await says(page, 'Mot de passe incorrect.')
    await clickText(page, '[data-two-factor] button', 'Annuler')
    activation = await enableInPage(page, claire, { badCodeFirst: true })
    secret = activation.secret
    check(/^[A-Z2-7]{32,}$/.test(secret), 'clé affichée : ' + secret)
  })
  await t.shot(page, 'activation-code-qr')

  await step('le code QR se lit et contient la clé affichée, le nom du site et le compte', async () => {
    await page.addScriptTag({ path: path.join(config.testsDir, 'node_modules', 'jsqr', 'dist', 'jsQR.js') })
    const decoded = await page.evaluate(async () => {
      const svg = document.querySelector('[data-two-factor-qr]').cloneNode(true)
      svg.setAttribute('width', '480'); svg.setAttribute('height', '480')
      const image = new Image()
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg))
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 480
      const ctx = canvas.getContext('2d')
      ctx.drawImage(image, 0, 0, 480, 480)
      const pixels = ctx.getImageData(0, 0, 480, 480)
      return window.jsQR(pixels.data, 480, 480)?.data ?? null
    })
    check(decoded?.startsWith('otpauth://totp/'), 'contenu lu : ' + decoded)
    const url = new URL(decoded)
    check(url.searchParams.get('secret') === secret, 'la clé du code QR n\'est pas la clé affichée')
    check(url.searchParams.get('issuer') === 'Cabinet Durand', 'émetteur : ' + url.searchParams.get('issuer'))
    check(decodeURIComponent(url.pathname).endsWith(':' + claire.email), 'compte : ' + url.pathname)
    check(url.searchParams.get('digits') === '6' && url.searchParams.get('period') === '30', decoded)
    t.info('code QR lu : ' + decoded.replace(secret, '<clé>'))
    // À la taille affichée, sur un téléphone : toujours carré et entièrement visible.
    const box = await page.$eval('[data-two-factor-qr]', e => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height } })
    check(box.w >= 180 && Math.abs(box.w - box.h) < 1, JSON.stringify(box))
  })

  await step('tant que le premier code n\'est pas vérifié, rien n\'est activé', async () => {
    const me = parse(await api(page, '/api/cms/me'))
    check(me.twoFactor.enabled === false, 'activée avant le premier code')
    const other = t.http()
    const r = await other.signIn(claire.email, claire.password)
    check(r.status === 200 && !r.json.twoFactorRedirect, 'code demandé alors que l\'activation n\'est pas confirmée')
  })

  await step('premier code vérifié : activée, dix codes de secours affichés une fois', async () => {
    backupCodes = await activation.finish()
    check(backupCodes.length === 10 && backupCodes.every(c => /^[a-zA-Z0-9]{5}-[a-zA-Z0-9]{5}$/.test(c)) && new Set(backupCodes).size === 10, backupCodes.join(' '))
    check(await page.$eval('[data-two-factor-state]', e => e.textContent.trim()) === 'Activée', 'état après activation')
    check(parse(await api(page, '/api/cms/me')).twoFactor.enabled === true, '/api/cms/me ne dit pas « activée »')
    await find(page, '[data-two-factor] button', 'Télécharger'); await find(page, '[data-two-factor] button', 'Copier')
  })
  await t.shot(page, 'activation-codes-de-secours')

  await step('codes rangés : ils ne sont plus affichés ; la session en cours continue', async () => {
    await clickText(page, '[data-two-factor] button', 'J\'ai rangé mes codes')
    await says(page, 'Créer de nouveaux codes de secours')
    const text = await page.evaluate(() => document.body.innerText)
    check(!backupCodes.some(c => text.includes(c)) && !text.includes(secret), 'un code ou la clé est encore affiché')
    check((await api(page, '/api/cms/schema')).status === 200, 'la session a été perdue')
    await page.reload({ waitUntil: 'networkidle0' })
    check(await page.$eval('[data-two-factor-state]', e => e.textContent.trim()) === 'Activée', 'état après rechargement')
  })

  await step('rien de sensible ne sort de l\'API ; en base, clé chiffrée et codes de secours hachés', async () => {
    const texts = [
      (await api(page, '/api/cms/users')).body,
      (await api(page, '/api/cms/me')).body,
      (await api(page, '/api/auth/get-session')).body,
    ].join('\n')
    check(!texts.includes(secret) && !backupCodes.some(c => texts.includes(c)) && !/backupCodes|"secret"/.test(texts), 'une réponse de l\'API contient la clé ou un code')
    // La route de Better Auth qui redonne la clé exige le mot de passe.
    check((await api(page, '/api/auth/two-factor/get-totp-uri', jsonInit('POST', { password: 'pas-le-bon' }))).status !== 200, 'clé relue sans le bon mot de passe')
    if (!hasSqlite) return t.info('sqlite3 absent : contenu de la base non vérifié')
    const [row] = sql('select t.secret, t.backup_codes, t.verified from two_factor t join user u on u.id = t.user_id where u.email = \'claire@example.com\'')
    const raw = base32Decode(secret).toString('latin1')
    check(row.verified === 1 && !row.secret.includes(secret) && !row.secret.includes(raw), 'clé lisible en base')
    const stored = JSON.parse(row.backup_codes)
    check(stored.length === 10 && stored.every(h => /^h1:[\w-]{43}$/.test(h)), 'codes de secours en base : ' + row.backup_codes.slice(0, 80))
    check(!backupCodes.some(c => row.backup_codes.includes(c)), 'un code de secours est lisible en base')
  })

  // ───── Connexion ─────

  const device2 = await t.newPage({ context: await t.newContext() })
  await step('connexion : après le mot de passe, le code est demandé ; un mauvais code est refusé', async () => {
    await passwordStep(device2, claire)
    await says(device2, 'Vérification en deux étapes')
    check((await api(device2, '/api/cms/me')).status === 401, 'connecté avant le code')
    await typeLoginCode(device2, wrongCode(secret))
    await says(device2, 'Code incorrect')
    check((await api(device2, '/api/cms/me')).status === 401, 'connecté avec un mauvais code')
  })
  await t.shot(device2, 'connexion-code')

  await step('connexion : le bon code ouvre le back-office (validé dès le 6ᵉ chiffre)', async () => {
    await typeLoginCode(device2, await freshCode(secret))
    await device2.waitForSelector('aside .menu')
    check(parse(await api(device2, '/api/cms/me')).email === claire.email, 'mauvais compte')
  })

  await step('un même code ne sert pas deux fois', async () => {
    const first = t.http(), second = t.http()
    await first.signIn(claire.email, claire.password); await second.signIn(claire.email, claire.password)
    const code = await freshCode(secret)
    check((await verifyTotp(first, code)).status === 200, 'premier usage refusé')
    const replay = await verifyTotp(second, code)
    check(replay.status === 401 && replay.json?.code === 'CODE_ALREADY_USED' && /déjà servi/.test(replay.json.message), `${replay.status} ${replay.text.slice(0, 150)}`)
    check((await second.get('/api/cms/me')).status === 401, 'connecté en rejouant un code')
    // Le code suivant, lui, est accepté.
    check((await verifyTotp(second, await freshCode(secret))).status === 200, 'code suivant refusé')
  })

  await step('sans le mot de passe d\'abord, un code ne sert à rien', async () => {
    const r = await verifyTotp(t.http(), totp(secret, step30()))
    check(r.status === 401 && /a expiré/.test(r.json?.message ?? ''), `${r.status} ${r.text.slice(0, 150)}`)
    // Les codes par e-mail ou SMS de l'extension ne sont pas proposés : pas d'autre porte que l'application et les codes de secours.
    const client = t.http()
    await client.signIn(claire.email, claire.password)
    const otp = [await client.post('/api/auth/two-factor/send-otp', {}), await client.post('/api/auth/two-factor/verify-otp', { code: '123456' })]
    check(otp.every(r => r.status === 404), otp.map(r => r.status).join())
  })

  // ───── Codes de secours ─────

  await step('code de secours : accepté une fois, refusé la seconde', async () => {
    const first = t.http(), second = t.http()
    await first.signIn(claire.email, claire.password); await second.signIn(claire.email, claire.password)
    check((await verifyBackup(first, backupCodes[0])).status === 200, 'code de secours refusé')
    check((await first.get('/api/cms/me')).status === 200, 'pas connecté après le code de secours')
    const again = await verifyBackup(second, backupCodes[0])
    check(again.status === 401 && /incorrect ou déjà utilisé/.test(again.json?.message ?? ''), `${again.status} ${again.text.slice(0, 150)}`)
    // Présenter l'empreinte stockée en base à la place du code ne passe pas non plus.
    if (hasSqlite) {
      const [row] = sql('select t.backup_codes from two_factor t join user u on u.id = t.user_id where u.email = \'claire@example.com\'')
      const stored = JSON.parse(row.backup_codes)
      check(stored.length === 9, 'codes restants en base : ' + stored.length)
      check((await verifyBackup(second, stored[0])).status === 401, 'une empreinte volée en base ouvre la session')
    }
  })

  const device3 = await t.newPage({ context: await t.newContext() })
  await step('code de secours dans le navigateur, saisi sans tiret', async () => {
    await passwordStep(device3, claire)
    await says(device3, 'Vérification en deux étapes')
    await clickText(device3, '[data-login-code] button', 'Utiliser un code de secours')
    await says(device3, 'Chaque code ne fonctionne qu\'une fois')
    await typeLoginCode(device3, backupCodes[1].replace('-', ''))
    await clickText(device3, '[data-login-code] button', 'Vérifier')
    await device3.waitForSelector('aside .menu')
  })

  await step('nouveaux codes de secours : mot de passe demandé, les anciens ne valent plus rien', async () => {
    await clickText(page, '[data-two-factor] button', 'Créer de nouveaux codes de secours')
    await page.type('[data-two-factor-password]', claire.password)
    await clickText(page, '[data-two-factor] button', 'Continuer')
    await page.waitForSelector('[data-two-factor-backup-codes] li')
    const fresh = await page.$$eval('[data-two-factor-backup-codes] li', items => items.map(i => i.textContent.trim()))
    check(fresh.length === 10 && !fresh.some(c => backupCodes.includes(c)), 'nouveaux codes : ' + fresh.join(' '))
    await clickText(page, '[data-two-factor] button', 'J\'ai rangé mes codes')
    const client = t.http()
    await client.signIn(claire.email, claire.password)
    check((await verifyBackup(client, backupCodes[2])).status === 401, 'un ancien code de secours fonctionne encore')
    check((await verifyBackup(client, fresh[0])).status === 200, 'un nouveau code de secours est refusé')
    backupCodes = fresh.slice(1)
  })

  // ───── Appareil de confiance ─────

  const trusted = await t.newPage({ context: await t.newContext() })
  await step('« se souvenir de cet appareil » : le code n\'est plus demandé sur cet appareil, mais toujours ailleurs', async () => {
    await passwordStep(trusted, claire)
    await says(trusted, 'Se souvenir de cet appareil pendant 30 jours')
    await trusted.$eval('[data-login-code] input[type=checkbox]', e => e.click())
    await typeLoginCode(trusted, await freshCode(secret))
    await trusted.waitForSelector('aside .menu')
    await trusted.$eval('aside button[title="Se déconnecter"]', e => e.click())
    await trusted.waitForFunction(() => location.pathname === '/admin/login')
    await passwordStep(trusted, claire)
    await trusted.waitForSelector('aside .menu')
    // Un autre appareil : le code reste demandé.
    const r = await t.http().signIn(claire.email, claire.password)
    check(r.json?.twoFactorRedirect === true, 'code non demandé sur un appareil inconnu')
    // Sur l'appareil de confiance, le mot de passe reste indispensable.
    await trusted.$eval('aside button[title="Se déconnecter"]', e => e.click())
    await trusted.waitForFunction(() => location.pathname === '/admin/login')
    await passwordStep(trusted, { ...claire, password: 'pas-le-bon-mot-de-passe' })
    await says(trusted, 'E-mail ou mot de passe incorrect.')
  })

  // ───── Limite de tentatives ─────

  let lina
  await step('tolérance d\'horloge : le code précédent passe (30 secondes), un code vieux de deux minutes non', async () => {
    // Début d'un pas de 30 secondes : « précédent » le reste pendant toute l'étape.
    await until(() => Date.now() % 30_000 < 15_000, 'début d\'un pas de 30 secondes', { tries: 80, every: 500 })
    const linaSession = t.http()
    await linaSession.signIn(LINA.email, LINA.password)
    lina = await enableByApi(linaSession, LINA)
    const client = t.http()
    await client.signIn(LINA.email, LINA.password)
    const old = await verifyTotp(client, totp(lina.secret, step30() - 4))
    check(old.status === 401 && old.json?.code === 'INVALID_CODE', `vieux code : ${old.status} ${old.text.slice(0, 120)}`)
    const previous = totp(lina.secret, step30() - 1)
    spent.add(`${lina.secret}:${previous}`)
    const r = await verifyTotp(client, previous)
    check(r.status === 200, `code précédent : ${r.status} ${r.text.slice(0, 120)}`)
  })

  await step('mauvais codes : 5 essais par connexion, puis le compte se ferme comme pour les mots de passe (8 échecs)', async () => {
    const first = t.http()
    check((await first.signIn(LINA.email, LINA.password)).json?.twoFactorRedirect === true, 'code non demandé')
    const codes = []
    for (let i = 0; i < 5; i++) codes.push((await verifyTotp(first, wrongCode(lina.secret))).status)
    check(codes.every(c => c === 401), 'cinq premiers essais : ' + codes.join())
    // Sixième essai de la même connexion : il faut redonner son mot de passe, même avec le bon code.
    const sixth = await verifyTotp(first, await freshCode(lina.secret))
    check(sixth.status === 400 && /Saisissez à nouveau votre mot de passe/.test(sixth.json?.message ?? ''), `sixième essai : ${sixth.status} ${sixth.text.slice(0, 150)}`)
    check((await first.get('/api/cms/me')).status === 401, 'connecté après trop d\'essais')
    // Redonner le mot de passe n'efface pas les échecs : trois de plus et le compte est fermé un moment.
    const second = t.http()
    check((await second.signIn(LINA.email, LINA.password)).json?.twoFactorRedirect === true, 'seconde connexion : code non demandé')
    for (let i = 0; i < 3; i++) codes.push((await verifyTotp(second, wrongCode(lina.secret))).status)
    check(codes.slice(5).every(c => c === 401), 'essais suivants : ' + codes.join())
    const blocked = await verifyTotp(second, await freshCode(lina.secret))
    check(blocked.status === 429 && /^Trop de tentatives de connexion\. Réessayez dans \d+ minutes?\.$/.test(blocked.json?.message ?? ''), `bon code après 8 échecs : ${blocked.status} ${blocked.text.slice(0, 150)}`)
    const password = await t.http().signIn(LINA.email, LINA.password)
    check(password.status === 429, 'mot de passe après 8 échecs de code : ' + password.status)
    // Les autres comptes ne sont pas touchés.
    await signInWithCode(claire, secret)
  })

  // ───── Désactivation ─────

  await step('désactivation : mot de passe exigé ; ensuite la connexion se fait sans code, même appareils de confiance oubliés', async () => {
    await page.reload({ waitUntil: 'networkidle0' })
    await clickText(page, '[data-two-factor] button', 'Désactiver')
    await page.type('[data-two-factor-password]', 'pas-le-bon-mot-de-passe')
    await clickText(page, '[data-two-factor] form button', 'Désactiver')
    await says(page, 'Mot de passe incorrect.')
    check(parse(await api(page, '/api/cms/me')).twoFactor.enabled === true, 'désactivée avec un mauvais mot de passe')
    await page.$eval('[data-two-factor-password]', e => { e.value = ''; e.dispatchEvent(new Event('input')) })
    await page.type('[data-two-factor-password]', claire.password)
    await clickText(page, '[data-two-factor] form button', 'Désactiver')
    await page.waitForFunction(() => document.querySelector('[data-two-factor-state]')?.textContent.trim() === 'Non activée')
    const r = await t.http().signIn(claire.email, claire.password)
    check(r.status === 200 && !r.json.twoFactorRedirect, 'code encore demandé après désactivation')
    if (hasSqlite) {
      check(sql('select count(*) n from two_factor t join user u on u.id = t.user_id where u.email = \'claire@example.com\'')[0].n === 0, 'clé encore en base')
      check(sql('select count(*) n from verification where identifier like \'trust-device-%\'')[0].n === 0, 'appareils de confiance encore en base')
    }
  })

  // ───── Règle du site ─────

  await step('règle : refusée tant que l\'administratrice n\'a pas activé la sienne ; réservée aux administrateurs', async () => {
    const r = await boss.put('/api/cms/two-factor/policy', { policy: 'admins' })
    check(r.status === 400 && /Activez d'abord/.test(r.json?.message ?? ''), `${r.status} ${r.text.slice(0, 150)}`)
    check((await marcClient.put('/api/cms/two-factor/policy', { policy: 'off' })).status === 403, 'un éditeur change la règle')
    check((await marcClient.get('/api/cms/two-factor/policy')).status === 403, 'un éditeur lit la règle')
    check((await boss.put('/api/cms/two-factor/policy', { policy: 'nimporte' })).status === 400, 'règle inconnue acceptée')
  })

  await step('réactivation : l\'appareil autrefois « de confiance » doit redonner un code', async () => {
    const again = await enableInPage(page, claire)
    secret = again.secret
    backupCodes = await again.finish()
    await clickText(page, '[data-two-factor] button', 'J\'ai rangé mes codes')
    await passwordStep(trusted, claire)
    await says(trusted, 'Vérification en deux étapes')
  })

  await step('règle « administrateurs » depuis l\'écran Utilisateurs : un éditeur n\'est pas concerné', async () => {
    await page.goto(B + '/admin/users', { waitUntil: 'networkidle0' })
    await says(page, '3 comptes, dont 2 avec la double authentification')
    await choosePolicy('admins')
    check((await boss.json('/api/cms/two-factor/policy')).policy === 'admins', 'règle non enregistrée')
    check((await marcClient.get('/api/cms/schema')).status === 200, 'éditeur bloqué par la règle des administrateurs')
  })

  await step('règle « tous » : la session déjà ouverte d\'un compte sans double authentification est refusée partout', async () => {
    // Une confirmation annonce combien de comptes devront l'activer (acceptée d'office par le test).
    await choosePolicy('all')
    check((await boss.json('/api/cms/two-factor/policy')).policy === 'all', 'règle non enregistrée')
    const me = await marcClient.get('/api/cms/me')
    check(me.status === 200 && me.json.twoFactor.setupRequired === true, `/api/cms/me : ${me.status} ${JSON.stringify(me.json?.twoFactor)}`)
    const refused = [
      await marcClient.get('/api/cms/schema'),
      await marcClient.get('/api/cms/entries/services'),
      await marcClient.get('/api/cms/media'),
      await marcClient.post('/api/cms/entries/testimonials', { values: { author: 'Client', quote: 'Très bien.' } }),
      await marcClient.get('/api/cms/reviews'),
    ]
    check(refused.every(r => r.status === 403 && r.json?.data?.code === 'two-factor-required'), refused.map(r => r.status).join())
    check(/exige la double authentification/.test(refused[0].json.message), refused[0].json.message)
  })

  const marcPage = await t.newPage({ context: await t.newContext(), width: 390, height: 844 })
  let marcSecret
  await step('compte concerné : conduit à l\'activation dès la connexion, rien d\'autre n\'est ouvert', async () => {
    await passwordStep(marcPage, MARC)
    await says(marcPage, 'Protégez votre compte pour continuer')
    check(new URL(marcPage.url()).pathname === '/admin/two-factor-setup', marcPage.url())
    for (const target of ['/admin', '/admin/media', '/admin/account']) {
      await marcPage.goto(B + target, { waitUntil: 'networkidle0' })
      await marcPage.waitForFunction(() => location.pathname === '/admin/two-factor-setup').catch(() => { throw new Error(target + ' reste accessible') })
    }
    await says(marcPage, 'Protégez votre compte pour continuer')
    check((await api(marcPage, '/api/cms/schema')).status === 403, 'API ouverte avant l\'activation')
  })
  await t.shot(marcPage, 'obligatoire-telephone')

  await step('il l\'active sur cet écran (largeur de téléphone) et entre dans le back-office', async () => {
    const flow = await enableInPage(marcPage, MARC)
    marcSecret = flow.secret
    // Rien ne dépasse de l'écran du téléphone.
    const overflow = await marcPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check(overflow <= 0, 'la page dépasse de ' + overflow + ' px en largeur')
    await t.shot(marcPage, 'activation-telephone')
    check((await api(marcPage, '/api/cms/schema')).status === 403, 'API ouverte avant le premier code')
    const codes = await flow.finish()
    check(codes.length === 10, 'codes de secours : ' + codes.length)
    await t.shot(marcPage, 'codes-de-secours-telephone')
    await clickText(marcPage, '[data-two-factor] button', 'J\'ai rangé mes codes')
    await marcPage.waitForSelector('aside .menu')
    check((await api(marcPage, '/api/cms/schema')).status === 200, 'API encore refusée après l\'activation')
    // Son ancienne session (ouverte avant la règle) vaut aussi, puisque le compte est maintenant protégé.
    check((await marcClient.get('/api/cms/schema')).status === 200, 'ancienne session refusée')
  })

  // ───── Écran Utilisateurs et remise à zéro ─────

  const cell = (p, email) => p.evaluate((email) => {
    const row = [...document.querySelectorAll('tbody tr')].find(r => r.textContent.includes(email))
    const cell = row?.querySelector('[data-two-factor-cell]')
    return (cell?.querySelector('.badge') ?? cell?.querySelector('span'))?.textContent.trim()
  }, email)

  await step('écran Utilisateurs : qui a activé la double authentification', async () => {
    await page.goto(B + '/admin/users', { waitUntil: 'networkidle0' })
    await says(page, '3 comptes, dont 3 avec la double authentification')
    check(await cell(page, MARC.email) === 'Activée' && await cell(page, claire.email) === 'Activée', 'cellules : ' + await cell(page, MARC.email))
    check(await page.$eval('[data-two-factor-policy] select', s => s.value) === 'all', 'règle affichée')
    // Pas de remise à zéro proposée pour son propre compte.
    const own = await page.evaluate(email => !![...document.querySelectorAll('tbody tr')].find(r => r.textContent.includes(email)).querySelector('[data-two-factor-cell] button'), claire.email)
    check(!own, 'remise à zéro proposée sur son propre compte')
  })
  await t.shot(page, 'utilisateurs')

  await step('remise à zéro : interdite à un éditeur et sur son propre compte', async () => {
    const users = await boss.json('/api/cms/users')
    const id = email => users.find(u => u.email === email).id
    check((await marcClient.del(`/api/cms/users/${id(claire.email)}/two-factor`)).status === 403, 'un éditeur réinitialise un compte')
    const self = await boss.del(`/api/cms/users/${id(claire.email)}/two-factor`)
    check(self.status === 400 && /Mon compte/.test(self.json?.message ?? ''), `sur soi-même : ${self.status}`)
    check((await boss.del('/api/cms/users/inconnu/two-factor')).status === 404, 'compte inconnu')
    check((await t.http().del(`/api/cms/users/${id(MARC.email)}/two-factor`)).status === 401, 'sans connexion')
  })

  await step('téléphone perdu : l\'administratrice réinitialise le compte, la personne rentre avec son mot de passe et doit réactiver', async () => {
    const row = await page.evaluateHandle(email => [...document.querySelectorAll('tbody tr')].find(r => r.textContent.includes(email)), MARC.email)
    await clickText(page, '[data-two-factor-cell] button', 'Réinitialiser', row)
    await says(page, 'Double authentification de Marc Petit réinitialisée')
    await page.waitForFunction(() => document.body.innerText.includes('dont 2 avec la double authentification'))
    check(await cell(page, MARC.email) === 'À activer', 'cellule : ' + await cell(page, MARC.email))
    // Ses sessions sont fermées.
    check((await marcClient.get('/api/cms/me')).status === 401 && (await api(marcPage, '/api/cms/me')).status === 401, 'session encore ouverte')
    // Il se reconnecte sans code (il n'a plus de téléphone)…
    const r = await marcClient.signIn(MARC.email, MARC.password)
    check(r.status === 200 && !r.json.twoFactorRedirect, `connexion : ${r.status} ${r.text.slice(0, 120)}`)
    // … son ancienne clé ne vaut plus rien, et la règle du site s'applique de nouveau.
    check((await marcClient.get('/api/cms/schema')).status === 403, 'API ouverte sans réactivation')
    await passwordStep(marcPage, MARC)
    await says(marcPage, 'Protégez votre compte pour continuer')
    const flow = await enableInPage(marcPage, MARC)
    check(flow.secret !== marcSecret, 'la nouvelle clé est l\'ancienne')
    await flow.finish()
    marcSecret = flow.secret
  })

  // ───── Mot de passe oublié ─────

  await step('le lien de mot de passe oublié ne contourne pas le second facteur', async () => {
    const before = calls().filter(c => c.url === '/v3/smtp/email').length
    check((await t.http().post('/api/cms/password-reset', { email: claire.email })).status === 200, 'demande refusée')
    const mail = await until(() => calls().filter(c => c.url === '/v3/smtp/email')[before], 'e-mail de nouveau mot de passe')
    const link = /href="([^"]+\/admin\/invite\/[^"]+)"/.exec(mail.body.htmlContent)?.[1]
    check(link, 'lien introuvable dans l\'e-mail')
    const thief = await t.newPage({ context: await t.newContext() })
    await thief.goto(link, { waitUntil: 'networkidle0' })
    await says(thief, 'Bonjour Claire Durand')
    const inputs = await thief.$$('input[type=password]')
    claire.password = 'nouveau-mot-de-passe-1'
    await inputs[0].type(claire.password); await inputs[1].type(claire.password)
    await thief.click('button.btn-primary')
    // Le nouveau mot de passe est enregistré, mais on n'entre pas : le code est demandé.
    await says(thief, 'Vérification en deux étapes')
    check((await api(thief, '/api/cms/me')).status === 401, 'connecté sans code après un nouveau mot de passe')
    await thief.goto(B + '/admin', { waitUntil: 'networkidle0' })
    await thief.waitForFunction(() => location.pathname === '/admin/login')
    // Avec le nouveau mot de passe seul, par l'API : toujours pas.
    const r = await t.http().signIn(claire.email, claire.password)
    check(r.status === 200 && r.json.twoFactorRedirect === true, 'code non demandé après un nouveau mot de passe')
    // L'appareil « de confiance » d'avant le changement de mot de passe doit lui aussi redonner un code.
    check((await boss.get('/api/cms/me')).status === 401, 'les sessions ouvertes auraient dû être fermées')
    // Avec le code, la vraie propriétaire entre.
    await passwordStep(thief, claire)
    await typeLoginCode(thief, await freshCode(secret))
    await thief.waitForSelector('aside .menu')
    await thief.close()
  })

  await step('un lien créé par un administrateur (« Nouveau mot de passe ») ne retire pas non plus le second facteur', async () => {
    const chief = await signInWithCode(claire, secret)
    const users = await chief.json('/api/cms/users')
    const marc = users.find(u => u.email === MARC.email)
    check(marc.twoFactor === true, 'Marc devrait avoir réactivé la double authentification')
    const { link } = await chief.json(`/api/cms/users/${marc.id}/invite`, { method: 'POST' })
    MARC.password = 'autre-mot-de-passe-de-marc'
    check((await t.http().post(inviteApi(link), { password: MARC.password })).status === 200, 'nouveau mot de passe refusé')
    const r = await t.http().signIn(MARC.email, MARC.password)
    check(r.status === 200 && r.json.twoFactorRedirect === true, 'code non demandé')
    await signInWithCode(MARC, marcSecret)
  })

  // ───── Écrans en largeur de téléphone ─────

  await step('connexion en largeur de téléphone : étape du code lisible, sans défilement horizontal', async () => {
    const phone = await t.newPage({ context: await t.newContext(), width: 390, height: 844 })
    await passwordStep(phone, claire)
    await says(phone, 'Vérification en deux étapes')
    const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check(overflow <= 0, 'la page dépasse de ' + overflow + ' px')
    const input = await phone.$eval('[data-login-code] input:not([type=checkbox])', e => ({ mode: e.inputMode, auto: e.autocomplete, focused: document.activeElement === e, h: e.getBoundingClientRect().height }))
    check(input.mode === 'numeric' && input.auto === 'one-time-code' && input.focused && input.h >= 36, JSON.stringify(input))
    await t.shot(phone, 'connexion-code-telephone')
    // Au clavier seulement : code de secours, tabulation jusqu'au bouton, Entrée.
    await clickText(phone, '[data-login-code] button', 'Utiliser un code de secours')
    await phone.waitForFunction(() => document.activeElement?.placeholder === 'xxxxx-xxxxx')
    await phone.keyboard.type(backupCodes[0])
    await phone.keyboard.press('Enter')
    await phone.waitForSelector('aside .menu')
    await phone.close()
  })

  // ───── Procédure de secours de l'hébergeur ─────

  await step('procédure de secours (commande SQL du README) : le dernier administrateur retrouve l\'accès avec son mot de passe', async () => {
    if (!hasSqlite) return t.info('sqlite3 absent : procédure non rejouée')
    const readme = fs.readFileSync(path.join(config.rootDir, 'packages', 'create-site', 'template', 'README.md'), 'utf8')
    const command = /--command "(DELETE FROM two_factor[^"]+)"/.exec(readme)?.[1]
    check(command, 'commande introuvable dans le README du modèle')
    const statement = command.replaceAll('vous@exemple.fr', claire.email)
    sql(statement, { write: true })
    const client = t.http()
    const r = await until(async () => {
      const r = await client.signIn(claire.email, claire.password)
      return r.status === 200 && !r.json.twoFactorRedirect ? r : null
    }, 'connexion sans code après la commande')
    check(r.status === 200, 'connexion refusée')
    // La règle du site est toujours là : l'administratrice doit réactiver avant de faire autre chose.
    const me = await client.json('/api/cms/me')
    check(me.twoFactor.enabled === false && me.twoFactor.setupRequired === true, JSON.stringify(me.twoFactor))
    check((await client.get('/api/cms/users')).status === 403, 'API ouverte sans réactivation')
    await enableByApi(client, claire)
    check((await client.get('/api/cms/users')).status === 200, 'API refusée après réactivation')
  })
}
