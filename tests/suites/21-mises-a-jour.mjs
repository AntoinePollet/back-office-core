// Avis de nouvelle version du core en bas du menu : GitHub est joué par le faux service.
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { config } from '../lib/config.mjs'
import { check, login, says } from '../lib/harness.mjs'
import { hasSqlite, runSql } from '../lib/sqlite.mjs'

export const meta = {
  title: 'avis de nouvelle version (GitHub joué par le faux service)',
  mock: true,
  env: ({ mock }) => ({ NUXT_CMS_UPDATE_URL: `${mock}/github/releases/latest` }),
}

const MARC = { name: 'Marc Petit', email: 'marc@example.com', password: 'mot-de-passe-de-marc', role: 'editor' }
const DAY = 24 * 60 * 60 * 1000

/** Fichier de la base locale du serveur de test, pour simuler le temps qui passe. Null si introuvable. */
function databaseFile() {
  const find = (dir) => {
    if (!existsSync(dir)) return null
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { const hit = find(full); if (hit) return hit }
      else if (entry.name.endsWith('.sqlite') && !entry.name.includes('metadata')) return full
    }
    return null
  }
  return find(config.tmpDir)
}

export default async function (t) {
  const { step, admin, B, M, info } = t
  const claire = t.http(), marc = t.http(), visitor = t.http()
  const github = () => t.calls().filter(c => c.url === '/github/releases/latest')
  const setGithub = body => fetch(`${M}/github/_regler`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  /** Ligne « Version … » en bas du menu, et son lien éventuel. */
  const versionLine = page => page.$eval('aside [title="Version du back-office"]', el => ({ text: el.innerText.replace(/\s+/g, ' ').trim(), link: el.querySelector('a')?.href ?? null, target: el.querySelector('a')?.target ?? null }))
  /** Ouvre le back-office et attend la réponse à la question « y a-t-il une version plus récente ? ». */
  const openAdmin = async (page) => {
    const answered = page.waitForResponse(r => r.url().endsWith('/api/cms/update'))
    await page.goto(B + '/admin', { waitUntil: 'networkidle0' })
    await answered
    return versionLine(page)
  }
  /** Fait comme si la dernière interrogation de GitHub datait de `ms` millisecondes. Faux si l'outil sqlite3 manque. */
  const lastCheckWas = (ms) => {
    const file = databaseFile()
    if (!file || !hasSqlite()) return false
    runSql(file, `update cms_settings set value = json_set(value, '$.checkedAt', ${Date.now() - ms}) where key = 'updateCheck'`)
    return true
  }
  let current
  let canAge = true

  await step('préparation : une version plus récente existe ; une personne non administratrice', async () => {
    await setGithub({ tag: 'v99.1.0' })
    check((await claire.signIn(admin.email, admin.password)).status === 200, 'connexion de l\'administratrice refusée')
    const { link } = await claire.json('/api/cms/users', { method: 'POST', body: { name: MARC.name, email: MARC.email, role: MARC.role } })
    await visitor.post(link.replace(/^.*\/admin\/invite\//, '/api/cms/invite/'), { password: MARC.password })
    check((await marc.signIn(MARC.email, MARC.password)).status === 200, 'connexion de Marc refusée')
  })

  await step('éditeur et visiteur : ni avis ni interrogation de GitHub', async () => {
    check((await visitor.get('/api/cms/update')).status === 401, 'visiteur : ' + (await visitor.get('/api/cms/update')).status)
    check((await marc.get('/api/cms/update')).status === 403, 'éditeur : ' + (await marc.get('/api/cms/update')).status)
    const page = await t.newPage({ context: await t.newContext() })
    await login(page, B, MARC)
    await says(page, 'Médiathèque')
    const line = await versionLine(page)
    check(/^Version \d+\.\d+\.\d+$/.test(line.text) && !line.link, 'ligne affichée à l\'éditeur : ' + line.text)
    check(github().length === 0, 'GitHub interrogé pour une personne non administratrice')
    await page.close()
  })

  const page = await t.newPage()
  await step('administratrice : « la 99.1.0 est disponible », lien vers les notes ; GitHub interrogé une fois, sans jeton', async () => {
    await login(page, B)
    const line = await openAdmin(page)
    current = line.text.match(/^Version (\d+\.\d+\.\d+)/)?.[1]
    check(line.text === `Version ${current} — la 99.1.0 est disponible`, 'ligne : ' + line.text)
    check(line.link === 'https://github.com/exemple/core/releases/tag/v99.1.0' && line.target === '_blank', `lien : ${line.link} (${line.target})`)
    check(github().length === 1 && github()[0].auth === null, `appels : ${github().length}, autorisation : ${github()[0]?.auth}`)
  })
  await t.shot(page, 'avis-de-version')

  await step('cache : dans la journée, GitHub n\'est pas réinterrogé, même si une version sort entre-temps', async () => {
    await setGithub({ tag: 'v99.2.0' })
    const line = await openAdmin(page)
    check(line.text.endsWith('la 99.1.0 est disponible'), 'ligne : ' + line.text)
    const status = await claire.json('/api/cms/update')
    check(status.current === current && status.latest === '99.1.0', JSON.stringify(status))
    check(github().length === 1, 'appels à GitHub : ' + github().length)
  })

  await step('un jour plus tard : nouvelle interrogation, la 99.2.0 est annoncée', async () => {
    canAge = lastCheckWas(DAY + 1000)
    if (!canAge) { info('non vérifié ici : il faut l\'outil sqlite3 pour simuler le temps qui passe (étapes suivantes comprises)'); return }
    const line = await openAdmin(page)
    check(line.text.endsWith('la 99.2.0 est disponible') && line.link.endsWith('/v99.2.0'), 'ligne : ' + line.text)
    check(github().length === 2, 'appels à GitHub : ' + github().length)
  })

  await step('GitHub en panne : le back-office s\'affiche, garde la dernière version connue, et ne réessaie pas avant un jour', async () => {
    if (!canAge) return
    await setGithub({ status: 500 })
    lastCheckWas(DAY + 1000)
    const line = await openAdmin(page)
    await says(page, 'Médiathèque')
    check(line.text.endsWith('la 99.2.0 est disponible'), 'ligne : ' + line.text)
    check((await claire.get('/api/cms/update')).status === 200 && github().length === 3, 'appels à GitHub : ' + github().length)
  })

  await step('GitHub très lent : la réponse n\'est pas attendue plus de quelques secondes, le menu s\'affiche sans attendre', async () => {
    if (!canAge) return
    await setGithub({ status: 200, tag: 'v99.3.0', delay: 8000 })
    lastCheckWas(DAY + 1000)
    const start = Date.now()
    await page.goto(B + '/admin', { waitUntil: 'domcontentloaded' })
    await says(page, 'Médiathèque')
    const menu = Date.now() - start
    const r = await claire.get('/api/cms/update')
    const total = Date.now() - start
    check(r.status === 200 && r.json.latest === '99.2.0', `${r.status} ${r.text}`)
    check(menu < 3000 && total < 7000, `menu affiché en ${menu} ms, réponse en ${total} ms`)
    await setGithub({ delay: 0 })
  })

  await step('site à jour : plus d\'avis quand la dernière version est celle installée', async () => {
    if (!canAge) return
    await setGithub({ status: 200, tag: `v${current}`, delay: 0 })
    lastCheckWas(DAY + 1000)
    const line = await openAdmin(page)
    check(line.text === `Version ${current}` && !line.link, 'ligne : ' + line.text)
  })

  await step('réponse inattendue de GitHub (préversion) : ignorée, sans erreur', async () => {
    if (!canAge) return
    await setGithub({ tag: 'v100.0.0-beta.1' })
    lastCheckWas(DAY + 1000)
    const r = await claire.get('/api/cms/update')
    check(r.status === 200 && r.json.latest === null, `${r.status} ${r.text}`)
  })
}
