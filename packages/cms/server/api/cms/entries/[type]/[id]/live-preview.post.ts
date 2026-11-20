import { and, eq } from 'drizzle-orm'
import { canEditRestricted } from '../../../../../../shared/access'
import { applyDefaults, normalizeValues, partition, pick } from '../../../../../../shared/content'
import type { AnyField } from '../../../../../../shared/format'

type Values = Record<string, unknown>
type Fields = Record<string, AnyField>

const isRecord = (v: unknown): v is Values => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Aperçu en direct : prépare les valeurs en cours de saisie d'un contenu, dans une langue, comme l'API publique
 * les renverrait si elles étaient enregistrées (HTML nettoyé, vides normalisés, champs masqués vidés, images,
 * galeries, relations et liens remplacés par leur contenu). **Rien n'est écrit en base.**
 *
 * Demande : `{ locale, shared, values }` (les deux parties du formulaire). Réponse : `{ entry }`.
 * Mêmes droits que l'ouverture du formulaire. Répond 409 tant que la page n'a pas d'adresse enregistrée dans cette langue.
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const type = getRouterParam(event, 'type')!
  const id = getRouterParam(event, 'id')!
  const def = getDef(type)
  assertAccess(user, type, 'edit')

  const body = await readBody<{ locale?: unknown; shared?: unknown; values?: unknown }>(event)
  if (!isRecord(body)) throw createError({ statusCode: 400, message: 'Un objet JSON est attendu.' })
  const locale = String(body.locale ?? cmsConfig.site.defaultLocale)
  if (!cmsConfig.site.locales.includes(locale)) throw createError({ statusCode: 400, message: `Langue inconnue « ${locale} ».` })
  if ((body.shared !== undefined && !isRecord(body.shared)) || (body.values !== undefined && !isRecord(body.values)))
    throw createError({ statusCode: 400, message: 'shared et values : des objets { nomDuChamp: valeur } sont attendus.' })

  const db = useDb(event)
  const { entries, entryLocales } = schema
  const [existing] = await db.select().from(entries).where(and(eq(entries.id, id), eq(entries.type, type)))
  if (!existing) throw createError({ statusCode: 404, message: 'Contenu introuvable.' })
  assertEntryAccess(user, type, existing, 'edit')
  const rows = await db.select().from(entryLocales).where(eq(entryLocales.entryId, id))
  const saved = rows.find(r => r.locale === locale)
  // L'adresse de la page est celle qui est enregistrée : sans elle, il n'y a pas encore de page à afficher.
  if (def.kind === 'collection' && def.path?.includes('[slug]') && !saved?.slug)
    throw createError({ statusCode: 409, message: 'Cette page n\'a pas encore d\'adresse dans cette langue : enregistrez le contenu une première fois.', data: { code: 'not-saved' } })

  // Même mise en forme qu'à l'enregistrement (`writeDoc`) : seuls les champs de la configuration, HTML nettoyé,
  // galeries sous leur forme enregistrée, interrupteurs à leur valeur par défaut.
  const parts = partition(def.fields as Fields)
  const system = def.seo ? ['seo'] : []
  const prepare = (fields: Fields, given: unknown, stored: Values | undefined) => {
    const values = applyDefaults(fields, normalizeValues(fields, sanitizeRichText(fields, pick(fields, structuredClone((given ?? stored ?? {}) as Values), system))))
    // Champs réservés : qui ne peut pas les modifier voit la valeur enregistrée, quoi qu'envoie le formulaire.
    if (!canEditRestricted(user)) {
      for (const [key, field] of Object.entries(fields)) {
        if (!field.restricted) continue
        if (stored?.[key] === undefined) delete values[key]
        else values[key] = stored[key]
      }
    }
    return values
  }
  const shared = prepare(parts.shared, body.shared, existing.sharedDraft)
  const values = prepare(parts.localized, body.values, saved?.draft)

  const now = new Date()
  const row = { ...(saved ?? { entryId: id, locale, type, slug: null, status: 'draft' as const, published: null, updatedAt: now, publishedAt: null, version: 0 }), draft: values }
  const base = (cmsConfig.site.url ?? getRequestURL(event).origin).replace(/\/$/, '')
  const entry = toPublicEntry(def, { ...existing, sharedDraft: shared }, row, [...rows.filter(r => r.locale !== locale), row], true, base)
  await resolveRefs(event, locale, [
    { fields: def.fields as Fields, values: entry },
    ...(entry.seo ? [{ fields: { image: { type: 'image' as const, label: '' } }, values: entry.seo as Values }] : []),
  ], true)
  return { entry }
})
