// Typographie du site : polices proposées (servies par le site), polices envoyées, réglages par niveau de titre.
import fs from 'node:fs'
import path from 'node:path'
import { check, clickText, login, says, until } from '../lib/harness.mjs'
import { config } from '../lib/config.mjs'

export const meta = { title: 'typographie : polices proposées et envoyées, titres, aperçu, site' }

const FONT_DIR = path.join(config.testsDir, '..', 'packages', 'cms', 'fonts')
const THEME = { primary: '#4f46e5', secondary: '#db2777', accent: '#0d9488', neutral: '#1f2937', base: '#ffffff', radius: 0.5, border: 1, depth: true, noise: false }

export default async function (t) {
  const { B, step } = t
  const admin = t.http(), anon = t.http()
  const fontBytes = fs.readFileSync(path.join(FONT_DIR, 'lora', 'lora-latin-wght-normal.woff2'))
  const upload = async (name, bytes = fontBytes) => {
    const form = new FormData()
    form.append('file', new Blob([bytes]), name)
    const r = await fetch(B + '/api/cms/fonts', { method: 'POST', body: form, headers: { cookie: admin.cookie(), origin: B } })
    return { status: r.status, json: await r.json().catch(() => null) }
  }
  const saveTheme = typography => admin.put('/api/cms/theme', { ...THEME, typography })
  const styleOf = async (url) => {
    const html = await fetch(B + url).then(r => r.text())
    return { html, css: [...html.matchAll(/<style[^>]*>([^<]*)<\/style>/g)].map(m => m[1]).find(s => s.includes('--color-primary')) ?? '' }
  }
  let custom

  await step('polices proposées : servies par le site, gardées en cache ; rien dans les pages tant que rien n\'est réglé', async () => {
    check((await admin.signIn(t.admin.email, t.admin.password)).status === 200, 'connexion refusée')
    const r = await fetch(B + '/_cms/fonts/inter/inter-latin-wght-normal.woff2')
    const head = Buffer.from(await r.arrayBuffer()).subarray(0, 4).toString()
    check(r.status === 200 && head === 'wOF2' && /font\/woff2/.test(r.headers.get('content-type') ?? ''), `${r.status} ${head} ${r.headers.get('content-type')}`)
    check((await fetch(B + '/_cms/fonts/inter/LICENSE')).status === 200, 'licence de la police absente')
    check((await saveTheme(undefined)).status === 200, 'thème sans typographie refusé')
    const saved = (await anon.get('/api/cms/theme')).json
    check(!('typography' in saved.theme) && saved.fonts.length === 0, JSON.stringify(saved))
    const { css, html } = await styleOf('/')
    check(css && !css.includes('font') && !html.includes('rel="preload" as="font"'), 'règles de police sans réglage')
  })

  await step('thème : police du texte et des titres, échelle, réglages fins ; valeurs refusées', async () => {
    const r = await saveTheme({ body: 'inter', heading: 'fraunces', scale: 'normal', levels: { h1: { weight: 800, letterSpacing: -0.02 }, body: { size: 1.0625 } } })
    check(r.status === 200 && r.json.theme.typography.heading === 'fraunces', `${r.status} ${r.text}`)
    const { css, html } = await styleOf('/')
    check(css.includes('@font-face{font-family:"Inter"') && css.includes('@font-face{font-family:"Fraunces"'), 'polices non déclarées')
    check(css.includes('html:root body{font-family:var(--cms-font-body);font-size:1.063rem}'), 'texte courant')
    check(css.includes('html:root h1:not(.cms-type-off){font-weight:800;font-size:clamp(2rem,') && css.includes('letter-spacing:-0.02em'), 'titre principal')
    // La police du texte est demandée dès le début de la page ; aucune adresse d'un autre site.
    check(/<link[^>]+rel="preload"[^>]+href="\/_cms\/fonts\/inter\/inter-latin-wght-normal\.woff2"/.test(html) || /<link[^>]+href="\/_cms\/fonts\/inter\/inter-latin-wght-normal\.woff2"[^>]+rel="preload"/.test(html), 'préchargement absent')
    check(!/fonts\.(googleapis|gstatic)\.com/.test(html), 'police demandée à un service tiers')
    for (const [typography, message] of [
      [{ body: 'comic-sans' }, 'Police du texte inconnue.'],
      [{ heading: 'custom:Absente' }, 'Police des titres inconnue.'],
      [{ levels: { h1: { size: 40 } } }, 'taille entre'],
      [{ scale: 'géante' }, 'Échelle des titres inconnue.'],
    ]) {
      const bad = await saveTheme(typography)
      check(bad.status === 400 && bad.json.message.includes(message), `${JSON.stringify(typography)} → ${bad.status} ${bad.json?.message}`)
    }
  })

  await step('police envoyée : format lu dans le fichier, famille devinée, servie, absente de la médiathèque, droits', async () => {
    check((await upload('pas-une-police.woff2', fs.readFileSync(t.fixture('Photo du Cabinet.png')))).status === 415, 'image acceptée comme police')
    check((await upload('trop-lourde.woff2', Buffer.concat([fontBytes, Buffer.alloc(2 * 1024 * 1024)]))).status === 413, 'fichier trop lourd accepté')
    const r = await upload('MaisonNeue-BoldItalic.woff2')
    check(r.status === 200, `envoi : ${r.status} ${JSON.stringify(r.json)}`)
    custom = r.json
    check(custom.family === 'Maison Neue' && custom.weight === 700 && custom.style === 'italic' && custom.format === 'woff2' && custom.size === fontBytes.length, JSON.stringify(custom))
    const file = await fetch(B + custom.url)
    check(file.status === 200 && file.headers.get('content-type') === 'font/woff2' && /immutable/.test(file.headers.get('cache-control') ?? ''), `${file.status} ${file.headers.get('content-type')}`)
    check((await admin.json('/api/cms/media')).length === 0, 'police montrée dans la médiathèque')
    check((await admin.json('/api/cms/health')).unused.count === 0, 'police comptée parmi les fichiers inutilisés')
    check((await admin.json('/api/cms/fonts')).fonts.length === 1, 'liste des polices')
    check((await anon.get('/api/cms/fonts')).status === 401 && (await anon.call(`/api/cms/fonts/${custom.id}`, { method: 'DELETE' })).status === 401, 'polices gérables sans connexion')
  })

  await step('police envoyée : corrigée (famille, graisse, style), choisie dans le thème, appliquée au site', async () => {
    const patch = body => admin.call(`/api/cms/fonts/${custom.id}`, { method: 'PATCH', body })
    check((await patch({ family: 'x";}body{display:none' })).status === 400 && (await patch({ weight: 5000 })).status === 400 && (await patch({ style: 'penché' })).status === 400, 'valeur mal formée acceptée')
    const fixed = await patch({ family: 'Maison', weight: [400, 700], style: 'normal' })
    check(fixed.status === 200 && fixed.json.font.family === 'Maison' && JSON.stringify(fixed.json.font.weight) === '[400,700]', fixed.text)
    // Avant d'être choisie, elle n'est pas donnée aux pages du site.
    check((await anon.get('/api/cms/theme')).json.fonts.length === 0, 'police non utilisée transmise au site')
    check((await saveTheme({ body: 'custom:Maison', heading: 'site', scale: 'site', levels: { h2: { font: 'oswald' } } })).status === 200, 'thème refusé')
    check((await anon.get('/api/cms/theme')).json.fonts[0].family === 'Maison', 'police utilisée non transmise')
    const { css, html } = await styleOf('/')
    check(css.includes(`@font-face{font-family:"Maison";font-style:normal;font-weight:400 700;font-display:swap;src:url("${custom.url}") format("woff2")}`), css.slice(-600))
    check(css.includes('--cms-font-body:"Maison",ui-sans-serif') && css.includes('html:root h2:not(.cms-type-off){font-family:"Oswald"') && html.includes(`href="${custom.url}"`), 'police non appliquée')
  })

  await step('écran Apparence : aperçu en direct, enregistrement, site rendu avec la police', async () => {
    const page = await t.newPage()
    await login(page, B)
    await page.goto(B + '/admin/appearance', { waitUntil: 'networkidle0' })
    await page.waitForSelector('[data-typography]')
    const preview = prop => page.$eval('[data-cms-theme-preview]', (el, prop) => getComputedStyle(prop === 'h1' ? el.querySelector('h1') : el)[prop === 'h1' ? 'fontSize' : 'fontFamily'], prop)
    check((await preview('family')).startsWith('Maison'), 'aperçu : ' + await preview('family'))
    check((await page.$$eval('[data-typography-font="body"] optgroup', g => g.map(o => o.label))).join() === 'Vos polices,Sans empattement,Avec empattement,De caractère,À chasse fixe,Sans téléchargement', 'groupes de polices')
    check((await page.$eval('[data-typography-file]', el => el.querySelector('input').value)) === 'Maison', 'police envoyée non listée')
    // Choix d'une police proposée et d'une échelle : l'aperçu suit, sans rien enregistrer.
    const before = Number.parseFloat(await preview('h1'))
    await page.select('[data-typography-font="body"]', 'lora')
    await page.select('[data-typography-scale]', 'ample')
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-cms-theme-preview]')).fontFamily.startsWith('Lora'))
    const after = Number.parseFloat(await preview('h1'))
    check(after > before && after >= 40, `titre de l'aperçu : ${before}px puis ${after}px`)
    check((await anon.get('/api/cms/theme')).json.theme.typography.body === 'custom:Maison', 'enregistré sans demande')
    // Le back-office, lui, garde sa police.
    check(!(await page.$eval('aside', el => getComputedStyle(el).fontFamily)).startsWith('Lora'), 'la police du site s\'applique au back-office')
    // Réglage fin : graisse du titre principal.
    await page.click('[data-typography-fine] summary')
    await page.select('[data-typography-level="h1"] [data-typography-input="weight"]', '900')
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-cms-theme-preview] h1')).fontWeight === '900')
    await clickText(page, 'button', 'Enregistrer')
    await says(page, 'Thème enregistré')
    const saved = (await anon.get('/api/cms/theme')).json.theme.typography
    check(saved.body === 'lora' && saved.scale === 'ample' && saved.levels.h1.weight === 900 && saved.levels.h2.font === 'oswald', JSON.stringify(saved))
    await t.shot(page, 'typographie')

    // Le site : la police est vraiment chargée et appliquée, et le titre principal a la taille de l'échelle.
    const site = await t.newPage({ context: await t.newContext() })
    await site.goto(B + '/contact', { waitUntil: 'networkidle0' })
    await site.evaluate(() => document.fonts.ready)
    const seen = await site.evaluate(() => ({
      body: getComputedStyle(document.body).fontFamily, loaded: document.fonts.check('16px Lora'),
      h1: getComputedStyle(document.querySelector('h1')).fontSize, h1Weight: getComputedStyle(document.querySelector('h1')).fontWeight,
      requests: performance.getEntriesByType('resource').map(r => r.name).filter(n => /\.woff2?(\?|$)/.test(n)),
    }))
    check(seen.body.startsWith('Lora') && seen.loaded, JSON.stringify(seen))
    check(Number.parseFloat(seen.h1) === 64 && seen.h1Weight === '900', `titre du site : ${seen.h1} ${seen.h1Weight}`)
    check(seen.requests.length >= 1 && seen.requests.every(u => u.startsWith(B + '/_cms/fonts/')), 'polices demandées : ' + seen.requests.join(', '))
    // Sur un téléphone, le grand titre se réduit.
    await site.setViewport({ width: 360, height: 700 })
    await site.waitForFunction(() => Number.parseFloat(getComputedStyle(document.querySelector('h1')).fontSize) === 40)
    await site.close()
    await page.close()
  })

  await step('police supprimée : fichier retiré ; « Rétablir l\'origine » retire la typographie', async () => {
    check((await saveTheme({ body: 'custom:Maison', heading: 'site', scale: 'site', levels: {} })).status === 200, 'thème refusé')
    const gone = await admin.call(`/api/cms/fonts/${custom.id}`, { method: 'DELETE' })
    check(gone.status === 200, gone.text)
    check((await fetch(B + custom.url)).status === 404 && (await admin.json('/api/cms/fonts')).fonts.length === 0, 'fichier encore servi')
    // Le thème désigne encore la famille : le site affiche la police du système plutôt qu'un nom qui ne mène à rien.
    const { css } = await styleOf('/')
    check(css.includes('--cms-font-body:ui-sans-serif') && !css.includes('Maison'), css.slice(-300))
    check((await admin.call('/api/cms/theme', { method: 'DELETE' })).status === 200, 'remise à zéro refusée')
    const { html } = await styleOf('/')
    check(!html.includes('--cms-font-body') && !html.includes('@font-face'), 'typographie encore appliquée')
    const log = JSON.stringify(await admin.json('/api/cms/activity'))
    check(log.includes('a envoyé la police « MaisonNeue-BoldItalic.woff2 »') && log.includes('a supprimé la police'), 'journal d\'activité')
  })
}
