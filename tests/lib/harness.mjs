// Outils communs aux suites : étapes, navigateur, connexion, clics par texte, appels à l'API.
import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
import { config } from './config.mjs'

export const wait = ms => new Promise(r => setTimeout(r, ms))

/** Rappelle `fn` jusqu'à obtenir une valeur (10 s par défaut). Pour ce qui arrive après coup côté serveur. */
export async function until(fn, what, { tries = 40, every = 250 } = {}) {
  for (let i = 0; i < tries; i++) {
    const value = await fn()
    if (value) return value
    await wait(every)
  }
  throw new Error('attendu en vain : ' + what)
}

/** Lève une erreur avec ce message si la condition est fausse. */
export function check(condition, message) {
  if (!condition) throw new Error(typeof message === 'function' ? message() : message)
}

// ───── Navigateur ─────

/**
 * Premier élément `sel` qui porte ce texte : d'abord celui dont le texte est exactement celui-là, sinon celui qui le contient.
 * (« Enregistrer » ne doit pas tomber sur un futur « Enregistrer et fermer » placé avant lui.)
 * `root` limite la recherche à un élément.
 */
export async function find(page, sel, text, root) {
  const handle = await page.evaluateHandle((sel, text, root) => {
    const all = [...(root ?? document).querySelectorAll(sel)]
    return all.find(e => e.textContent.trim() === text) ?? all.find(e => e.textContent.includes(text))
  }, sel, text, root ?? null)
  const el = handle.asElement()
  if (!el) throw new Error(`introuvable : ${sel} « ${text} »`)
  return el
}

/**
 * Clic sur l'élément qui porte ce texte.
 * Le clic est déclenché dans la page et non à la souris : le bouton flottant des outils de développement Nuxt
 * recouvre le bas de l'écran et intercepterait le clic.
 */
export async function clickText(page, sel, text, root) {
  await (await find(page, sel, text, root)).evaluate(el => el.click())
}

const fieldsetByLegend = label => [...document.querySelectorAll('fieldset')].find(f => f.querySelector('legend')?.textContent.replace('*', '').trim() === label)

/** Le bloc d'un champ de formulaire, trouvé par son libellé. Attend qu'il soit affiché (la page charge son contenu avant). */
export async function fieldset(page, label) {
  const handle = await page.waitForFunction(fieldsetByLegend, {}, label).catch(() => null)
  const el = handle?.asElement()
  if (!el) throw new Error('champ introuvable : ' + label)
  return el
}

/** La zone de saisie d'un champ : `input` par défaut, ou `textarea`, `select`… */
export async function field(page, label, kind = 'input') {
  const el = await (await fieldset(page, label)).$(kind)
  if (!el) throw new Error(`champ « ${label} » : pas de ${kind}`)
  return el
}

export const typeIn = async (page, label, text, kind = 'input') => (await field(page, label, kind)).type(text)

/** Remplace le contenu d'une zone de saisie. */
export async function retype(el, text) {
  await el.click({ clickCount: 3 })
  await el.type(text)
}

/** Attend que ce texte soit affiché quelque part dans la page (notification, titre…). */
export const says = (page, text) => page.waitForFunction(t => document.body.innerText.includes(t), {}, text)
  .catch(() => { throw new Error(`texte attendu, jamais affiché : « ${text} »`) })

/** Appel HTTP fait depuis la page, donc avec sa session. */
export const api = (page, url, init) => page.evaluate(async (url, init) => {
  const r = await fetch(url, init)
  return { status: r.status, type: r.headers.get('content-type'), body: await r.text() }
}, url, init ?? {})

export const jsonInit = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
/** Envoi de JSON depuis la page. */
export const send = (page, url, body, method = 'POST') => api(page, url, jsonInit(method, body))
/** Lecture de JSON depuis la page. */
export const json = async (page, url) => JSON.parse((await api(page, url)).body)
export const parse = response => JSON.parse(response.body)

/** Connexion par le formulaire. Attend le menu du back-office. */
export async function login(page, base, { email, password } = config.admin) {
  await page.goto(base + '/admin/login', { waitUntil: 'networkidle0' })
  await page.type('form input[type=email]', email)
  await page.type('form input[type=password]', password)
  await clickText(page, 'form button', 'Se connecter')
  await page.waitForSelector('aside .menu')
}

/** Libellés du menu du back-office. */
export const menuLabels = page => page.$$eval('aside .menu a', links => links.map(a => a.textContent.trim()))

// ───── Appels directs (sans navigateur) ─────

/**
 * Client HTTP qui garde ses cookies, pour les tests qui ne passent pas par l'interface.
 * Chaque client est un visiteur distinct. Les redirections ne sont pas suivies.
 */
export function httpClient(base) {
  const jar = new Map()
  async function call(url, { method = 'GET', body, headers = {} } = {}) {
    const r = await fetch(base + url, {
      method,
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
      headers: {
        // Better Auth refuse les écritures sans en-tête Origin.
        origin: base,
        ...(jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    })
    for (const line of r.headers.getSetCookie()) {
      const pair = line.split(';')[0]
      const i = pair.indexOf('=')
      const name = pair.slice(0, i).trim(), value = pair.slice(i + 1).trim()
      if (!value || /max-age=0/i.test(line)) jar.delete(name)
      else jar.set(name, value)
    }
    const text = await r.text()
    let data = null
    try { data = JSON.parse(text) }
    catch { /* pas du JSON */ }
    return { status: r.status, headers: r.headers, text, json: data }
  }
  return {
    call,
    /** En-tête Cookie de ce visiteur, pour un appel fait à la main (téléchargement d'un fichier binaire). */
    cookie: () => [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
    get: url => call(url),
    post: (url, body) => call(url, { method: 'POST', body: body ?? {} }),
    put: (url, body) => call(url, { method: 'PUT', body }),
    del: url => call(url, { method: 'DELETE' }),
    signIn: (email, password) => call('/api/auth/sign-in/email', { method: 'POST', body: { email, password } }),
    /** Lit du JSON et échoue si la réponse n'est pas un succès. */
    async json(url, init) {
      const r = await call(url, init)
      if (r.status < 200 || r.status >= 300) throw new Error(`${init?.method ?? 'GET'} ${url} → ${r.status} ${r.text.slice(0, 200)}`)
      return r.json
    },
  }
}

// ───── Déroulement d'une suite ─────

const slug = text => text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()
const seconds = ms => (ms / 1000).toFixed(1).replace('.', ',') + ' s'

/**
 * Exécute une suite (un module de tests/suites) contre un serveur déjà prêt.
 * Renvoie ses étapes ; ne lève pas d'erreur pour une étape en échec.
 */
export async function runSuite(suite, { name, base, mock, fixture, out = console.log }) {
  const steps = []
  const browsers = []
  const pages = []
  const notes = new Set()

  async function capture(label) {
    const files = []
    for (const [i, page] of pages.entries()) {
      if (page.isClosed()) continue
      const file = path.join(config.resultsDir, `${name}-${label}${pages.length > 1 ? `-page${i + 1}` : ''}.png`)
      // Une capture impossible (page bloquée, navigateur fermé) ne doit pas masquer l'erreur d'origine.
      if (await page.screenshot({ path: file }).then(() => true, () => false)) files.push(file)
    }
    return files
  }

  const t = {
    /** Adresse du serveur testé. */
    B: base,
    /** Adresse du faux service (suites déclarées avec `mock: true`). */
    M: mock?.url ?? null,
    /** Appels reçus par le faux service. */
    calls: () => mock.calls(),
    /** Le faux Google (suites déclarées avec `mock: true`) : `campaigns()`, `setBudget(id, micros)`. */
    google: mock?.google ?? null,
    admin: config.admin,
    fixture,

    /** Une étape : une ligne dans la sortie. Un échec n'arrête pas la suite, les étapes suivantes sont tentées. */
    async step(title, fn) {
      const start = Date.now()
      try {
        await fn()
        steps.push({ title, ok: true })
        out(`  ok     ${title}  (${seconds(Date.now() - start)})`)
      }
      catch (e) {
        const message = String(e?.message ?? e).split('\n')[0].slice(0, 500)
        const files = await capture(`echec-${steps.length + 1}-${slug(title).slice(0, 40)}`)
        steps.push({ title, ok: false, message, files })
        out(`  ÉCHEC  ${title}  (${seconds(Date.now() - start)})`)
        out(`         → ${message}`)
        for (const f of files) out(`         capture : ${path.relative(process.cwd(), f)}`)
      }
    },

    /** Ligne d'information sous l'étape en cours. */
    info: text => out(`         ${text}`),

    /** Navigateur (un seul par suite, lancé à la première demande). */
    async browser() {
      if (!browsers.length) {
        if (!config.chrome) throw new Error('Chrome introuvable : indiquez son chemin avec E2E_CHROME.')
        browsers.push(await puppeteer.launch({ executablePath: config.chrome, headless: config.headless, args: ['--window-size=1500,1300'] }))
      }
      return browsers[0]
    },

    /** Session séparée (autre personne, ou visiteur non connecté). */
    newContext: async () => (await t.browser()).createBrowserContext(),

    /**
     * Nouvel onglet, réglé comme les autres. `context` : session séparée ; `scheme` : apparence du système (« dark » pour le mode sombre).
     * Les boîtes de confirmation sont acceptées d'office.
     */
    async newPage({ context, scheme = 'light', width = 1400, height = 1100 } = {}) {
      const page = await (context ?? (await t.browser()).defaultBrowserContext()).newPage()
      await page.setViewport({ width, height })
      page.setDefaultTimeout(config.timeout)
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
      page.on('dialog', d => d.accept())
      page.on('pageerror', e => notes.add('[erreur dans la page] ' + String(e.message).slice(0, 300)))
      pages.push(page)
      return page
    },

    /** Ajoute un onglet ouvert par la page (lien « nouvel onglet ») aux captures d'échec. */
    track(page) { pages.push(page); page.setDefaultTimeout(config.timeout); return page },

    /** Capture d'écran d'une étape réussie, gardée seulement avec E2E_CAPTURES=1. */
    async shot(page, label) {
      if (config.captures) await page.screenshot({ path: path.join(config.resultsDir, `${name}-${label}.png`) })
    },

    /** Client HTTP sans navigateur, avec ses propres cookies. */
    http: () => httpClient(base),
  }

  try {
    await suite(t)
  }
  catch (e) {
    // Erreur hors d'une étape : la suite n'a pas pu aller au bout.
    const message = String(e?.stack ?? e).split('\n').slice(0, 3).join(' ')
    await capture('interrompue')
    steps.push({ title: 'déroulement de la suite', ok: false, message })
    out(`  ÉCHEC  la suite s'est interrompue → ${message}`)
  }
  finally {
    for (const browser of browsers) await browser.close().catch(() => {})
  }
  if (notes.size) {
    out('  Erreurs JavaScript relevées dans le navigateur (pour information) :')
    for (const n of notes) out('    ' + n)
  }
  return steps
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}
