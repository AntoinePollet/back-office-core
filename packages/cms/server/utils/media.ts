import type { H3Event } from 'h3'
import { canOrganizeMedia } from '../../shared/access'
import { normalizeFocus } from '../../shared/media'

/** `focus` est facultatif : un fichier sorti d'une corbeille plus ancienne que le point d'intérêt n'en a pas. */
type MediaRow = Omit<typeof schema.media.$inferSelect, 'focus'> & { focus?: { x: number; y: number } | null }

export const MEDIA_MAX_SIZE = 20 * 1024 * 1024
/** Types de fichiers acceptés par la médiathèque. */
export const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/svg+xml', 'application/pdf']

export const mediaUrl = (key: string) => `/media/${key}`
/** Adresse d'une vignette. Pour un fichier qui ne se redimensionne pas (SVG, PDF), le paramètre est ignoré. */
export const thumbUrl = (key: string, width = 160) => `/media/${key}?w=${width}`

/** Le stockage des fichiers de la médiathèque (R2 chez Cloudflare, disque ou S3 ailleurs). */
export const useBucket = (event: H3Event) => usePlatform().mediaBucket(event)

/** Un fichier tel que le back-office le reçoit. */
export function toAdminMedia(row: MediaRow) {
  return { id: row.id, url: mediaUrl(row.key), name: row.name, mime: row.mime, size: row.size, width: row.width, height: row.height, alt: row.alt, focus: normalizeFocus(row.focus), createdAt: row.createdAt, folderId: row.folderId ?? null }
}

/** Un fichier tel que le site le reçoit : le texte alternatif est celui de la langue demandée. */
export function toPublicMedia(row: MediaRow, locale: string) {
  return { id: row.id, url: mediaUrl(row.key), name: row.name, alt: row.alt[locale] || row.alt[cmsConfig.site.defaultLocale] || '', mime: row.mime, width: row.width, height: row.height, focus: normalizeFocus(row.focus) }
}

/** Dossiers de la médiathèque, tels que le back-office les reçoit. */
export async function listMediaFolders(event: H3Event) {
  const rows = await useDb(event).select().from(schema.mediaFolders)
  return rows.map(r => ({ id: r.id, name: r.name, parentId: r.parentId ?? null }))
}

/** Refuse l'action à qui ne peut pas ranger la médiathèque. */
export function assertCanOrganizeMedia(user: Parameters<typeof canOrganizeMedia>[0]) {
  if (!canOrganizeMedia(user)) throw createError({ statusCode: 403, message: 'Vous ne pouvez pas ranger la médiathèque (dossiers). Demandez à un éditeur.' })
}
