/**
 * Consignes aux moteurs de recherche. Un fichier public/robots.txt dans le projet client prend le dessus.
 * Site en construction (écran « Disponibilité ») : exploration interdite, rien n'est encore à référencer.
 */
export default defineEventHandler(async (event) => {
  const base = (cmsConfig.site.url ?? getRequestURL(event).origin).replace(/\/$/, '')
  setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8')
  allowSiteCache(event)
  if (await siteMode(event) === 'construction') return 'User-agent: *\nDisallow: /\n'
  return `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n\nSitemap: ${base}/sitemap.xml\n`
})
