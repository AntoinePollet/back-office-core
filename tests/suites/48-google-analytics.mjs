// Module Google Analytics : réglages, vérification de la connexion, refus traduits, balise sans script, script de
// Google chargé seulement après l'accord du visiteur (finalité « Mesure d'audience » du bandeau), arrêt au retrait de
// l'accord, chiffres dans l'écran « Audience », choix de la source quand Cloudflare est réglé aussi.
import { config } from '../lib/config.mjs'
import { check, login, says } from '../lib/harness.mjs'
import { GA_DOWN, GA_EMPTY, GA_NO_API, GA_TOTALS, GA_UNKNOWN, SECRET_UNKNOWN, TOKEN_REVOKED, TOKEN_WITHOUT_ANALYTICS } from '../lib/mock-google.mjs'

export const meta = {
  title: 'Google Analytics : réglages, accord du visiteur, chiffres dans « Audience »',
  mock: true,
  env: ({ mock }) => ({
    NUXT_GOOGLE_ANALYTICS_API_URL: `${mock}/google-analytics/v1beta`,
    NUXT_GOOGLE_OAUTH_TOKEN_URL: `${mock}/google/token`,
    NUXT_CLOUDFLARE_API_URL: `${mock}/client/v4`,
  }),
}

const CLIENT = '1234-abcd.apps.googleusercontent.com'
const SECRET = 'GOCSPX-secret-du-client'
const TOKEN = 'jeton-analytics-1'
const MEASUREMENT = 'G-TEST1234AB'
const PROPERTY = '123456789'
const META = `<meta name="cms-google-analytics" content="${MEASUREMENT}">`
const KEY = 'cms-consent'

export default async function (t) {
  const { B, step, calls } = t
  const page = await t.newPage()
  const claire = t.http(), lina = t.http(), visitor = t.http()
  const reports = () => calls().filter(c => c.url.includes(':batchRunReports'))
  const save = (values, secrets) => claire.call('/api/cms/modules/google-analytics', { method: 'PUT', body: { values, ...(secrets ? { secrets } : {}) } })
  const verify = async () => (await claire.json('/api/cms/modules/google-analytics/test', { method: 'POST' }))
  const audience = (query = 'period=7', client = claire) => client.call(`/api/cms/audience?${query}`)
  const html = async path => (await visitor.get(path)).text
  const consentTag = text => JSON.parse(/<script type="application\/json" id="cms-consent-config">(.*?)<\/script>/s.exec(text)?.[1] ?? 'null')
  let ip = 90
  /** Une page de visiteur : le script de Google n'est jamais vraiment téléchargé, sa demande est seulement relevée. */
  const visitorPage = async () => {
    const context = await t.newContext(); const p = await t.newPage({ context })
    await p.setExtraHTTPHeaders({ [config.ipHeader]: `203.0.113.${ip++}` })
    const asked = []
    await p.setRequestInterception(true)
    p.on('request', (request) => {
      if (/googletagmanager\.com|google-analytics\.com/.test(request.url())) { asked.push(request.url()); request.abort() }
      else request.continue()
    })
    return { p, context, asked }
  }
  const act = (p, action) => p.$eval(`[data-cms-consent-action=${action}]`, b => b.click())
  const ga = p => p.evaluate(id => ({
    script: !!document.querySelector('script[src^="https://www.googletagmanager.com/gtag/js"]'),
    layer: (window.dataLayer ?? []).map(a => Array.from(a).map(String)),
    disabled: window[`ga-disable-${id}`],
  }), MEASUREMENT)

  await step('module désactivé puis activé : famille « Mesure d\'audience », à régler ; pas de balise', async () => {
    await login(page, B)
    check((await claire.signIn(t.admin.email, t.admin.password)).status === 200, 'connexion refusée')
    const listed = (await claire.json('/api/cms/modules')).find(m => m.id === 'google-analytics')
    check(listed && !listed.enabled && listed.category === 'audience' && listed.canEnable, JSON.stringify(listed))
    check((await claire.call('/api/cms/modules/google-analytics/enabled', { method: 'PUT', body: { enabled: true } })).status === 200, 'activation refusée')
    check(!(await html('/')).includes('cms-google-analytics'), 'balise présente sans réglage')
    check(reports().length === 0, 'Google appelé sans réglages')
  })

  await step('réglages : identifiants mal écrits refusés, secrets jamais renvoyés', async () => {
    const bad = await save({ measurementId: 'UA-12345-1', propertyId: MEASUREMENT, clientId: 'pas-un-client' })
    check(bad.status === 400 && /UA-…/.test(bad.json.message) && /des chiffres seulement/.test(bad.json.message) && /apps\.googleusercontent\.com/.test(bad.json.message), `${bad.status} ${bad.text}`)
    const inject = await save({ measurementId: 'G-ABCD"><script>alert(1)</script>' })
    check(inject.status === 400, 'identifiant de mesure dangereux accepté')
    const saved = (await save({ measurementId: MEASUREMENT.toLowerCase(), propertyId: `properties/${PROPERTY}`, clientId: CLIENT }, { clientSecret: SECRET, refreshToken: TOKEN })).json
    check(saved.configured && saved.enabled, JSON.stringify(saved).slice(0, 300))
    const text = (await claire.get('/api/cms/modules/google-analytics')).text
    check(!text.includes(SECRET) && !text.includes(TOKEN), 'un secret est renvoyé par l\'API')
  })

  await step('vérifier la connexion : chiffres lus, et rappel que le module Consentement manque', async () => {
    const r = await verify()
    check(r.ok && r.message.startsWith(`Connexion réussie : ${GA_TOTALS.pageViews} pages vues ces 7 derniers jours.`) && /le module Consentement n'est pas actif/.test(r.message), JSON.stringify(r))
    const token = calls().find(c => c.url === '/google/token')
    check(token.body.client_id === CLIENT && token.body.client_secret === SECRET && token.body.refresh_token === TOKEN, JSON.stringify(token.body))
    const call = reports().at(-1)
    check(call.url === `/google-analytics/v1beta/properties/${PROPERTY}:batchRunReports` && call.auth === `Bearer acces-${TOKEN}`, JSON.stringify(call).slice(0, 300))
    check(call.body.requests.length === 4 && call.body.requests[2].dimensions[0].name === 'pagePath', JSON.stringify(call.body).slice(0, 400))
  })

  await step('refus de Google traduits : propriété inconnue, API non activée, jeton sans l\'autorisation ou révoqué, secret inconnu, panne', async () => {
    await save({ propertyId: GA_UNKNOWN })
    let r = await verify()
    check(!r.ok && /n'a pas accès à cette propriété Google Analytics/.test(r.message), JSON.stringify(r))
    const refused = (await audience('period=7&source=google-analytics')).json
    check(refused.state === 'refused' && /Détails de la propriété/.test(refused.message), JSON.stringify(refused))
    await save({ propertyId: GA_NO_API })
    r = await verify()
    check(!r.ok && /Google Analytics Data API » n'est pas activée/.test(r.message), JSON.stringify(r))
    await save({ propertyId: GA_DOWN })
    r = await verify()
    check(!r.ok && /ne répond pas pour le moment/.test(r.message), JSON.stringify(r))
    check((await audience()).json.state === 'unavailable', 'panne non signalée dans l\'écran')
    await save({ propertyId: PROPERTY }, { refreshToken: TOKEN_WITHOUT_ANALYTICS })
    r = await verify()
    check(!r.ok && /analytics\.readonly/.test(r.message), JSON.stringify(r))
    await save({}, { refreshToken: TOKEN_REVOKED })
    r = await verify()
    check(!r.ok && /expiré ou a été révoqué/.test(r.message), JSON.stringify(r))
    await save({}, { refreshToken: TOKEN, clientSecret: SECRET_UNKNOWN })
    r = await verify()
    check(!r.ok && /identifiant client OAuth ou son secret/.test(r.message), JSON.stringify(r))
    await save({ propertyId: GA_EMPTY }, { clientSecret: SECRET })
    r = await verify()
    check(r.ok && /Aucune visite n'est encore enregistrée/.test(r.message), JSON.stringify(r))
    await save({ propertyId: PROPERTY })
  })

  await step('balise : l\'identifiant seul, sans script de Google ; jamais dans le back-office ni dans l\'aperçu', async () => {
    const home = await html('/')
    check(home.split(META).length === 2, 'balise absente ou en double')
    check(!home.includes('googletagmanager') && !home.includes('gtag('), 'le script de Google est dans la page servie')
    check(!(await html('/admin/login')).includes('cms-google-analytics'), 'balise dans le back-office')
    check(!(await claire.get('/?preview=1')).text.includes('cms-google-analytics'), 'balise dans l\'aperçu')
  })

  await step('sans le module Consentement : rien n\'est chargé, aucun accord n\'étant demandé', async () => {
    const { p, context, asked } = await visitorPage()
    await p.goto(B + '/', { waitUntil: 'networkidle0' })
    const state = await ga(p)
    check(!state.script && !state.layer.length && !asked.length, JSON.stringify({ state, asked }))
    await context.close()
  })

  await step('avec le module Consentement : finalité « Mesure d\'audience » proposée ; rien avant le choix, rien après un refus', async () => {
    check((await claire.call('/api/cms/modules/consent/enabled', { method: 'PUT', body: { enabled: true } })).status === 200, 'activation refusée')
    const sent = consentTag(await html('/'))
    check(sent && sent.purposes[0].id === 'audience' && sent.purposes[0].label === 'Mesure d\'audience' && sent.purposes.some(p => p.id === 'ads'), JSON.stringify(sent))
    check((await verify()).message === `Connexion réussie : ${GA_TOTALS.pageViews} pages vues ces 7 derniers jours.`, 'rappel du consentement encore affiché')
    const { p, context, asked } = await visitorPage()
    await p.goto(B + '/', { waitUntil: 'networkidle0' })
    await p.waitForSelector('[data-cms-consent]')
    check((await p.$eval('[data-cms-consent]', e => e.innerText)).includes('Tout refuser'), 'bandeau incomplet')
    let state = await ga(p)
    check(!state.script && !asked.length, 'Google chargé avant le choix : ' + JSON.stringify(asked))
    await act(p, 'refuse')
    await p.waitForFunction(() => !document.querySelector('[data-cms-consent]'))
    state = await ga(p)
    check(!state.script && !asked.length && state.disabled === true, JSON.stringify({ state, asked }))
    await context.close()
  })

  await step('accord donné : script de Google demandé avec l\'identifiant, une seule fois, y compris à la visite suivante', async () => {
    const { p, context, asked } = await visitorPage()
    await p.goto(B + '/', { waitUntil: 'networkidle0' })
    await p.waitForSelector('[data-cms-consent]')
    await act(p, 'accept')
    await p.waitForFunction(() => !!document.querySelector('script[src^="https://www.googletagmanager.com/gtag/js"]'))
    let state = await ga(p)
    check(state.layer.length === 2 && state.layer[0][0] === 'js' && state.layer[1].join(' ') === `config ${MEASUREMENT}` && state.disabled === false, JSON.stringify(state))
    check(asked.length === 1 && asked[0] === `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT}`, JSON.stringify(asked))
    check((await p.evaluate(key => JSON.parse(localStorage.getItem(key)).choices, KEY)).audience === true, 'choix non gardé')
    // Visite suivante : le choix est relu, le script est chargé sans redemander.
    await p.goto(B + '/', { waitUntil: 'networkidle0' })
    await p.waitForFunction(() => !!document.querySelector('script[src^="https://www.googletagmanager.com/gtag/js"]'))
    check(!(await p.$('[data-cms-consent]')) && asked.length === 2, 'bandeau redemandé, ou script non rechargé : ' + asked.length)

    // Retrait de l'accord : la mesure s'arrête tout de suite et les cookies de Google Analytics sont retirés.
    await p.evaluate((id) => { document.cookie = '_ga=GA1.1.1.1; path=/'; document.cookie = `_ga_${id.slice(2)}=GS1.1.1; path=/`; document.cookie = 'autre=1; path=/' }, MEASUREMENT)
    await p.waitForSelector('[data-cms-consent-link]')
    await p.$eval('[data-cms-consent-link]', b => b.click())
    await p.waitForSelector('[data-cms-consent]')
    await act(p, 'refuse')
    await p.waitForFunction(() => !document.querySelector('[data-cms-consent]'))
    state = await ga(p)
    const cookies = await p.evaluate(() => document.cookie)
    check(state.disabled === true && !cookies.includes('_ga') && cookies.includes('autre=1'), JSON.stringify({ disabled: state.disabled, cookies }))
    await context.close()
  })

  await step('écran Audience : chiffres de Google Analytics, avec la réserve sur l\'accord des visiteurs', async () => {
    const before = reports().length
    const answer = (await audience('period=30')).json
    check(answer.state === 'ok' && answer.module === 'google-analytics' && answer.cookies === true && answer.sources.length === 1, JSON.stringify(answer).slice(0, 300))
    check(answer.stats.totals.visits === GA_TOTALS.visits && answer.stats.days.length === 30 && answer.stats.days.at(-1).pageViews === 75, JSON.stringify(answer.stats.totals))
    check(JSON.stringify(answer.stats.referrers) === JSON.stringify([{ host: 'google', visits: 18 }, { host: null, visits: 15 }, { host: 'facebook.com', visits: 7 }]), JSON.stringify(answer.stats.referrers))
    await audience('period=30')
    check(reports().length === before + 1, 'chiffres redemandés à Google avant cinq minutes')
    await page.goto(B + '/admin/audience', { waitUntil: 'networkidle0' })
    await says(page, 'pour les visiteurs qui ont accepté la mesure d\'audience')
    await says(page, 'Source : Google Analytics.')
    await says(page, 'ces chiffres sont en dessous de la fréquentation réelle')
    check(await page.$eval('[data-total=visits]', e => e.textContent.trim()) === String(GA_TOTALS.visits), 'total des visites')
    check((await page.$eval('[data-list=referrers]', e => e.innerText)).includes('Accès direct'), 'accès direct absent')
    check(!(await page.$('[data-source]')), 'choix de la source proposé avec un seul fournisseur')
    await t.shot(page, 'audience-google-analytics')
  })

  await step('Cloudflare réglé aussi : les deux sources sont proposées, on passe de l\'une à l\'autre', async () => {
    const cloudflare = await claire.call('/api/cms/modules/analytics', { method: 'PUT', body: { values: { siteToken: '0123456789abcdef0123456789abcdef', siteTag: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', accountId: 'f1e2d3c4b5a697887766554433221100' }, secrets: { apiToken: 'jeton-api-cloudflare-lecture-9876' } } })
    check(cloudflare.status === 200 && cloudflare.json.configured, cloudflare.text.slice(0, 200))
    const first = (await audience()).json
    check(first.state === 'ok' && first.module === 'analytics' && first.cookies === false && first.sources.map(s => s.id).join() === 'analytics,google-analytics', JSON.stringify(first).slice(0, 300))
    const google = (await audience('period=7&source=google-analytics')).json
    check(google.module === 'google-analytics' && google.stats.totals.pageViews === GA_TOTALS.pageViews, JSON.stringify(google).slice(0, 200))
    check((await audience('period=7&source=inconnu')).json.module === 'analytics', 'source inconnue : le premier fournisseur est attendu')
    await page.goto(B + '/admin/audience', { waitUntil: 'networkidle0' })
    await says(page, 'mesurée sans cookie')
    await page.$eval('[data-source=google-analytics]', b => b.click())
    await says(page, 'Source : Google Analytics.')
    check(await page.$eval('[data-source=google-analytics]', b => b.getAttribute('aria-pressed')) === 'true', 'bouton de la source non enfoncé')
    await page.$eval('[data-source=analytics]', b => b.click())
    await says(page, 'Source : Cloudflare Web Analytics, sans cookie.')
    // Les deux balises sont dans les pages.
    const home = await html('/')
    check(home.includes(META) && home.includes('static.cloudflareinsights.com/beacon.min.js'), 'une des deux balises manque')
  })

  await step('droits : un rédacteur ne lit pas l\'audience ; module désactivé, la balise et la finalité disparaissent', async () => {
    const { link } = await claire.json('/api/cms/users', { method: 'POST', body: { name: 'Lina Roux', email: 'lina@example.com', role: 'writer' } })
    await visitor.post(link.replace(/^.*\/admin\/invite\//, '/api/cms/invite/'), { password: 'motdepasse-test-2' })
    check((await lina.signIn('lina@example.com', 'motdepasse-test-2')).status === 200, 'connexion du rédacteur')
    check((await audience('period=7', lina)).status === 403 && (await audience('period=7', visitor)).status === 401, 'audience servie à un rédacteur ou à un visiteur')
    check((await claire.call('/api/cms/modules/google-analytics/enabled', { method: 'PUT', body: { enabled: false } })).status === 200, 'désactivation refusée')
    const home = await html('/')
    check(!home.includes('cms-google-analytics'), 'balise encore présente')
    check(!consentTag(home).purposes.some(p => p.id === 'audience'), 'finalité encore proposée')
    check((await audience('period=7&source=google-analytics')).json.module === 'analytics', 'Google Analytics encore lu')
  })
}
