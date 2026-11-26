import { eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import type { CustomFont } from '../../shared/fonts'

/**
 * Polices envoyées depuis l'écran Apparence. Le fichier est rangé comme un fichier de la médiathèque (même stockage,
 * même adresse `/media/…`, compris dans les sauvegardes et l'export), mais il n'y est pas montré : il se gère dans
 * l'écran Apparence. Ce qui le décrit (famille, graisse, style) est gardé ici, dans les réglages du site.
 */
const KEY = 'fonts'

/** Un fichier de la médiathèque est-il une police ? Ces fichiers n'apparaissent pas dans la médiathèque. */
export const isFontMime = (mime: string) => mime.startsWith('font/')

export async function loadCustomFonts(event: H3Event): Promise<CustomFont[]> {
  const [row] = await useDb(event).select().from(schema.settings).where(eq(schema.settings.key, KEY))
  return Array.isArray(row?.value) ? row.value as CustomFont[] : []
}

export async function saveCustomFonts(event: H3Event, fonts: CustomFont[]) {
  const now = new Date()
  await useDb(event).insert(schema.settings).values({ key: KEY, value: fonts, updatedAt: now })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: fonts, updatedAt: now } })
}

/** Noms des familles envoyées, pour vérifier un thème. */
export const customFontFamilies = async (event: H3Event) => [...new Set((await loadCustomFonts(event)).map(f => f.family))]
