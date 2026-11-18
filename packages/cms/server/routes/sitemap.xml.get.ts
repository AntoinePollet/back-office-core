import { isNotNull } from 'drizzle-orm'

const xml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&apos;' })[c]!)

/** Plan du site : toutes les pages publiées, dans chaque langue, sauf celles masquées des moteurs de recherche. */
export default defineEventHandler(async (event) => {
  const db = useDb(event)
  const base = (cmsConfig.site.url ?? getRequestURL(event).origin).replace(/\/$/, '')
  const [docs, rows] = await Promise.all([
    db.select().from(schema.entries),
    db.select().from(schema.entryLocales).where(isNotNull(schema.entryLocales.published)),
  ])
  const hidden = new Set(docs.filter(d => (d.sharedPublished?.seo as { noindex?: boolean } | undefined)?.noindex).map(d => d.id))
  const multi = cmsConfig.site.locales.length > 1

  const urls: string[] = []
  for (const row of rows) {
    const def = cmsConfig.collections?.[row.type] ?? cmsConfig.singletons?.[row.type]
    if (!def?.path || hidden.has(row.entryId) || !cmsConfig.site.locales.includes(row.locale)) continue
    const alternates = multi
      ? rows.filter(r => r.entryId === row.entryId).map(r => `    <xhtml:link rel="alternate" hreflang="${xml(r.locale)}" href="${xml(base + publicPath(def, r.locale, r.slug))}"/>`)
      : []
    urls.push(['  <url>', `    <loc>${xml(base + publicPath(def, row.locale, row.slug))}</loc>`, `    <lastmod>${(row.publishedAt ?? row.updatedAt).toISOString()}</lastmod>`, ...alternates, '  </url>'].join('\n'))
  }
  setResponseHeader(event, 'content-type', 'application/xml; charset=utf-8')
  allowSiteCache(event)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`
})
