/** Consignes aux moteurs de recherche. Un fichier public/robots.txt dans le projet client prend le dessus. */
export default defineEventHandler((event) => {
  const base = (cmsConfig.site.url ?? getRequestURL(event).origin).replace(/\/$/, '')
  setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8')
  allowSiteCache(event)
  return `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n\nSitemap: ${base}/sitemap.xml\n`
})
