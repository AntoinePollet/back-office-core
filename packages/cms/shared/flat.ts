/**
 * Rangement des valeurs à l'enregistrement : quelles valeurs vont dans la partie commune aux langues,
 * lesquelles dans la partie traduite, et lesquelles n'ont leur place nulle part.
 * Fonctions pures, utilisées par le serveur (`server/utils/entries.ts`) et par l'outil d'import (`cli/`).
 */
import { partition } from './content'
import type { AnyField } from './format'
import { KEPT_KEY } from './migrate'

type Fields = Record<string, AnyField>
type Values = Record<string, unknown>

/** Dans le bloc `seo` : ce qui est commun aux langues, et ce qui se traduit. */
const SEO_SHARED = ['image', 'noindex']
const SEO_LOCALIZED = ['title', 'description']

const isObject = (v: unknown): v is Values => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Range des valeurs données « à plat » (par nom de champ, sans se soucier de ce qui est traduit).
 * - `shared` : champs communs aux langues ; `localized` : champs traduits ;
 * - `seo` (si le contenu a l'onglet Référencement) : `title` et `description` sont traduits, `image` et `noindex` communs ;
 * - `unknown` : noms qui ne correspondent à aucun champ, y compris dans un répéteur (`faq.0.reponse`).
 */
export function splitFlat(fields: Fields, values: Values, seo = false) {
  const parts = partition(fields)
  const shared: Values = {}
  const localized: Values = {}
  const unknown: string[] = []
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue
    if (key === 'seo' && seo) {
      if (!isObject(value)) { unknown.push('seo'); continue }
      for (const [k, v] of Object.entries(value)) {
        if (SEO_SHARED.includes(k)) shared.seo = { ...(shared.seo as Values), [k]: v }
        else if (SEO_LOCALIZED.includes(k)) localized.seo = { ...(localized.seo as Values), [k]: v }
        else unknown.push(`seo.${k}`)
      }
      continue
    }
    const field = fields[key]
    if (!field) { unknown.push(key); continue }
    if (field.type === 'repeater' && Array.isArray(value)) {
      const sub = field.fields as Fields
      value.forEach((item, i) => {
        if (isObject(item)) for (const k of Object.keys(item)) if (!(k in sub) && k !== KEPT_KEY) unknown.push(`${key}.${i}.${k}`)
      })
    }
    ;(key in parts.shared ? shared : localized)[key] = value
  }
  return { shared, localized, unknown }
}

/** Fusionne des valeurs nouvelles dans des valeurs existantes ; le bloc `seo` est fusionné clé par clé. */
export function mergeValues(base: Values, extra: Values): Values {
  const out = { ...base, ...extra }
  if (isObject(extra.seo)) out.seo = { ...(isObject(base.seo) ? base.seo : {}), ...extra.seo }
  return out
}

export type Stray = { key: string; reason: 'unknown' | 'localized' | 'shared' }

/**
 * Clés envoyées dans une partie (`shared` ou les valeurs d'une langue) où elles n'ont pas leur place :
 * nom inconnu, champ traduit dans `shared`, ou champ commun dans une langue.
 *
 * Ne sont pas signalées, parce que ce ne sont pas des erreurs de l'appelant :
 * - `system` : les clés gérées par le système (`seo`) ;
 * - `_kept` : les valeurs mises de côté par une migration ;
 * - les clés que cette partie contient déjà en base (`stored`) : valeurs d'un champ retiré de la configuration,
 *   ou pas encore déplacées par une migration. Le formulaire les renvoie telles qu'il les a lues ;
 *   elles ne sont ni modifiées ni perdues.
 */
export function strayKeys(part: 'shared' | 'localized', fields: Fields, sent: Values | undefined, stored: Values | null | undefined, system: string[] = []): Stray[] {
  const parts = partition(fields)
  const out: Stray[] = []
  for (const key of Object.keys(sent ?? {})) {
    if (sent![key] === undefined || key in parts[part] || system.includes(key) || key === KEPT_KEY) continue
    if (stored && key in stored) continue
    out.push({ key, reason: !(key in fields) ? 'unknown' : part === 'shared' ? 'localized' : 'shared' })
  }
  return out
}

/** Message d'erreur pour une valeur mal rangée. `locale` : la langue où elle a été envoyée, s'il y en a une. */
export function strayMessage(stray: Stray, label: string, locale?: string): string {
  if (stray.reason === 'unknown') return `« ${stray.key} » n'est pas un champ de « ${label} ».`
  if (stray.reason === 'localized') return `« ${stray.key} » est un champ traduit : sa valeur se donne dans locales.<langue>.values, pas dans shared (ou bien à plat, dans values).`
  return `« ${stray.key} » est commun à toutes les langues : sa valeur se donne dans shared, pas dans locales.${locale ?? '<langue>'}.values (ou bien à plat, dans values).`
}
