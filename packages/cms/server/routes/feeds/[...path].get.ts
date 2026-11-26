import { inArray } from 'drizzle-orm'
import { FEED_DEFAULT_LIMIT, entrySummary, feedOptions, feedPath, fieldDate, rssXml } from '../../../shared/feeds'

/**
 * Flux RSS d'une collection déclarée avec `feed` : `/feeds/articles.xml`, `/feeds/en/articles.xml`.
 * Les derniers contenus publiés, du plus récent au plus ancien, sans les pages masquées des moteurs de recherche.
 * Réponse publique, gardée en cache comme les contenus et vidée à chaque publication.
 */
export default defineEventHandler(async (event) => {
  const { site } = cmsConfig
  const match = /^(?:([a-z]{2}(?:-[A-Z]{2})?)\/)?([a-zA-Z0-9]+)\.xml$/.exec(getRouterParam(event, 'path') ?? '')
  const locale = match?.[1] ?? site.defaultLocale
  const type = match?.[2] ?? ''
  const def = cmsConfig.collections?.[type]
  const options = def && feedOptions(def)
  // La langue par défaut n'a qu'une adresse (sans préfixe) : pas de contenu en double sous « /feeds/fr/… ».
  if (!def || !options || !site.locales.includes(locale) || (match?.[1] && locale === site.defaultLocale)) throw createError({ statusCode: 404, message: 'Flux introuvable.' })

  const base = siteBase(event)
  const pages = await livePages(event, [type], locale)
  const dated = pages.map(page => ({ page, date: (options.date && fieldDate(page.values[options.date])) || page.publishedAt }))
    .sort((a, b) => b.date.getTime() - a.date.getTime() || a.page.title.localeCompare(b.page.title, locale))
    .slice(0, options.limit ?? FEED_DEFAULT_LIMIT)

  // Images jointes : le fichier de la médiathèque donne son adresse, son type et son poids.
  const imageField = options.image ?? def.list?.thumbnail
  const imageIds = [...new Set(dated.map(({ page }) => (imageField ? page.values[imageField] : null)).filter((id): id is string => typeof id === 'string' && !!id))]
  const files = new Map((imageIds.length ? await useDb(event).select().from(schema.media).where(inArray(schema.media.id, imageIds.slice(0, 100))) : []).map(m => [m.id, m]))

  setResponseHeader(event, 'content-type', 'application/rss+xml; charset=utf-8')
  allowSiteCache(event)
  return rssXml({
    title: localized(options.title, locale) || `${def.label} — ${site.name}`,
    description: localized(site.description, locale) || `${def.label} : les dernières publications de ${site.name}.`,
    siteUrl: base + (locale === site.defaultLocale ? '/' : `/${locale}/`),
    feedUrl: base + feedPath(type, locale, site.defaultLocale),
    locale,
    items: dated.map(({ page, date }) => {
      const file = imageField ? files.get(String(page.values[imageField] ?? '')) : undefined
      const content = options.content ? page.values[options.content] : null
      return {
        title: page.title, url: page.url, date,
        description: entrySummary(page.fields, page.values, { field: options.description, seoDescription: page.seoDescription, skip: def.titleField }),
        content: typeof content === 'string' && content.trim() ? content : null,
        image: file?.mime.startsWith('image/') ? { url: base + mediaUrl(file.key), mime: file.mime, size: file.size } : null,
      }
    }),
  })
})
