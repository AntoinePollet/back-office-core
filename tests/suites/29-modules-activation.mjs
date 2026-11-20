// Activation des modules depuis le back-office : tous les modules montrés, interrupteurs, effets sur le site et le menu ; Plausible.
import { check, login, menuLabels, says, until } from '../lib/harness.mjs'

export const meta = {
  title: 'modules activés depuis le back-office, Plausible',
  mock: true,
  env: ({ mock }) => ({
    NUXT_PLAUSIBLE_API_URL: `${mock}/plausible`,
    NUXT_CLOUDFLARE_API_URL: `${mock}/client/v4`,
    // En local il n'y a pas de cache à vider : chaque purge est déclarée échouée, ce qui prouve qu'elle est tentée.
    CMS_DEV_SIMULATE_PURGE_FAILURE: '1',
  }),
}

const PLAUSIBLE_KEY = 'cle-stats-plausible-4321'
const PLAUSIBLE_TAG = '<script defer data-domain="cabinet-durand.fr" src="https://plausible.io/js/script.js"></script>'
const MARC = { name: 'Marc Petit', email: 'marc@example.com', password: 'mot-de-passe-de-marc', role: 'editor' }
const VISITOR = { name: 'Jeanne Martin', email: 'jeanne@example.com', subject: 'devis', message: 'Bonjour, je voudrais un devis.', consent: true }

export default async function (t) {
  const { B, step, calls } = t
  const claire = t.http(), marc = t.http(), visitor = t.http()
  const modules = () => claire.json('/api/cms/modules')
  const one = async id => (await modules()).find(m => m.id === id)
  const toggle = (id, enabled, client = claire) => client.call(`/api/cms/modules/${id}/enabled`, { method: 'PUT', body: { enabled } })
  const home = async () => (await visitor.get('/')).text
  const queries = () => calls().filter(c => c.url === '/plausible/api/v2/query')
  let ip = 10
  const sendForm = values => visitor.call('/api/forms/contact', { method: 'POST', body: { values }, headers: { 'cf-connecting-ip': `203.0.113.${ip++}` } })

  await step('préparation : administratrice, éditeur', async () => {
    check((await claire.signIn(t.admin.email, t.admin.password)).status === 200, 'connexion refusée')
    const { link } = await claire.json('/api/cms/users', { method: 'POST', body: { name: MARC.name, email: MARC.email, role: MARC.role } })
    check((await visitor.post(`/api/cms/invite/${link.replace(/^.*\/admin\/invite\//, '')}`, { password: MARC.password })).status === 200, 'invitation')
    check((await marc.signIn(MARC.email, MARC.password)).status === 200, 'connexion de l\'éditeur')
  })

  await step('tous les modules sont listés : déclarés activés, les autres désactivés, avec leur famille', async () => {
    const list = await modules()
    const state = Object.fromEntries(list.map(m => [m.id, `${m.category}:${m.enabled ? 'on' : 'off'}`]))
    const expected = { brevo: 'email:on', resend: 'email:on', analytics: 'audience:on', plausible: 'audience:off', forms: 'forms:on', stripe: 'payment:on', turnstile: 'security:on' }
    for (const [id, value] of Object.entries(expected)) check(state[id] === value, `${id} : ${state[id]} au lieu de ${value}`)
    check(list.every(m => m.canEnable && m.needsCode === null), 'un module déclaré annoncé comme à déclarer')
    check((await claire.get('/api/cms/modules/plausible')).status === 200, 'réglages d\'un module désactivé inaccessibles')
    check((await claire.get('/api/cms/modules/inconnu')).status === 404, 'module inconnu')
  })

  await step('droits : seul l\'administrateur active ou désactive', async () => {
    check((await toggle('plausible', true, marc)).status === 403, 'l\'éditeur a activé un module')
    check((await toggle('plausible', true, visitor)).status === 401, 'un visiteur a activé un module')
    check((await toggle('plausible', 'oui')).status === 400, 'valeur invalide acceptée')
    check((await toggle('inconnu', true)).status === 404, 'module inconnu activé')
  })

  await step('Plausible : réglé avant d\'être activé, rien sur le site tant qu\'il est désactivé', async () => {
    const bad = await claire.call('/api/cms/modules/plausible', { method: 'PUT', body: { values: { domain: 'https://cabinet-durand.fr/' } } })
    check(bad.status === 400 && bad.json.message.includes('Domaine'), 'domaine invalide accepté : ' + bad.text)
    const saved = await claire.json('/api/cms/modules/plausible', { method: 'PUT', body: { values: { domain: 'cabinet-durand.fr' }, secrets: { apiKey: PLAUSIBLE_KEY } } })
    check(saved.configured && !saved.enabled, JSON.stringify(saved).slice(0, 200))
    check(!(await home()).includes('plausible.io/js/script.js'), 'balise Plausible présente alors que le module est désactivé')
  })

  await step('Plausible activé : balise sur le site, vérification, statistiques dans l\'écran Audience', async () => {
    const r = await toggle('plausible', true)
    check(r.status === 200 && r.json.enabled && r.json.purgeFailed === true, 'activation ou purge : ' + r.text.slice(0, 200))
    check((await home()).includes(PLAUSIBLE_TAG), 'balise Plausible absente du site')
    const test = await claire.json('/api/cms/modules/plausible/test', { method: 'POST', body: {} })
    check(test.ok && test.message === 'Connexion réussie : 63 pages vues ces 7 derniers jours.', test.message)
    const q = queries().at(-1)
    check(q.key === PLAUSIBLE_KEY && q.body.site_id === 'cabinet-durand.fr', 'requête : ' + JSON.stringify(q))
    // Cloudflare (déclaré) n'est pas réglé : l'écran Audience lit Plausible.
    const audience = await marc.json('/api/cms/audience?period=7')
    check(audience.state === 'ok' && audience.source === 'Plausible' && audience.stats.totals.pageViews === 63 && audience.stats.totals.visits === 21, JSON.stringify(audience).slice(0, 300))
    check(audience.stats.pages[1]?.path === '/plausible-contact' && audience.stats.referrers[0].host === null && audience.stats.referrers[1].host === 'DuckDuckGo', 'pages ou sources')
  })

  await step('Plausible : clé refusée et domaine inconnu, avec un message clair', async () => {
    await claire.json('/api/cms/modules/plausible', { method: 'PUT', body: { secrets: { apiKey: 'mauvaise-cle-plausible' } } })
    let test = await claire.json('/api/cms/modules/plausible/test', { method: 'POST', body: {} })
    check(!test.ok && test.message.startsWith('Plausible refuse cette clé'), test.message)
    await claire.json('/api/cms/modules/plausible', { method: 'PUT', body: { values: { domain: 'inconnu.fr' }, secrets: { apiKey: PLAUSIBLE_KEY } } })
    test = await claire.json('/api/cms/modules/plausible/test', { method: 'POST', body: {} })
    check(!test.ok && test.message.startsWith('Plausible ne trouve pas ce site'), test.message)
    await claire.json('/api/cms/modules/plausible', { method: 'PUT', body: { values: { domain: 'cabinet-durand.fr' } } })
  })

  await step('mesure d\'audience entièrement désactivée : plus de balise, plus d\'écran Audience', async () => {
    check((await toggle('plausible', false)).json.enabled === false, 'désactivation')
    check(!(await home()).includes('plausible.io'), 'balise encore présente')
    check((await marc.get('/api/cms/audience?period=7')).status === 200, 'Cloudflare encore actif : l\'écran doit rester')
    check((await toggle('analytics', false)).status === 200, 'désactivation de Cloudflare')
    check((await marc.get('/api/cms/audience?period=7')).status === 404, 'écran Audience toujours servi')
    const schema = await marc.json('/api/cms/schema')
    check(!schema.modules.some(m => m.category === 'audience'), 'le menu verrait encore l\'audience : ' + JSON.stringify(schema.modules))
    // Les réglages sont gardés.
    check((await one('plausible')).configured, 'réglages perdus à la désactivation')
  })

  await step('formulaires désactivés : envoi refusé, messages et workflow absents ; réactivés : tout revient', async () => {
    const first = await sendForm(VISITOR); check(first.status === 200, 'envoi refusé avant désactivation : ' + first.status + ' ' + first.text.slice(0, 200))
    check((await toggle('forms', false)).status === 200, 'désactivation')
    check((await sendForm(VISITOR)).status === 404, 'envoi accepté par un module désactivé')
    check((await marc.get('/api/cms/forms')).status === 404, 'messages reçus encore lisibles')
    check(!(await claire.json('/api/cms/workflows')).events.some(e => e.name === 'form.submitted'), 'déclencheur « formulaire envoyé » encore proposé')
    check((await toggle('forms', true)).status === 200, 'réactivation')
    check((await sendForm(VISITOR)).status === 200, 'envoi refusé après réactivation')
    check((await marc.json('/api/cms/forms')).submissions.length === 2, 'messages perdus')
  })

  await step('envoi d\'e-mails : désactiver Brevo et Resend coupe le mot de passe oublié', async () => {
    await toggle('brevo', false); await toggle('resend', false)
    check((await visitor.get('/api/cms/password-reset')).json.available === false, 'mot de passe oublié proposé sans module d\'envoi')
    await toggle('brevo', true); await toggle('resend', true)
  })

  await step('journal d\'activité : activations et désactivations', async () => {
    const items = (await claire.json('/api/cms/activity?limit=50&category=settings')).items
    const summaries = items.map(i => i.summary)
    check(summaries.some(s => s.endsWith('a activé le module « Plausible »')) && summaries.some(s => s.endsWith('a désactivé le module « Formulaires »')), summaries.join(' | '))
    check(items.filter(i => i.action.startsWith('module.')).every(i => i.link?.startsWith('/admin/modules/')), 'liens du journal')
  })

  const page = await t.newPage()
  await step('écran Modules : familles, interrupteurs, menu mis à jour sans recharger', async () => {
    await login(page, B)
    await page.goto(B + '/admin/modules', { waitUntil: 'networkidle0' })
    const headings = await page.$$eval('main h2', hs => hs.map(h => h.textContent.trim()))
    check(headings.join() === 'Envoi d\'e-mails,Mesure d\'audience,Formulaires,Paiement,Sécurité', 'familles : ' + headings.join())
    check(!(await menuLabels(page)).includes('Audience'), 'menu Audience alors que la mesure est désactivée')
    await t.shot(page, 'liste')
    await page.click('[data-module="plausible"] input[type=checkbox]')
    await says(page, 'Plausible activé')
    await until(async () => (await menuLabels(page)).includes('Audience'), 'Audience ajouté au menu')
    // Désactiver demande confirmation ; refuser laisse le module activé. (Les pages de test acceptent tout : on refuse ici.)
    await page.evaluate(() => { window.__confirm = window.confirm; window.confirm = () => false })
    await page.click('[data-module="plausible"] input[type=checkbox]')
    await page.evaluate(() => { window.confirm = window.__confirm })
    check(await page.$eval('[data-module="plausible"] input[type=checkbox]', i => i.checked), 'interrupteur changé malgré le refus')
    check((await one('plausible')).enabled, 'module désactivé malgré le refus')
    await page.click('[data-module="plausible"] input[type=checkbox]')
    await says(page, 'Plausible désactivé')
    await until(async () => !(await menuLabels(page)).includes('Audience'), 'Audience retiré du menu')
  })

  await step('écran d\'un module désactivé : réglable, et activable depuis son écran', async () => {
    await page.goto(B + '/admin/modules/plausible', { waitUntil: 'networkidle0' })
    await page.waitForSelector('[data-module-disabled]')
    await page.click('[data-module-enabled]')
    await says(page, 'Module activé')
    await page.waitForFunction(() => !document.querySelector('[data-module-disabled]'))
    await t.shot(page, 'plausible')
  })

  await step('téléphone : l\'écran Modules ne déborde pas', async () => {
    const phone = await t.newPage({ width: 390, height: 844 })
    await phone.goto(B + '/admin/modules', { waitUntil: 'networkidle0' })
    const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    check(overflow <= 0, `débordement horizontal : ${overflow} px`)
    await t.shot(phone, 'telephone')
  })
}
