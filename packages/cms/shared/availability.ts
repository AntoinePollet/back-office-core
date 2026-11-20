/**
 * Disponibilité du site : en ligne, en construction, ou en maintenance (« de retour bientôt »).
 * Réglage enregistré sous la clé `availability` de cms_settings ; écran « Disponibilité » du back-office.
 *
 * Quand le site n'est pas en ligne, chaque page du site est remplacée par une page d'attente (server/middleware/
 * 03.availability.ts). Le back-office, l'API, les médias et les fichiers (robots.txt, sitemap.xml…) restent servis,
 * et le mode aperçu (`?preview=1` pour une personne connectée, lien d'aperçu partagé) montre le vrai site.
 *
 * - En construction : réponse 200 marquée `noindex`, et robots.txt interdit l'exploration. Pour un site pas encore lancé.
 * - Maintenance : réponse 503 avec `Retry-After`. Les moteurs de recherche comprennent que la coupure est temporaire et
 *   gardent les pages du site dans leurs résultats.
 *
 * La page d'attente est un document HTML autonome (`closedPageHtml`), sans le code du site : elle s'affiche même si le
 * site est en panne, et le back-office la montre en aperçu à l'identique. Fonctions sans dépendance.
 */
import { type CmsTheme, DEFAULT_THEME, luminance } from './theme'

export const AVAILABILITY_MODES = ['online', 'construction', 'maintenance'] as const
export type AvailabilityMode = typeof AVAILABILITY_MODES[number]
export type ClosedMode = Exclude<AvailabilityMode, 'online'>
export const CLOSED_MODES: ClosedMode[] = ['construction', 'maintenance']

export const MODE_LABELS: Record<AvailabilityMode, string> = {
  online: 'En ligne',
  construction: 'En construction',
  maintenance: 'Maintenance',
}

/** Modèles de page d'attente. */
export const CLOSED_TEMPLATES = {
  simple: { label: 'Sobre', help: 'Texte centré sur le fond du site, bouton de contact.' },
  image: { label: 'Image plein écran', help: 'Une photo de la médiathèque en fond, texte en blanc par-dessus.' },
  color: { label: 'Couleur vive', help: 'Grand titre sur la couleur principale du site.' },
} as const
export type ClosedTemplate = keyof typeof CLOSED_TEMPLATES
const TEMPLATES = Object.keys(CLOSED_TEMPLATES) as ClosedTemplate[]

export type ClosedTexts = { title: string; message: string }
export type ClosedPage = {
  template: ClosedTemplate
  /** Image de la médiathèque (modèle « Image plein écran »). */
  imageId: string | null
  /** Adresse e-mail, téléphone, ou texte libre. Vide : pas de contact affiché. */
  contact: string
  /** Par langue du site. Un texte vide prend celui de la langue par défaut, puis le texte proposé. */
  texts: Record<string, ClosedTexts>
}
export type Availability = { mode: AvailabilityMode; pages: Record<ClosedMode, ClosedPage> }

export const TITLE_MAX = 120
export const MESSAGE_MAX = 1000
export const CONTACT_MAX = 200

/** Textes proposés quand rien n'est saisi. Les langues sans traduction prennent le français. */
export const DEFAULT_TEXTS: Record<ClosedMode, Record<string, ClosedTexts>> = {
  construction: {
    fr: { title: 'Site en construction', message: 'Notre nouveau site arrive très bientôt. Merci de votre patience !' },
    en: { title: 'Website under construction', message: 'Our new website is coming very soon. Thank you for your patience!' },
  },
  maintenance: {
    fr: { title: 'De retour très bientôt', message: 'Le site est en maintenance pour quelques instants. Merci de revenir un peu plus tard.' },
    en: { title: 'Back very soon', message: 'The website is undergoing maintenance. Please come back a little later.' },
  },
}
const CONTACT_LABEL: Record<string, string> = { fr: 'Nous contacter', en: 'Contact us' }

/** Durée annoncée aux moteurs de recherche avant de revenir, en secondes (`Retry-After` d'une maintenance). */
export const MAINTENANCE_RETRY_AFTER = 3600

const emptyPage = (template: ClosedTemplate): ClosedPage => ({ template, imageId: null, contact: '', texts: {} })
export const defaultAvailability = (): Availability => ({
  mode: 'online',
  pages: { construction: emptyPage('simple'), maintenance: emptyPage('simple') },
})

const clean = (value: unknown, max: number) => String(value ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max)

function cleanPage(input: any, locales: readonly string[]): ClosedPage {
  const texts: Record<string, ClosedTexts> = {}
  for (const locale of locales) {
    const t = input?.texts?.[locale]
    const title = clean(t?.title, TITLE_MAX).replace(/\s+/g, ' ')
    const message = clean(t?.message, MESSAGE_MAX)
    if (title || message) texts[locale] = { title, message }
  }
  return {
    template: TEMPLATES.includes(input?.template) ? input.template : 'simple',
    imageId: typeof input?.imageId === 'string' && input.imageId ? input.imageId.slice(0, 100) : null,
    contact: clean(input?.contact, CONTACT_MAX).replace(/\s+/g, ' '),
    texts,
  }
}

/** Réglage tel qu'enregistré (ou absent) → réglage complet. Une valeur abîmée donne le site en ligne. */
export function normalizeAvailability(stored: unknown, locales: readonly string[]): Availability {
  const input = stored as any
  return {
    mode: AVAILABILITY_MODES.includes(input?.mode) ? input.mode : 'online',
    pages: {
      construction: cleanPage(input?.pages?.construction, locales),
      maintenance: cleanPage(input?.pages?.maintenance, locales),
    },
  }
}

/** Vérifie un réglage reçu du back-office. Renvoie le réglage nettoyé, ou un message d'erreur. */
export function parseAvailability(input: any, locales: readonly string[]): Availability | string {
  if (!AVAILABILITY_MODES.includes(input?.mode)) return 'État du site inconnu.'
  for (const mode of CLOSED_MODES) {
    const page = input?.pages?.[mode]
    if (page == null) continue
    if (!TEMPLATES.includes(page.template)) return 'Modèle de page inconnu.'
    if (page.imageId != null && typeof page.imageId !== 'string') return 'Image invalide.'
    for (const locale of locales) {
      const t = page.texts?.[locale]
      if (String(t?.title ?? '').trim().length > TITLE_MAX) return `Titre trop long (${TITLE_MAX} caractères au plus).`
      if (String(t?.message ?? '').trim().length > MESSAGE_MAX) return `Message trop long (${MESSAGE_MAX} caractères au plus).`
    }
    if (String(page.contact ?? '').trim().length > CONTACT_MAX) return `Contact trop long (${CONTACT_MAX} caractères au plus).`
  }
  return normalizeAvailability(input, locales)
}

/** Langue d'une adresse du site : le premier segment s'il est une autre langue du site (`/en/…`), sinon la langue par défaut. */
export function localeFromPath(path: string, locales: readonly string[], defaultLocale: string) {
  const first = path.split('/')[1] ?? ''
  return first !== defaultLocale && locales.includes(first) ? first : defaultLocale
}

/** Textes affichés : ceux de la langue, sinon ceux de la langue par défaut, sinon le texte proposé. Champ par champ. */
export function closedTexts(page: ClosedPage, mode: ClosedMode, locale: string, defaultLocale: string): ClosedTexts {
  const proposed = DEFAULT_TEXTS[mode][locale] ?? DEFAULT_TEXTS[mode][defaultLocale] ?? DEFAULT_TEXTS[mode].fr!
  const own = page.texts[locale], main = page.texts[defaultLocale]
  return {
    title: own?.title || main?.title || proposed.title,
    message: own?.message || main?.message || proposed.message,
  }
}

/**
 * Une requête est-elle une page du site, à remplacer par la page d'attente ?
 * Tout ce qui n'est pas une page reste servi : back-office, API (le site et le back-office en ont besoin), médias,
 * fichiers internes (`/_nuxt/`, `/_cms/`…) et fichiers (`/robots.txt`, `/favicon.ico`, `/sitemap.xml`).
 * L'en-tête Accept n'est pas consulté : une page servie à un client sans `text/html` pourrait être gardée en cache et
 * resservie à tout le monde.
 */
export function isSitePage(method: string, path: string) {
  if (method !== 'GET' && method !== 'HEAD') return false
  const pathname = path.split('?')[0]!
  if (pathname === '/admin' || /^\/(admin|api|media|_[^/]*)(\/|$)/.test(pathname) || pathname.startsWith('/__')) return false
  return !/\.[a-z0-9]{1,8}$/i.test(pathname.split('/').pop() ?? '')
}

// ───────────────────────── Page d'attente ─────────────────────────

const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]!)
/** Adresse à placer dans `url("…")` d'une feuille de style : les entités HTML n'y sont pas lues, on encode. */
const cssUrl = (url: string) => url.replace(/["'\\()<>\s]/g, c => encodeURIComponent(c))
const textOn = (hex: string) => (luminance(hex) > 0.179 ? '#111827' : '#ffffff')

/** Lien du contact : e-mail → mailto:, téléphone → tel:, sinon pas de lien. */
export function contactHref(contact: string) {
  const text = contact.trim()
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return `mailto:${text}`
  if (/^\+?[\d\s.()-]{6,20}$/.test(text) && (text.match(/\d/g)?.length ?? 0) >= 6) return `tel:${text.replace(/[^\d+]/g, '')}`
  return null
}

export type ClosedPageInput = {
  mode: ClosedMode
  page: ClosedPage
  locale: string
  defaultLocale: string
  siteName: string
  theme: CmsTheme | null
  /** Adresse de l'image de fond (modèle « Image plein écran »), et position de son point d'intérêt (`50% 30%`). */
  image?: { url: string; position?: string } | null
}

/** Document HTML complet de la page d'attente. Tout le texte saisi est échappé. */
export function closedPageHtml(input: ClosedPageInput) {
  const { mode, page, locale, siteName } = input
  const theme = { ...DEFAULT_THEME, ...input.theme }
  const texts = closedTexts(page, mode, locale, input.defaultLocale)
  const template = page.template === 'image' && !input.image ? 'simple' : page.template
  const href = page.contact ? contactHref(page.contact) : null
  const radius = `${theme.radius}rem`

  const palette = {
    simple: { bg: theme.base, fg: textOn(theme.base), soft: 'color-mix(in oklab, currentColor 70%, transparent)', brand: theme.primary, button: theme.primary, buttonText: textOn(theme.primary) },
    image: { bg: '#111827', fg: '#ffffff', soft: 'rgba(255,255,255,.85)', brand: '#ffffff', button: '#ffffff', buttonText: '#111827' },
    color: { bg: theme.primary, fg: textOn(theme.primary), soft: 'color-mix(in oklab, currentColor 82%, transparent)', brand: textOn(theme.primary), button: textOn(theme.primary), buttonText: theme.primary },
  }[template]

  const message = texts.message.split(/\n{2,}/).map(p => `<p>${escape(p).replace(/\n/g, '<br>')}</p>`).join('')
  const contact = page.contact
    ? href
      ? `<a class="contact" href="${escape(href)}"><span>${escape(CONTACT_LABEL[locale] ?? CONTACT_LABEL.fr!)}</span> ${escape(page.contact)}</a>`
      : `<p class="contact contact-text">${escape(page.contact)}</p>`
    : ''
  const background = template === 'image' && input.image
    ? `background:#111827 url("${cssUrl(input.image.url)}") ${/^[\d.]+% [\d.]+%$/.test(input.image.position ?? '') ? input.image.position : '50% 50%'}/cover no-repeat;`
    : ''

  return `<!doctype html>
<html lang="${escape(locale)}" data-cms-closed="${mode}" data-template="${template}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${mode === 'construction' ? '<meta name="robots" content="noindex">\n' : ''}<title>${escape(texts.title)} — ${escape(siteName)}</title>
<style>
*{box-sizing:border-box}
html,body{margin:0;min-height:100%}
body{min-height:100vh;min-height:100dvh;display:flex;flex-direction:column;background:${palette.bg};${background}color:${palette.fg};font:17px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
.veil{flex:1;display:flex;flex-direction:column;${template === 'image' ? 'background:linear-gradient(180deg,rgba(0,0,0,.35),rgba(0,0,0,.65));' : ''}}
header{padding:24px 28px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:13px;color:${palette.brand}}
main{flex:1;display:flex;align-items:center;justify-content:${template === 'color' ? 'flex-start' : 'center'};padding:24px 28px 64px}
.box{max-width:${template === 'color' ? '44rem' : '34rem'};text-align:${template === 'color' ? 'left' : 'center'}}
h1{margin:0 0 16px;font-size:${template === 'color' ? 'clamp(40px,8vw,76px)' : 'clamp(30px,5vw,44px)'};line-height:1.1;letter-spacing:-.02em;font-weight:${template === 'color' ? 800 : 700}}
.message{color:${palette.soft};font-size:${template === 'color' ? '20px' : '18px'}}
.message p{margin:0 0 12px}
.contact{display:inline-flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-top:20px;padding:12px 22px;border-radius:${radius};background:${palette.button};color:${palette.buttonText};text-decoration:none;font-weight:600;font-size:16px;overflow-wrap:anywhere}
.contact span{opacity:.75;font-weight:500}
.contact-text{background:none;color:inherit;padding:0;font-weight:500}
a.contact:focus-visible{outline:3px solid ${palette.fg};outline-offset:3px}
${template === 'simple' ? `.mark{width:44px;height:4px;border-radius:4px;background:${theme.primary};margin:0 auto 28px}` : ''}
${template === 'color' ? '@media (min-width:900px){header,main{padding-left:clamp(28px,8vw,128px);padding-right:clamp(28px,8vw,128px)}}\n' : ''}@media (max-width:480px){header{padding:18px 16px}main{padding:16px 16px 48px}body{font-size:16px}}
</style>
</head>
<body>
<div class="veil">
<header>${escape(siteName)}</header>
<main><div class="box">
${template === 'simple' ? '<div class="mark" aria-hidden="true"></div>\n' : ''}<h1>${escape(texts.title)}</h1>
<div class="message">${message}</div>
${contact}
</div></main>
</div>
</body>
</html>
`
}
