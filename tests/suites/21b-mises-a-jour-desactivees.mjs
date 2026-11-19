// Avis de nouvelle version désactivé par le développeur (NUXT_CMS_UPDATE_CHECK=false) : GitHub n'est jamais interrogé.
import { check, login, says } from '../lib/harness.mjs'

export const meta = {
  title: 'avis de nouvelle version désactivé',
  mock: true,
  env: ({ mock }) => ({ NUXT_CMS_UPDATE_URL: `${mock}/github/releases/latest`, NUXT_CMS_UPDATE_CHECK: 'false' }),
}

export default async function (t) {
  const { step, admin, B, M } = t
  const claire = t.http()

  await step('désactivé : aucune interrogation de GitHub, aucun avis, même si une version plus récente existe', async () => {
    await fetch(`${M}/github/_regler`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tag: 'v99.1.0' }) })
    check((await claire.signIn(admin.email, admin.password)).status === 200, 'connexion refusée')
    const status = await claire.json('/api/cms/update')
    check(/^\d+\.\d+\.\d+$/.test(status.current) && status.latest === null && status.url === null, JSON.stringify(status))
    const page = await t.newPage()
    await login(page, B)
    const answered = page.waitForResponse(r => r.url().endsWith('/api/cms/update'))
    await page.goto(B + '/admin', { waitUntil: 'networkidle0' })
    await answered
    await says(page, 'Médiathèque')
    const line = await page.$eval('aside [title="Version du back-office"]', el => el.innerText.trim())
    check(line === `Version ${status.current}`, 'ligne : ' + line)
    check(t.calls().filter(c => c.url.startsWith('/github/releases')).length === 0, 'GitHub interrogé alors que l\'avis est désactivé')
  })
}
