import type { CmsDefinition } from '../../shared/format'
import { LLMS_MAX_PER_SECTION, entrySummary, feedOptions, feedPath, llmsTxt } from '../../shared/feeds'

/**
 * `/llms.txt` : les pages publiées du site et leur résumé, en Markdown, à l'intention des assistants (llmstxt.org).
 * Les mêmes pages que le plan du site, rangées par type de contenu. `?locale=en` pour une autre langue.
 * Retiré avec `site.llms: false` ; un fichier `public/llms.txt` du projet prend le dessus. Site en construction :
 * rien n'est encore à lire.
 */
export default defineEventHandler(async (event) => {
  const { site } = cmsConfig
  const locale = String(getQuery(event).locale ?? site.defaultLocale)
  if (site.llms === false || !site.locales.includes(locale)) throw createError({ statusCode: 404, message: 'Page introuvable.' })
  setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8')
  allowSiteCache(event)
  const title = `# ${site.name}\n`
  if (await siteMode(event) === 'construction') return title

  const singletons = Object.entries(cmsConfig.singletons ?? {}) as [string, CmsDefinition][]
  const collections = Object.entries(cmsConfig.collections ?? {}) as [string, CmsDefinition][]
  const pages = await livePages(event, [...singletons, ...collections].map(([type]) => type), locale)
  const item = (page: typeof pages[number]) => ({
    title: page.title, url: page.url,
    // Le résumé désigné pour le flux de la collection, s'il y en a un ; sinon la description du référencement, puis le début du texte.
    description: entrySummary(page.fields, page.values, { field: feedOptions(page.def as { feed?: unknown })?.description, seoDescription: page.seoDescription, skip: page.def.kind === 'collection' ? page.def.titleField : undefined }),
  })
  const section = (title: string, list: typeof pages) => ({ title, items: list.slice(0, LLMS_MAX_PER_SECTION).map(item), more: Math.max(0, list.length - LLMS_MAX_PER_SECTION) })
  const base = siteBase(event)
  return llmsTxt({
    siteName: site.name,
    description: localized(site.description, locale),
    sitemapUrl: `${base}/sitemap.xml`,
    sections: [
      // Les pages uniques dans l'ordre de la configuration (l'accueil d'abord, en général), puis chaque collection.
      section('Pages', singletons.flatMap(([type]) => pages.filter(p => p.type === type))),
      ...collections.map(([type, def]) => section(def.label, sortEntries(def, pages.filter(p => p.type === type), (page, key) => (key === 'position' ? page.position : key === 'publishedAt' || key === 'updatedAt' ? page.publishedAt : page.values[key])))),
    ],
    feeds: collections.filter(([, def]) => feedOptions(def as { feed?: unknown })).map(([type, def]) => ({ title: def.label, url: base + feedPath(type, locale, site.defaultLocale) })),
  })
})
