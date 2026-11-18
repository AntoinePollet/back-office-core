import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import type { H3Event } from 'h3'
import type { LinkValue } from '../../shared/content'
import type { AnyField } from '../../shared/format'

type Fields = Record<string, AnyField>
type Values = Record<string, unknown>

/** D1 limite le nombre de paramètres par requête : on interroge par paquets. */
async function byChunks<T>(ids: string[], query: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += 80) out.push(...await query(ids.slice(i, i + 80)))
  return out
}

function walk(fields: Fields, values: Values, visit: (field: AnyField, values: Values, key: string) => void) {
  for (const [key, field] of Object.entries(fields)) {
    if (field.type === 'repeater') for (const item of (values[key] as Values[] | null) ?? []) walk(field.fields as Fields, item, visit)
    else visit(field, values, key)
  }
}

/**
 * Remplace, dans des contenus destinés au site, les références par leur contenu :
 * image et fichier → Media, relation → EntryRef, lien → { label, href, newTab }.
 * Une référence vers un contenu supprimé ou non publié dans cette langue devient null (ou disparaît d'une liste).
 */
export async function resolveRefs(event: H3Event, locale: string, jobs: { fields: Fields; values: Values }[], preview = false) {
  const mediaIds = new Set<string>()
  const entryIds = new Set<string>()
  for (const job of jobs) {
    walk(job.fields, job.values, (field, values, key) => {
      const v = values[key]
      if ((field.type === 'image' || field.type === 'file') && typeof v === 'string') mediaIds.add(v)
      else if (field.type === 'relation') {
        for (const id of [v].flat()) if (typeof id === 'string') entryIds.add(id)
      }
      else if (field.type === 'link' && (v as LinkValue | null)?.kind === 'page') entryIds.add((v as { id: string }).id)
    })
  }
  if (!mediaIds.size && !entryIds.size) return

  const db = useDb(event)
  const { media, entries, entryLocales } = schema
  const [mediaRows, entryRows, localeRows] = await Promise.all([
    byChunks([...mediaIds], ids => db.select().from(media).where(inArray(media.id, ids))),
    byChunks([...entryIds], ids => db.select().from(entries).where(inArray(entries.id, ids))),
    byChunks([...entryIds], ids => db.select().from(entryLocales).where(and(inArray(entryLocales.entryId, ids), eq(entryLocales.locale, locale), preview ? undefined : isNotNull(entryLocales.published)))),
  ])
  const mediaById = new Map(mediaRows.map(r => [r.id, toPublicMedia(r, locale)]))
  const entryById = new Map(entryRows.map(r => [r.id, r]))
  const localeById = new Map(localeRows.map(r => [r.entryId, r]))

  const target = (id: string) => {
    const row = localeById.get(id)
    const entry = entryById.get(id)
    if (!row || !entry) return null
    const def = getDef(row.type)
    const merged = (preview ? { ...entry.sharedDraft, ...row.draft } : { ...entry.sharedPublished, ...row.published }) as Values
    const title = def.kind === 'collection' ? String(merged[def.titleField] ?? '') : def.label
    const href = publicPath(def, locale, row.slug)
    return { ref: { id, collection: row.type, title, slug: row.slug }, href }
  }

  for (const job of jobs) {
    walk(job.fields, job.values, (field, values, key) => {
      const v = values[key]
      if (field.type === 'image' || field.type === 'file') values[key] = typeof v === 'string' ? mediaById.get(v) ?? null : null
      else if (field.type === 'relation') {
        const refs = [v].flat().flatMap(id => (typeof id === 'string' ? target(id)?.ref ?? [] : []))
        values[key] = field.multiple ? refs : refs[0] ?? null
      }
      else if (field.type === 'link') {
        const link = v as LinkValue | null
        if (link?.kind === 'url') values[key] = { label: link.label || link.url, href: link.url, newTab: !!link.newTab }
        else if (link?.kind === 'page') {
          const page = target(link.id)
          values[key] = page?.href ? { label: link.label || page.ref.title, href: page.href, newTab: !!link.newTab } : null
        }
        else values[key] = null
      }
    })
  }
}
