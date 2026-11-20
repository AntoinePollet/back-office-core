/**
 * Disponibilité du site (règles et page d'attente : shared/availability.ts).
 * Lue à chaque page du site qui atteint le serveur, sans mémoire entre les requêtes : un changement d'état vaut tout
 * de suite, sur toutes les instances. (Une page gardée en cache n'atteint pas le serveur ; le changement d'état purge
 * le cache.)
 */
import { eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import {
  type Availability, type ClosedMode, MAINTENANCE_RETRY_AFTER, closedPageHtml, localeFromPath, normalizeAvailability,
} from '../../shared/availability'
import { cmsImageUrl, cmsObjectPosition } from '../../shared/media'
import type { CmsTheme } from '../../shared/theme'

const KEY = 'availability'

export async function readAvailability(event: H3Event): Promise<Availability> {
  const [row] = await useDb(event).select().from(schema.settings).where(eq(schema.settings.key, KEY))
  return normalizeAvailability(row?.value, cmsConfig.site.locales)
}

export async function saveAvailability(event: H3Event, value: Availability) {
  const now = new Date()
  await useDb(event).insert(schema.settings).values({ key: KEY, value, updatedAt: now })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: now } })
}

/** État du site pour robots.txt et le sitemap, sans lever d'erreur (base indisponible : le site est réputé en ligne). */
export async function siteMode(event: H3Event) {
  return (await readAvailability(event).catch(() => null))?.mode ?? 'online'
}

/** Page d'attente du site, pour une page demandée par un visiteur. */
export async function sendClosedPage(event: H3Event, availability: Availability) {
  const mode = availability.mode as ClosedMode
  const page = availability.pages[mode]
  const { site } = cmsConfig
  const locale = localeFromPath(getRequestURL(event).pathname, site.locales, site.defaultLocale)
  const db = useDb(event)
  const [themeRow] = await db.select().from(schema.settings).where(eq(schema.settings.key, 'theme'))
  let image: { url: string; position?: string } | null = null
  if (page.template === 'image' && page.imageId) {
    const [row] = await db.select().from(schema.media).where(eq(schema.media.id, page.imageId))
    if (row?.mime.startsWith('image/')) {
      const media = toPublicMedia(row, locale)
      image = { url: cmsImageUrl(media, 1920), position: cmsObjectPosition(media) }
    }
  }
  setResponseStatus(event, mode === 'maintenance' ? 503 : 200)
  setResponseHeaders(event, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': NO_CACHE,
    ...(mode === 'maintenance' ? { 'retry-after': MAINTENANCE_RETRY_AFTER } : { 'x-robots-tag': 'noindex' }),
  })
  if (event.method === 'HEAD') return ''
  return closedPageHtml({
    mode, page, locale, defaultLocale: site.defaultLocale, siteName: site.name,
    theme: (themeRow?.value as CmsTheme | undefined) ?? null, image,
  })
}
