/**
 * Redirections et pages introuvables : règles communes au serveur, au back-office et aux tests.
 * Fonctions pures, sans accès à la base.
 *
 * ── Comment une adresse est comparée (décidé une fois, ici) ──
 * Une ancienne adresse est un **chemin exact** (pas de motif avec « * »). Avant toute comparaison, le chemin saisi
 * comme le chemin demandé par un visiteur passent par `canonicalPath` :
 * - le nom de domaine, les paramètres (« ?… ») et l'ancre (« #… ») sont ignorés ;
 * - les caractères encodés sont décodés (« /caf%C3%A9 » = « /café ») et les accents unifiés (forme NFC) ;
 * - majuscules et minuscules ne comptent pas (« /Contact » = « /contact ») ;
 * - la barre finale et les barres doublées ne comptent pas (« /a//b/ » = « /a/b »).
 * La destination, elle, est gardée telle qu'elle est saisie (casse, paramètres, ancre).
 * Les paramètres de l'adresse demandée sont recopiés sur une destination interne qui n'en a pas (« ?utm_source=… »).
 */

/** 301 : définitive (les moteurs de recherche retiennent la nouvelle adresse). 302 : provisoire. */
export const REDIRECT_STATUSES = [301, 302] as const
export type RedirectStatus = typeof REDIRECT_STATUSES[number]
export const isRedirectStatus = (value: unknown): value is RedirectStatus => REDIRECT_STATUSES.includes(value as RedirectStatus)

/** Destination d'une redirection : une page du site (suivie si son adresse change) ou une adresse libre. */
export type RedirectTarget =
  | { kind: 'page'; type: string; id: string; locale: string }
  | { kind: 'url'; url: string }

/** Nombre maximal de lignes d'un import. */
export const REDIRECT_BATCH_MAX = 1000
/** Nombre maximal d'adresses introuvables conservées ; au-delà, les moins demandées sont oubliées. */
export const NOT_FOUND_MAX = 500
/** Une adresse introuvable qui n'est plus demandée est oubliée après ce nombre de jours. */
export const NOT_FOUND_DAYS = 90

const MAX_PATH = 300

// ───────────── Normalisation ─────────────

/**
 * Forme de comparaison d'un chemin (voir l'en-tête). Renvoie null si ce n'est pas un chemin acceptable.
 * `raw` commence par « / » ; les paramètres et l'ancre doivent déjà être retirés.
 */
export function canonicalPath(raw: string): string | null {
  if (!raw.startsWith('/') || raw.length > MAX_PATH * 3) return null
  const out: string[] = []
  for (const part of raw.split('/')) {
    if (!part) continue
    let segment: string
    try { segment = decodeURIComponent(part) }
    catch { return null }
    segment = segment.normalize('NFC').toLowerCase()
    // Ni caractère de contrôle, ni barre cachée dans un segment, ni remontée de dossier.
    if (/[\u0000-\u001F\u007F\\/]/.test(segment) || segment === '.' || segment === '..') return null
    out.push(segment)
  }
  const path = '/' + out.join('/')
  return path.length > MAX_PATH ? null : path
}

/** Forme de comparaison du chemin d'une adresse (interne, avec ou sans paramètres). Null pour une adresse externe ou illisible. */
export function pathKey(address: string | null | undefined): string | null {
  if (!address || !address.startsWith('/') || address.startsWith('//')) return null
  return canonicalPath(address.split(/[?#]/)[0]!)
}

/** Adresses que le core sert lui-même : jamais redirigées, jamais comptées. */
const RESERVED = ['/admin', '/api', '/media']
const RESERVED_FILES = ['/sitemap.xml', '/robots.txt']
export function isReservedPath(path: string) {
  // Tout ce qui commence par « /_ » appartient à Nuxt ou au core (/_nuxt, /_cms, /__nuxt_error…).
  return path.startsWith('/_') || RESERVED_FILES.includes(path) || RESERVED.some(p => path === p || path.startsWith(p + '/'))
}

export type SourceResult = { ok: true; path: string; notes: string[] } | { ok: false; error: string }

/** Lit une ancienne adresse saisie à la main et la ramène à sa forme de comparaison. */
export function normalizeSource(input: unknown): SourceResult {
  if (typeof input !== 'string' || !input.trim()) return { ok: false, error: 'Indiquez l\'ancienne adresse, par exemple « /ancienne-page ».' }
  let text = input.trim()
  const notes: string[] = []
  if (/^https?:\/\//i.test(text)) {
    if (!URL.canParse(text)) return { ok: false, error: `« ${text} » n'est pas une adresse valide.` }
    const url = new URL(text)
    // Le chemin est repris tel qu'il a été écrit (l'analyse d'URL ré-encoderait les accents).
    text = text.slice(url.origin.length) || '/'
    if (!text.startsWith('/')) text = url.pathname + url.search
    notes.push('Le nom de domaine est ignoré : seule la partie après celui-ci compte.')
  }
  else if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return { ok: false, error: `« ${text} » n'est pas une adresse du site.` }
  if (text.includes('*')) return { ok: false, error: 'Les motifs avec « * » ne sont pas pris en charge : indiquez une adresse exacte.' }
  text = text.split('#')[0]!
  if (text.includes('?')) {
    text = text.split('?')[0]!
    notes.push('Les paramètres après « ? » sont ignorés : la redirection vaut pour l\'adresse quels que soient ses paramètres.')
  }
  if (!text.startsWith('/')) text = '/' + text
  const path = canonicalPath(text)
  if (!path) return { ok: false, error: `« ${input.trim()} » n'est pas une adresse valide (caractère interdit, encodage incorrect ou adresse trop longue).` }
  if (path === '/') return { ok: false, error: 'La page d\'accueil ne peut pas être redirigée.' }
  if (isReservedPath(path)) return { ok: false, error: `« ${path} » est une adresse réservée au fonctionnement du site (back-office, fichiers, API) : elle ne peut pas être redirigée.` }
  return { ok: true, path, notes }
}

export type UrlTargetResult = { ok: true; url: string; external: boolean } | { ok: false; error: string }

/**
 * Lit une destination libre : un chemin du site (« /contact ») ou une adresse complète (« https://… »).
 * Une adresse complète qui désigne ce site (`siteUrl`) est ramenée à son chemin.
 */
export function normalizeUrlTarget(input: unknown, siteUrl?: string | null): UrlTargetResult {
  if (typeof input !== 'string' || !input.trim()) return { ok: false, error: 'Indiquez la destination.' }
  const text = input.trim()
  if (/[\s\\\u0000-\u001F]/.test(text) || text.length > 1000) return { ok: false, error: `« ${text.slice(0, 80)} » n'est pas une destination valide (espace ou caractère interdit).` }
  if (/^https?:\/\//i.test(text)) {
    if (!URL.canParse(text)) return { ok: false, error: `« ${text} » n'est pas une adresse valide.` }
    const url = new URL(text)
    if (siteUrl && URL.canParse(siteUrl) && new URL(siteUrl).host === url.host) return { ok: true, url: url.pathname + url.search + url.hash, external: false }
    return { ok: true, url: url.href, external: true }
  }
  if (text.startsWith('/') && !text.startsWith('//')) {
    if (!pathKey(text)) return { ok: false, error: `« ${text} » n'est pas une destination valide.` }
    return { ok: true, url: text, external: false }
  }
  return { ok: false, error: `La destination « ${text.slice(0, 80)} » doit commencer par « / » (une page de ce site) ou par « https:// » (un autre site).` }
}

/** Adresse à placer dans l'en-tête `Location` : la destination, correctement encodée, avec les paramètres de la demande. */
export function redirectLocation(target: string, requestSearch = ''): string {
  if (/^https?:\/\//i.test(target)) return new URL(target).href
  const url = new URL(target, 'http://site.invalid')
  const search = url.search || (requestSearch.length > 1 ? requestSearch : '')
  return url.pathname + search + url.hash
}

// ───────────── Boucles et chaînes ─────────────

/** Où mène une adresse déjà redirigée. `key` : forme de comparaison de sa destination (null : hors du site ou hors ligne). */
export type Hop = { key: string | null; target: RedirectTarget; /** Identifiant de la redirection manuelle ; absent pour une redirection automatique. */ id?: string }

/** Ce que l'on sait du site au moment de vérifier une redirection. */
export type RedirectGraph = {
  /** Redirections manuelles, par ancienne adresse. */
  rules: Map<string, Hop>
  /** Redirections automatiques (ancienne adresse d'un contenu), par ancienne adresse. */
  autos: Map<string, Hop>
  /** Pages en ligne, par adresse. */
  pages: Map<string, { type: string; id: string; locale: string; title: string }>
}

/**
 * Suit les redirections à partir d'une adresse. `hops` : les adresses traversées (la première est `start`).
 * `loop` : on est revenu sur `origin` ou sur une adresse déjà vue.
 */
export function followRedirects(graph: Pick<RedirectGraph, 'rules' | 'autos'>, start: string, origin: string, max = 20) {
  const hops: string[] = []
  const seen = new Set([origin])
  let key: string | null = start
  let last: Hop | null = null
  while (key) {
    if (seen.has(key)) return { hops, last, loop: true }
    const hop: Hop | undefined = graph.rules.get(key) ?? graph.autos.get(key)
    if (!hop) break
    seen.add(key)
    hops.push(key)
    last = hop
    if (hops.length > max) return { hops, last, loop: true }
    key = hop.key
  }
  return { hops, last, loop: false }
}

export type RuleInput = { source: unknown; target: RedirectTarget; /** Forme de comparaison de la destination ; null : externe ou page hors ligne. */ targetKey: string | null; /** Redirection en cours de modification : elle ne compte pas comme doublon. */ id?: string }
export type RuleCheck =
  | { ok: false; code: 'invalid' | 'self' | 'loop' | 'page' | 'duplicate'; error: string }
  | {
    ok: true
    source: string
    notes: string[]
    /** La destination est elle-même redirigée : `via` les adresses traversées, `final` où l'on arrive au bout. */
    chain: { via: string[]; final: RedirectTarget; finalKey: string | null } | null
    /** Redirections manuelles existantes qui mènent à cette ancienne adresse : elles feraient deux sauts. */
    upstream: { id: string; source: string }[]
  }

const describeTarget = (graph: RedirectGraph, hop: Hop) => (hop.target.kind === 'url' ? hop.target.url : hop.key ?? 'une page qui n\'est plus en ligne')

/**
 * Vérifie une redirection avant de l'enregistrer : adresse bien formée, pas vers elle-même, pas de boucle,
 * pas sur une page en ligne, pas en double. Signale les chaînes (A → B → C) sans les refuser : à l'appelant
 * d'aplatir (pointer droit sur `chain.final`) ou de demander.
 */
export function checkRule(graph: RedirectGraph, input: RuleInput): RuleCheck {
  const source = normalizeSource(input.source)
  if (!source.ok) return { ok: false, code: 'invalid', error: source.error }
  const path = source.path
  if (input.targetKey === path) return { ok: false, code: 'self', error: `« ${path} » redirigerait vers elle-même.` }

  const existing = graph.rules.get(path)
  if (existing && existing.id !== input.id) return { ok: false, code: 'duplicate', error: `« ${path} » est déjà redirigée vers « ${describeTarget(graph, existing)} ».` }
  const auto = graph.autos.get(path)
  if (auto) return { ok: false, code: 'duplicate', error: `« ${path} » est déjà redirigée automatiquement vers « ${describeTarget(graph, auto)} » (ancienne adresse de ce contenu). Supprimez d'abord cette redirection automatique pour la remplacer.` }
  // Décision : une page qui existe répond toujours en premier ; une redirection posée dessus ne servirait jamais.
  const page = graph.pages.get(path)
  if (page) return { ok: false, code: 'page', error: `« ${path} » est l'adresse d'une page en ligne (« ${page.title} »). Une page en ligne répond toujours en premier : la redirection ne s'appliquerait pas. Retirez d'abord cette page du site ou changez son adresse.` }

  // La redirection en cours de modification ne fait pas partie du chemin suivi.
  const rules = input.id && existing ? new Map([...graph.rules].filter(([key]) => key !== path)) : graph.rules
  const upstream = [...rules].flatMap(([key, hop]) => (hop.key === path && hop.id ? [{ id: hop.id, source: key }] : []))
  let chain: Extract<RuleCheck, { ok: true }>['chain'] = null
  if (input.targetKey) {
    const followed = followRedirects({ rules, autos: graph.autos }, input.targetKey, path)
    if (followed.loop) return { ok: false, code: 'loop', error: `Boucle : « ${path} » → ${[...followed.hops, path].map(h => `« ${h} »`).join(' → ')}. Les visiteurs tourneraient en rond.` }
    if (followed.last) chain = { via: followed.hops, final: followed.last.target, finalKey: followed.last.key }
  }
  return { ok: true, source: path, notes: source.notes, chain, upstream }
}

// ───────────── Import en lot ─────────────

export type BatchLine =
  | { line: number; source: string; target: string; status?: RedirectStatus }
  | { line: number; error: string; text: string }

const STATUS_WORDS: Record<string, RedirectStatus> = { 301: 301, 302: 302, permanente: 301, 'définitive': 301, definitive: 301, temporaire: 302, provisoire: 302 }
const unquote = (cell: string) => {
  const text = cell.trim()
  return /^".*"$/.test(text) ? text.slice(1, -1).replace(/""/g, '"').trim() : /^'.*'$/.test(text) ? text.slice(1, -1).trim() : text
}

/** Découpe sur un séparateur d'un caractère, sans couper à l'intérieur de guillemets doubles. */
function splitOutsideQuotes(text: string, separator: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (const char of text) {
    if (char === '"') quoted = !quoted
    if (char === separator && !quoted) { cells.push(current); current = '' }
    else current += char
  }
  return [...cells, current]
}

/** Découpe une ligne « ancienne ; nouvelle » : flèche, point-virgule, tabulation, virgule, ou à défaut un espace. */
function splitLine(text: string): string[] {
  const arrow = text.split(/\s*(?:→|=>|->)\s*/)
  if (arrow.length > 1) return arrow.map(unquote)
  for (const separator of [';', '\t', ',']) {
    const cells = splitOutsideQuotes(text, separator)
    if (cells.length > 1) return cells.map(unquote)
  }
  // Sans séparateur reconnu : deux adresses séparées par un espace, et rien d'autre.
  const words = text.split(/\s+/)
  return words.length === 2 ? words.map(unquote) : [text]
}

/**
 * Lit une liste collée ou un fichier CSV : une redirection par ligne, « ancienne ; nouvelle » et, si l'on veut,
 * une troisième colonne « 301 » ou « 302 ». Les lignes vides et celles qui commencent par « # » sont ignorées,
 * ainsi qu'une première ligne de titres.
 */
export function parseRedirectBatch(text: string): BatchLine[] {
  const out: BatchLine[] = []
  const lines = text.replace(/^﻿/, '').split(/\r\n|\n|\r/)
  let first = true
  lines.forEach((raw, index) => {
    const content = raw.trim()
    if (!content || content.startsWith('#')) return
    const line = index + 1
    const cells = splitLine(content)
    const wasFirst = first
    first = false
    // Ligne de titres d'un fichier CSV : « ancienne;nouvelle », « source,destination », « from,to »…
    if (wasFirst && cells[0] && !/^(\/|https?:)/i.test(cells[0]) && /^(ancien|source|origine|old|from|url|de$|adresse)/i.test(cells[0])) return
    while (cells.length > 2 && !cells.at(-1)) cells.pop()
    if (cells.length < 2 || !cells[0] || !cells[1]) { out.push({ line, text: content, error: 'Ligne illisible : attendu « ancienne adresse ; nouvelle adresse ».' }); return }
    if (cells.length > 3) { out.push({ line, text: content, error: 'Trop de colonnes : attendu « ancienne adresse ; nouvelle adresse » (et, si besoin, « ; 301 » ou « ; 302 »).' }); return }
    let status: RedirectStatus | undefined
    if (cells[2]) {
      status = STATUS_WORDS[cells[2].toLowerCase()]
      if (!status) { out.push({ line, text: content, error: `Troisième colonne « ${cells[2]} » : attendu 301 (définitive) ou 302 (provisoire).` }); return }
    }
    out.push({ line, source: cells[0], target: cells[1], ...(status ? { status } : {}) })
  })
  return out
}

// ───────────── Pages introuvables : le bruit ─────────────

/** Fichiers que seuls des robots à la recherche d'une faille demandent, et fichiers techniques qui ne sont pas des pages. */
const NOISE_EXTENSIONS = /\.(env|sql|bak|old|orig|save|swp|zip|tar|gz|tgz|rar|7z|log|ini|ya?ml|conf|config|cfg|db|sqlite|pem|key|sh|bat|cmd|exe|dll|jspx?|cgi|pl|py|rb|ashx|asmx|action|do|js|mjs|css|map|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|eot|json|xml|txt|mp4|webm|mp3)$/
/** Chemins caractéristiques des balayages automatiques (WordPress, outils d'administration, dossiers techniques). */
const NOISE_PATHS = /(^|\/)(wp-[a-z]+|wordpress|xmlrpc|phpmyadmin|pma|adminer|cgi-bin|vendor|node_modules|phpunit|eval-stdin|autodiscover|actuator|boaform|hnap1|solr|owa|ecp|telescope|_profiler|administrator|\.[^/]*)(\/|\.|$)/
/** Noms de fichiers PHP que demandent les balayages ; une vraie ancienne page en « .php » reste comptée. */
const NOISE_PHP = /(^|\/)(admin|login|shell|config|configuration|setup|install|phpinfo|info|test|upload|up|cmd|alfa|wso|c99|r57|mini|xx?|[a-z0-9]{1,3})\.php$/
const NOISE_CHARS = /[<>"'`{}|^$;=()[\]*!]/
/** Outils de balayage et scripts (les moteurs de recherche, eux, sont comptés : leurs demandes signalent de vraies anciennes adresses). */
const NOISE_AGENTS = /curl|wget|python|go-http-client|okhttp|java\/|libwww|scrapy|httpclient|zgrab|masscan|nmap|nikto|sqlmap|nuclei|wpscan|dirbuster|gobuster|feroxbuster|semrush|ahrefs|mj12bot|dotbot|petalbot|bytespider/i

/**
 * Vrai si une adresse introuvable ne mérite pas d'être comptée : balayage de robots, fichier technique, adresse absurde.
 * `path` est une forme de comparaison (`canonicalPath`). `userAgent` : `undefined` pour ne pas en tenir compte.
 */
export function isNoise(path: string, userAgent?: string | null): boolean {
  if (path === '/' || path.length > 200 || path.split('/').length > 9) return true
  if (NOISE_CHARS.test(path) || NOISE_EXTENSIONS.test(path) || NOISE_PATHS.test(path) || NOISE_PHP.test(path)) return true
  if (userAgent !== undefined && (!userAgent || NOISE_AGENTS.test(userAgent))) return true
  return false
}

/**
 * D'où venait le visiteur, sans rien de personnel : pour une page de ce site, son chemin ; pour un autre site,
 * son nom de domaine et son chemin. Les paramètres (qui peuvent contenir des données personnelles) sont retirés.
 */
export function cleanReferrer(referrer: string | null | undefined, host: string | null | undefined): string | null {
  if (!referrer || !URL.canParse(referrer)) return null
  const url = new URL(referrer)
  if (!/^https?:$/.test(url.protocol)) return null
  const out = url.host === host ? url.pathname : url.host + (url.pathname === '/' ? '' : url.pathname)
  return out.slice(0, 200)
}
