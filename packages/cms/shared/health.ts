/**
 * Santé du site : ce qui, dans les contenus en ligne, gêne un visiteur ou un moteur de recherche sans que personne
 * ne le voie depuis le back-office. Liens qui ne mènent nulle part, images sans texte alternatif, images trop
 * lourdes, fichiers que plus rien n'utilise. Logique pure, partagée par le serveur, l'écran et leurs tests.
 *
 * Ce sont les versions publiées qui sont examinées : c'est ce que voient les visiteurs. Une correction faite dans un
 * brouillon disparaît donc de la liste une fois publiée (à la différence de l'écran « Pages et titres », qui suit
 * les brouillons pour dire la même chose que le formulaire).
 */
import { type AnyField, isVisible } from './format'
import { canonicalPath } from './redirects'

type Fields = Record<string, AnyField>
type Values = Record<string, unknown>

export const HEALTH_LIMITS = {
  /**
   * Poids au-delà duquel une image est dite lourde (1,5 Mo). Appréciation : les photos sont redimensionnées à l'affichage,
   * mais l'original sert de source à chaque taille, et est servi tel quel si le redimensionnement n'est pas
   * disponible (SVG, GIF, hébergement sans `sharp`). Une photo de 2 000 px de large en JPEG pèse 300 à 600 Ko.
   */
  heavyImageBytes: 1.5 * 1024 * 1024,
  /** Adresses externes vérifiées par appel au serveur, et adresses du site vérifiées en même temps par le navigateur. */
  externalBatch: 8,
  internalParallel: 4,
  /** Délai accordé à un site externe pour répondre (ms). */
  externalTimeoutMs: 8000,
  /** Nombre maximal d'adresses externes vérifiées par visite de l'écran. */
  maxExternal: 300,
} as const

// ───────────────────────── Liens d'un contenu ─────────────────────────

/** Un lien trouvé dans un contenu. `field` : nom du champ dans le formulaire (« Contenu », « Questions › Lien »). */
export type FoundLink =
  | { kind: 'page'; field: string; type: string; id: string }
  | { kind: 'href'; field: string; href: string }

/** Tous les liens d'un contenu : champs lien et liens des textes mis en forme, répéteurs compris. Un champ masqué n'est pas examiné. */
export function contentLinks(fields: Fields, values: Values, prefix = ''): FoundLink[] {
  const out: FoundLink[] = []
  for (const [key, field] of Object.entries(fields)) {
    if (!isVisible(field, values)) continue
    const label = prefix + field.label
    const value = values[key]
    if (field.type === 'repeater') {
      for (const item of Array.isArray(value) ? value : []) if (item && typeof item === 'object') out.push(...contentLinks(field.fields as Fields, item as Values, `${label} › `))
    }
    else if (field.type === 'link' && value && typeof value === 'object') {
      const link = value as { kind?: string; type?: unknown; id?: unknown; url?: unknown }
      if (link.kind === 'page' && typeof link.type === 'string' && typeof link.id === 'string') out.push({ kind: 'page', field: label, type: link.type, id: link.id })
      else if (link.kind === 'url' && typeof link.url === 'string' && link.url.trim()) out.push({ kind: 'href', field: label, href: link.url.trim() })
    }
    else if (field.type === 'richText' && typeof value === 'string') {
      for (const match of value.matchAll(/<a\s[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
        const href = decodeEntities(match[1] ?? match[2] ?? '').trim()
        if (href) out.push({ kind: 'href', field: label, href })
      }
    }
    else if (field.type === 'text' && field.format === 'url' && typeof value === 'string' && value.trim()) {
      out.push({ kind: 'href', field: label, href: value.trim() })
    }
  }
  return out
}

const decodeEntities = (text: string) => text.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>')

/**
 * Nature d'une adresse saisie dans un lien :
 * - `internal` : une page ou un fichier de ce site (`path` : son chemin, sans paramètres ni ancre) ;
 * - `external` : un autre site (`url` : l'adresse complète, sans ancre) ;
 * - `skip` : rien à vérifier (e-mail, téléphone, ancre de la page) ;
 * - `invalid` : ce n'est pas une adresse (« www.site.fr » sans https://, texte libre).
 */
export type HrefKind =
  | { kind: 'internal'; path: string }
  | { kind: 'external'; url: string }
  | { kind: 'skip' }
  | { kind: 'invalid'; reason: string }

/** `origins` : les adresses de ce site (celle de `site.url`, celle du back-office), pour reconnaître un lien écrit en entier. */
export function classifyHref(href: string, origins: string[]): HrefKind {
  // « //site.fr/page » : même protocole que la page, donc un autre site.
  const raw = href.trim().replace(/^\/\//, 'https://')
  if (!raw || raw.startsWith('#') || /^(mailto|tel|sms):/i.test(raw)) return { kind: 'skip' }
  if (raw.startsWith('/')) {
    const path = raw.split(/[?#]/)[0]!
    return { kind: 'internal', path }
  }
  if (/^https?:\/\//i.test(raw)) {
    let url: URL
    try { url = new URL(raw) }
    catch { return { kind: 'invalid', reason: 'Adresse mal écrite.' } }
    if (origins.some(o => o && sameOrigin(o, url))) return { kind: 'internal', path: url.pathname }
    url.hash = ''
    return { kind: 'external', url: url.toString() }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return { kind: 'skip' }
  if (/^(www\.|[a-z0-9-]+\.[a-z]{2,}(\/|$))/i.test(raw)) return { kind: 'invalid', reason: 'Il manque « https:// » au début : le lien est pris pour une page de ce site.' }
  return { kind: 'invalid', reason: 'Ce n\'est pas une adresse : écrivez « /page » pour une page du site, ou « https://… » pour un autre site.' }
}

function sameOrigin(origin: string, url: URL) {
  try { return new URL(origin).host.replace(/^www\./, '') === url.host.replace(/^www\./, '') }
  catch { return false }
}

/** Forme de comparaison d'un chemin du site (comme les redirections) ; le chemin tel quel s'il n'est pas valide. */
export const healthPathKey = (path: string) => canonicalPath(path) ?? path

/** Chemins servis par le core lui-même, qui ne sont pas des pages : inutile de les vérifier. */
export const isCorePath = (path: string) => /^\/(admin|api|_nuxt|_cms)(\/|$)/.test(path)

// ───────────────────────── Vérification d'une adresse externe ─────────────────────────

/**
 * Verdict sur la réponse d'un site externe :
 * - `ok` : la page répond ;
 * - `broken` : elle n'existe plus (404, 410) ;
 * - `down` : le site ne répond pas ou répond par une erreur (panne, domaine disparu, délai dépassé) ;
 * - `unknown` : le site refuse les vérifications automatiques (401, 403, 429…) : on ne peut rien en dire, et ce
 *   n'est pas compté comme un problème. Beaucoup de grands sites (réseaux sociaux) répondent ainsi.
 */
export type LinkVerdict = 'ok' | 'broken' | 'down' | 'unknown'

export function verdictForStatus(status: number): LinkVerdict {
  if (status >= 200 && status < 400) return 'ok'
  if (status === 404 || status === 410) return 'broken'
  if (status >= 500 && status !== 999) return 'down'
  return 'unknown'
}

export const VERDICT_LABELS: Record<LinkVerdict, string> = { ok: 'Répond', broken: 'Page introuvable', down: 'Ne répond pas', unknown: 'Non vérifiable' }

/**
 * Adresse qu'il ne faut jamais faire appeler par le serveur : la machine elle-même, un réseau privé, un nom interne.
 * Un lien saisi dans un contenu ne doit pas servir à sonder le réseau de l'hébergeur.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.') && !host.includes(':')) return true
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  }
  // IPv6 : boucle locale, adresses locales (fc00::/7, fe80::/10), IPv4 enveloppée.
  if (host.includes(':')) return host === '::1' || host === '::' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith('::ffff:')
  return false
}

// ───────────────────────── Fichiers ─────────────────────────

export type HealthMedia = { id: string; name: string; mime: string; size: number; alt: Record<string, string> }

/** Image trop lourde ? Les SVG et les PDF ne sont pas concernés. */
export const isHeavyImage = (file: { mime: string; size: number }) =>
  file.mime.startsWith('image/') && file.mime !== 'image/svg+xml' && file.size > HEALTH_LIMITS.heavyImageBytes

/** Image sans texte alternatif dans la langue principale du site (celle que le site affiche à défaut d'une autre). */
export const lacksAlt = (file: { mime: string; alt: Record<string, string> }, defaultLocale: string) =>
  file.mime.startsWith('image/') && !(file.alt[defaultLocale] ?? '').trim()

// ───────────────────────── Ce que l'écran affiche ─────────────────────────

/** Où un problème se trouve : un contenu, dans une langue, et le champ concerné. */
export type HealthUse = { type: string; id: string; locale: string; name: string; typeLabel: string; field: string; to: string }

export type HealthFileIssue = { id: string; name: string; size: number; to: string; uses: number }

export type HealthReport = {
  /** Nombre de pages et de contenus en ligne examinés. */
  examined: number
  links: {
    /** Lien vers un contenu supprimé ou retiré du site dans cette langue : certain, rien à vérifier. */
    missingPages: (HealthUse & { target: string })[]
    /** Adresse mal écrite. */
    invalid: (HealthUse & { href: string; reason: string })[]
    /** Chemins de ce site qui ne correspondent à aucune page connue : le navigateur les vérifie. */
    internal: { path: string; uses: HealthUse[] }[]
    /** Adresses d'autres sites : le serveur les vérifie par paquets. */
    external: { url: string; uses: HealthUse[] }[]
    /** Nombre de liens examinés, tous genres confondus. */
    total: number
  }
  images: { withoutAlt: HealthFileIssue[]; heavy: HealthFileIssue[] }
  /** Fichiers de la médiathèque que rien ne cite (contenus, brouillons, corbeille, réglages). */
  unused: { count: number; size: number; files: HealthFileIssue[] }
  /** Résumé de l'écran « Pages et titres », pour les contenus que la personne peut modifier ; null sans page concernée. */
  seo: { pages: number; improve: number; missingTitle: number; missingDescription: number } | null
}

/** Nombre de problèmes certains d'un rapport (sans les liens encore à vérifier ni les simples rappels). */
export const healthCertainCount = (report: HealthReport) =>
  report.links.missingPages.length + report.links.invalid.length + report.images.withoutAlt.length + report.images.heavy.length
