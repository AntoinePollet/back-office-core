/**
 * Ce que le site publie pour les lecteurs automatiques, en plus du plan du site :
 * - un flux RSS par collection qui le demande (`feed: true`) : les derniers contenus publiés, pour les lecteurs de
 *   flux, les outils de veille et les services qui relaient les nouveautés (lettre d'information, réseaux) ;
 * - `/llms.txt` : la liste des pages du site avec leur résumé, en Markdown, à l'intention des assistants (format
 *   proposé sur llmstxt.org). Rien de plus que ce qui est déjà public : mêmes pages que le plan du site.
 * Logique pure, partagée par les routes et leurs tests.
 */
import type { AnyField } from './format'
import { contentTexts, htmlToText } from './site-search'

type Fields = Record<string, AnyField>
type Values = Record<string, unknown>

// ───────────────────────── Flux RSS ─────────────────────────

export type FeedOptions = {
  /** Titre du flux : un texte, ou un texte par langue. Défaut : « Nom de la collection — Nom du site ». */
  title?: string | Record<string, string>
  /** Champ qui résume un élément (texte, texte long ou texte mis en forme). Défaut : la description de l'onglet Référencement, sinon le début du texte. */
  description?: string
  /** Champ date de parution. Défaut : la date de mise en ligne. */
  date?: string
  /** Champ image jointe à chaque élément. Défaut : la vignette de la liste (`list.thumbnail`). */
  image?: string
  /** Champ de texte mis en forme dont le contenu entier est joint à chaque élément : les lecteurs de flux affichent alors l'article complet. */
  content?: string
  /** Nombre d'éléments (les plus récents). Défaut : 30 ; 100 au plus. */
  limit?: number
}

export const FEED_DEFAULT_LIMIT = 30
export const FEED_MAX_LIMIT = 100
/** Longueur du résumé tiré du texte, quand aucun champ ne le donne. */
export const FEED_EXCERPT_CHARS = 300

/** Les réglages du flux d'une collection, ou null si elle n'en a pas. */
export const feedOptions = (def: { feed?: unknown }): FeedOptions | null =>
  (def.feed === true ? {} : def.feed && typeof def.feed === 'object' ? def.feed as FeedOptions : null)

/** Adresse du flux d'une collection dans une langue : `/feeds/articles.xml`, `/feeds/en/articles.xml`. */
export const feedPath = (type: string, locale: string, defaultLocale: string) => `/feeds/${locale === defaultLocale ? '' : `${locale}/`}${type}.xml`

/** Erreurs de la déclaration `feed` d'une collection, pour `defineCms`. */
export function feedErrors(key: string, def: { kind: string; path?: string; fields: Fields; feed?: unknown }, locales: readonly string[]): string[] {
  if (def.feed === undefined || def.feed === false) return []
  const at = `${key}.feed`
  if (def.kind !== 'collection' || !def.path?.includes('[slug]')) return [`${at} : un flux demande une collection dont chaque élément a sa page (path avec [slug])`]
  const options = feedOptions(def)
  if (!options) return [`${at} : attendu true, ou { title, description, date, image, content, limit }`]
  const errors: string[] = []
  const field = (name: 'description' | 'date' | 'image' | 'content', types: string[]) => {
    const value = options[name]
    if (value === undefined) return
    const found = typeof value === 'string' ? def.fields[value] : undefined
    if (!found) errors.push(`${at}.${name} : champ « ${String(value)} » introuvable`)
    else if (!types.includes(found.type) || found.multiple) errors.push(`${at}.${name} : le champ « ${value} » n'a pas le bon type (attendu : ${types.join(', ')})`)
  }
  field('description', ['text', 'textarea', 'richText'])
  field('date', ['date'])
  field('image', ['image'])
  field('content', ['richText'])
  const { title, limit } = options
  if (title !== undefined && !(typeof title === 'string' ? title.trim() : title && typeof title === 'object' && Object.entries(title).every(([l, v]) => locales.includes(l) && typeof v === 'string' && !!v.trim())))
    errors.push(`${at}.title : un texte est attendu, ou un texte par langue`)
  if (limit !== undefined && !(Number.isInteger(limit) && limit >= 1 && limit <= FEED_MAX_LIMIT)) errors.push(`${at}.limit : un nombre entier de 1 à ${FEED_MAX_LIMIT}`)
  return errors
}

/** Résumé d'un contenu : coupé à la fin d'un mot, avec « … » s'il est coupé. */
export function summarize(text: string, max = FEED_EXCERPT_CHARS): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const cut = clean.lastIndexOf(' ', max)
  return clean.slice(0, cut > max / 2 ? cut : max).replace(/[\s,;:.–—-]+$/, '') + ' …'
}

/** Le résumé d'un contenu : le champ désigné, sinon la description du référencement, sinon le début de ses textes. */
export function entrySummary(fields: Fields, values: Values, options: { field?: string; seoDescription?: string | null; skip?: string }): string {
  const own = options.field ? values[options.field] : undefined
  if (typeof own === 'string' && own.trim()) return summarize(fields[options.field!]?.type === 'richText' ? htmlToText(own) : own, 1000)
  if (options.seoDescription?.trim()) return options.seoDescription.trim()
  return summarize(contentTexts(fields, values, options.skip).join(' '))
}

export type FeedItem = {
  title: string
  url: string
  /** Date de parution. */
  date: Date
  description: string
  /** Contenu entier, en HTML (facultatif). */
  content?: string | null
  image?: { url: string; mime: string; size: number } | null
}

export type FeedChannel = { title: string; description: string; siteUrl: string; feedUrl: string; locale: string; items: FeedItem[] }

const xml = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&apos;' })[c]!)
  // Caractères de contrôle interdits dans un document XML.
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
/** Un texte dans une section CDATA : la seule suite qui la fermerait est coupée en deux. */
const cdata = (text: string) => `<![CDATA[${text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/\]\]>/g, ']]]]><![CDATA[>')}]]>`

/** Date d'un champ date (« 2026-03-01 » ou « 2026-03-01T09:30 », lue en temps universel), ou null si elle est vide ou mal formée. */
export function fieldDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/.test(value)) return null
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : `${value}Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Le document RSS 2.0 d'un flux. */
export function rssXml(channel: FeedChannel): string {
  const latest = channel.items.reduce<Date | null>((max, item) => (!max || item.date > max ? item.date : max), null)
  const items = channel.items.map(item => [
    '    <item>',
    `      <title>${xml(item.title)}</title>`,
    `      <link>${xml(item.url)}</link>`,
    `      <guid isPermaLink="true">${xml(item.url)}</guid>`,
    `      <pubDate>${item.date.toUTCString()}</pubDate>`,
    item.description ? `      <description>${xml(item.description)}</description>` : '',
    item.content ? `      <content:encoded>${cdata(item.content)}</content:encoded>` : '',
    item.image ? `      <enclosure url="${xml(item.image.url)}" length="${item.image.size}" type="${xml(item.image.mime)}"/>` : '',
    '    </item>',
  ].filter(Boolean).join('\n'))
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">',
    '  <channel>',
    `    <title>${xml(channel.title)}</title>`,
    `    <link>${xml(channel.siteUrl)}</link>`,
    `    <description>${xml(channel.description)}</description>`,
    `    <language>${xml(channel.locale)}</language>`,
    `    <atom:link href="${xml(channel.feedUrl)}" rel="self" type="application/rss+xml"/>`,
    latest ? `    <lastBuildDate>${latest.toUTCString()}</lastBuildDate>` : '',
    ...items,
    '  </channel>',
    '</rss>',
    '',
  ].filter(Boolean).join('\n') + '\n'
}

// ───────────────────────── llms.txt ─────────────────────────

/** Nombre maximal de pages listées par rubrique : au-delà, le fichier renvoie au plan du site. */
export const LLMS_MAX_PER_SECTION = 200

export type LlmsSection = { title: string; items: { title: string; url: string; description: string }[]; more?: number }

/** Sur une ligne, sans rien qui casse la mise en forme Markdown d'un lien. */
const line = (text: string) => text.replace(/\s+/g, ' ').trim()
const linkText = (text: string) => line(text).replace(/[[\]]/g, '')

/**
 * Le fichier `llms.txt` : le nom du site, ce qu'il est en une phrase, puis ses pages rangées par rubrique, chacune
 * avec son résumé. Une rubrique vide n'est pas écrite.
 */
export function llmsTxt(input: { siteName: string; description?: string | null; sections: LlmsSection[]; sitemapUrl?: string; feeds?: { title: string; url: string }[] }): string {
  const out = [`# ${line(input.siteName)}`]
  if (input.description?.trim()) out.push('', `> ${line(input.description)}`)
  for (const section of input.sections) {
    if (!section.items.length) continue
    out.push('', `## ${line(section.title)}`, '')
    for (const item of section.items) out.push(`- [${linkText(item.title) || item.url}](${item.url})${item.description ? `: ${line(item.description)}` : ''}`)
    if (section.more && input.sitemapUrl) out.push(`- [${section.more} autres pages dans le plan du site](${input.sitemapUrl})`)
  }
  if (input.feeds?.length) {
    out.push('', '## Flux RSS', '')
    for (const feed of input.feeds) out.push(`- [${linkText(feed.title)}](${feed.url})`)
  }
  return out.join('\n') + '\n'
}
