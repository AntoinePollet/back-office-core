import { and, eq } from 'drizzle-orm'

/**
 * Un contenu publié d'une collection, retrouvé par son adresse (ou son identifiant).
 * Si l'adresse est une ancienne adresse, répond { _redirect: nouvelle adresse } : `useEntry` redirige le visiteur.
 */
export default defineEventHandler(async (event) => {
  const type = getRouterParam(event, 'type')!
  const slug = getRouterParam(event, 'slug')!
  const { def, locale, preview, items } = await readPublic(event, type, slug)
  if (items[0]) return items[0]

  const { redirects, entryLocales } = schema
  const db = useDb(event)
  const [old] = await db.select().from(redirects).where(and(eq(redirects.type, type), eq(redirects.locale, locale), eq(redirects.slug, slug)))
  const [current] = old ? await db.select().from(entryLocales).where(and(eq(entryLocales.entryId, old.entryId), eq(entryLocales.locale, locale))) : []
  if (current?.slug && (preview || current.published)) return { _redirect: publicPath(def, locale, current.slug) }
  throw createError({ statusCode: 404, message: 'Page introuvable.' })
})
