import { FilterXSS } from 'xss'
import type { AnyField } from '../../shared/format'

// Seules les balises produites par l'éditeur sont conservées ; scripts, styles et attributs d'événement sont retirés.
const filter = new FilterXSS({
  whiteList: { p: [], br: [], strong: [], em: [], h2: [], h3: [], ul: [], ol: [], li: [], blockquote: [], a: ['href', 'target', 'rel'] },
  stripIgnoreTag: true,
  stripIgnoreTagBody: ['script', 'style'],
})

/** Nettoie le HTML des champs de texte mis en forme, y compris dans les répéteurs. Modifie `values`. */
export function sanitizeRichText(fields: Record<string, AnyField>, values: Record<string, unknown>) {
  for (const [key, field] of Object.entries(fields)) {
    const v = values[key]
    if (field.type === 'richText' && typeof v === 'string') values[key] = filter.process(v)
    else if (field.type === 'repeater' && Array.isArray(v))
      for (const item of v) sanitizeRichText(field.fields as Record<string, AnyField>, item as Record<string, unknown>)
  }
  return values
}
