import { eq } from 'drizzle-orm'
import type { H3Event } from 'h3'

/**
 * Favoris du menu du back-office : les écrans qu'une personne a épinglés en haut du menu, dans l'ordre qu'elle a choisi.
 * Rangés par compte dans cms_settings (clé `favorites:<id du compte>`), pour la suivre d'un appareil à l'autre.
 * Un favori est l'adresse d'un écran du back-office (`/admin/media`, `/admin/services`) : le menu ne montre que ceux
 * auxquels la personne a encore accès.
 */
export const FAVORITES_MAX = 20
const key = (userId: string) => `favorites:${userId}`

/** Nettoie une liste reçue : adresses du back-office seulement, sans doublon, 20 au plus. */
export function cleanFavorites(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const out: string[] = []
  for (const value of input) {
    const path = String(value ?? '').trim()
    if (!/^\/admin(\/[\w\-./]*)?$/.test(path) || path.length > 200 || out.includes(path)) continue
    out.push(path)
    if (out.length >= FAVORITES_MAX) break
  }
  return out
}

export async function readFavorites(event: H3Event, userId: string) {
  const [row] = await useDb(event).select().from(schema.settings).where(eq(schema.settings.key, key(userId)))
  return cleanFavorites(row?.value)
}

export async function saveFavorites(event: H3Event, userId: string, favorites: string[]) {
  const now = new Date()
  await useDb(event).insert(schema.settings).values({ key: key(userId), value: favorites, updatedAt: now })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: favorites, updatedAt: now } })
}

/** À la suppression d'un compte. */
export const forgetFavorites = (event: H3Event, userId: string) =>
  useDb(event).delete(schema.settings).where(eq(schema.settings.key, key(userId)))
