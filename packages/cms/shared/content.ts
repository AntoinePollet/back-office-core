import { type AnyField, isVisible } from './format'

type Fields = Record<string, AnyField>
type Values = Record<string, unknown>

export const slugify = (text: string) =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** Nombre de versions gardées par contenu dans l'historique ; les plus anciennes sont supprimées. */
export const MAX_REVISIONS = 30

/** Vide : null, texte vide, liste vide, ou objet dont toutes les valeurs sont vides (ex. un bloc SEO non rempli). */
export const isEmpty = (v: unknown): boolean =>
  v == null || v === '' || (Array.isArray(v) ? v.length === 0 : typeof v === 'object' && Object.values(v as object).every(isEmpty))

/**
 * Valeur enregistrée d'un champ lien. `label` vide : le site affiche le titre de la page ou l'adresse.
 * Une page est désignée par son type et son identifiant (pour un singleton, les deux sont égaux).
 */
export type LinkValue = { label?: string; newTab?: boolean } & (
  | { kind: 'page'; type: string; id: string }
  | { kind: 'url'; url: string }
)

/**
 * Élément enregistré d'une liste d'images ou de fichiers (`multiple: true`) : l'identifiant du fichier dans la
 * médiathèque, et sa légende pour cet usage.
 */
export type MediaItem = { media: string; caption?: string }

/** Clés possibles d'un élément de liste d'images ou de fichiers. */
export const MEDIA_ITEM_KEYS = ['media', 'caption']

/** Vrai pour un champ image ou fichier qui contient une liste (galerie). */
export const isMediaList = (field: { type: string; multiple?: unknown }) => (field.type === 'image' || field.type === 'file') && !!field.multiple

/**
 * Met une liste d'images ou de fichiers sous sa forme enregistrée : `'id'` devient `{ media: 'id' }`, une légende vide
 * disparaît. Une valeur seule (champ qui vient de devenir multiple) devient une liste d'un élément.
 * Ce qui n'a pas la forme attendue est laissé tel quel : la validation le signale.
 */
export function toMediaItems(v: unknown): unknown {
  if (v == null || v === '') return []
  const list = Array.isArray(v) ? v : [v]
  return list.map((item) => {
    if (typeof item === 'string') return { media: item }
    if (item && typeof item === 'object' && !Array.isArray(item) && 'caption' in item && (item.caption == null || (typeof item.caption === 'string' && !item.caption.trim()))) {
      const { caption: _c, ...rest } = item as Record<string, unknown>
      return rest
    }
    return item
  })
}

/** Met les listes d'images ou de fichiers sous leur forme enregistrée, y compris dans les répéteurs. Modifie `values`. */
export function normalizeValues(fields: Fields, values: Values): Values {
  for (const [key, field] of Object.entries(fields)) {
    const v = values[key]
    if (isMediaList(field) && v !== undefined) values[key] = toMediaItems(v)
    else if (field.type === 'repeater' && Array.isArray(v))
      for (const item of v) if (item && typeof item === 'object') normalizeValues(field.fields as Fields, item as Values)
  }
  return values
}

/** Sépare les champs traduits des champs communs aux langues. */
export function partition(fields: Fields) {
  const localized: Fields = {}
  const shared: Fields = {}
  for (const [key, field] of Object.entries(fields)) (field.localized ? localized : shared)[key] = field
  return { localized, shared }
}

/** Ne garde que les clés connues du format. `extra` : clés système autorisées (ex. 'seo'). */
export function pick(fields: Fields, values: Values | undefined, extra: string[] = []): Values {
  const out: Values = {}
  for (const key of [...Object.keys(fields), ...extra]) if (values?.[key] !== undefined) out[key] = values[key]
  return out
}

/** Donne leur valeur par défaut aux interrupteurs jamais touchés, y compris dans les répéteurs. Modifie `values`. */
export function applyDefaults(fields: Fields, values: Values): Values {
  for (const [key, field] of Object.entries(fields)) {
    if (field.type === 'boolean') values[key] ??= field.default ?? false
    else if (field.type === 'repeater' && Array.isArray(values[key]))
      for (const item of values[key] as Values[]) applyDefaults(field.fields as Fields, item)
  }
  return values
}

/**
 * Valeurs d'une copie de contenu : les mêmes, avec « (copie) » ajouté au titre (dans chaque langue si le titre est traduit).
 * Le titre est raccourci au besoin pour respecter la longueur maximale du champ.
 */
export function copyValues(def: { kind: string; titleField?: string; fields: Fields }, shared: Values, locales: Record<string, Values>) {
  const out = JSON.parse(JSON.stringify({ shared, locales })) as { shared: Values; locales: Record<string, Values> }
  const field = def.titleField ? def.fields[def.titleField] : undefined
  if (!field || !def.titleField) return out
  const suffix = ' (copie)'
  const max = typeof field.max === 'number' ? field.max : undefined
  for (const target of field.localized ? Object.values(out.locales) : [out.shared]) {
    const title = String(target[def.titleField] ?? '').trim()
    if (title) target[def.titleField] = (max != null ? title.slice(0, Math.max(0, max - suffix.length)).trimEnd() : title) + suffix
  }
  return out
}

/**
 * Valide les valeurs d'un formulaire. Renvoie { nomDuChamp: message }.
 * Un champ masqué par `showIf` n'est jamais validé.
 */
export function validateValues(fields: Fields, values: Values, prefix = ''): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const [key, field] of Object.entries(fields)) {
    if (!isVisible(field, values)) continue
    const at = prefix + key
    const v = values[key]

    if (isEmpty(v)) {
      if (field.required) errors[at] = 'Ce champ est obligatoire.'
      continue
    }
    const min = field.min as number | undefined
    const max = field.max as number | undefined

    if (field.type === 'text' || field.type === 'textarea') {
      if (typeof v !== 'string') errors[at] = 'Texte attendu.'
      else if (max != null && v.length > max) errors[at] = `${max} caractères au maximum.`
      else if (min != null && v.length < min) errors[at] = `${min} caractères au minimum.`
      else if (field.format === 'email' && !/^\S+@\S+\.\S+$/.test(v)) errors[at] = 'Adresse e-mail invalide.'
      else if (field.format === 'url' && !/^https?:\/\/\S+$/.test(v)) errors[at] = 'L\'adresse doit commencer par http:// ou https://.'
    }
    else if (field.type === 'number') {
      if (typeof v !== 'number' || Number.isNaN(v)) errors[at] = 'Nombre attendu.'
      else if (field.integer && !Number.isInteger(v)) errors[at] = 'Nombre entier attendu.'
      else if (max != null && v > max) errors[at] = `${max} au maximum.`
      else if (min != null && v < min) errors[at] = `${min} au minimum.`
    }
    else if (field.type === 'select') {
      const allowed = (field.options as { value: string }[]).map(o => o.value)
      const chosen = Array.isArray(v) ? v : [v]
      if (!chosen.every(c => allowed.includes(c as string))) errors[at] = 'Choix inconnu.'
    }
    else if (isMediaList(field)) {
      const items = Array.isArray(v) ? v : null
      const valid = (item: unknown) => !!item && typeof item === 'object' && !Array.isArray(item)
        && typeof (item as MediaItem).media === 'string' && (item as MediaItem).media !== ''
        && ((item as MediaItem).caption == null || typeof (item as MediaItem).caption === 'string')
        && Object.keys(item).every(k => MEDIA_ITEM_KEYS.includes(k))
      const noun = field.type === 'image' ? 'images' : 'fichiers'
      if (!items || !items.every(valid)) errors[at] = 'Liste de fichiers invalide.'
      else if (max != null && items.length > max) errors[at] = `${max} ${noun} au maximum.`
      else if (min != null && items.length < min) errors[at] = `${min} ${noun} au minimum.`
    }
    else if (field.type === 'image' || field.type === 'file') {
      if (typeof v !== 'string') errors[at] = 'Fichier invalide.'
    }
    else if (field.type === 'relation') {
      const ids = field.multiple ? v : [v]
      if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string')) errors[at] = 'Sélection invalide.'
    }
    else if (field.type === 'link') {
      const link = v as Partial<LinkValue> & Record<string, unknown>
      if (link.kind === 'url' ? !/^(https?:\/\/|mailto:|tel:|\/)\S+$/.test(String(link.url ?? '')) : !(link.kind === 'page' && link.type && link.id))
        errors[at] = link.kind === 'url' ? 'L\'adresse doit commencer par https://, mailto:, tel: ou /.' : 'Choisissez une page.'
    }
    else if (field.type === 'repeater') {
      if (!Array.isArray(v)) { errors[at] = 'Liste attendue.'; continue }
      if (max != null && v.length > max) errors[at] = `${max} éléments au maximum.`
      else if (min != null && v.length < min) errors[at] = `${min} éléments au minimum.`
      v.forEach((item, i) => Object.assign(errors, validateValues(field.fields as Fields, item as Values, `${at}.${i}.`)))
    }
  }
  return errors
}

/** Un texte mis en forme sans aucun texte (« <p></p> », « <p><br></p> ») est vide. */
const isBlankHtml = (html: string) => html.replace(/<[^>]*>/g, '').replace(/&nbsp;|\s/g, '') === ''

/**
 * Valeur d'un champ telle que le site la reçoit, avant le remplacement des références (`server/utils/resolve.ts`).
 * Un champ vide a une seule forme par type, quelle que soit l'histoire du contenu (jamais rempli, vidé dans le
 * formulaire, importé, champ ajouté après coup) : voir le tableau dans `format.ts`, au-dessus de `InferEntry`.
 */
function toPublicValue(field: AnyField, v: unknown): unknown {
  switch (field.type) {
    case 'boolean':
      return typeof v === 'boolean' ? v : field.default ?? false
    case 'repeater':
      return Array.isArray(v) ? v.filter(item => item && typeof item === 'object').map(item => toPublicValues(field.fields as Fields, item as Values)) : []
    case 'text': case 'textarea': case 'date':
      return typeof v === 'string' && v !== '' ? v : null
    case 'richText':
      return typeof v === 'string' && !isBlankHtml(v) ? v : null
    case 'number':
      return typeof v === 'number' && !Number.isNaN(v) ? v : null
    case 'select':
      if (field.multiple) return (Array.isArray(v) ? v : v == null ? [] : [v]).filter(c => typeof c === 'string' && c !== '')
      return typeof v === 'string' && v !== '' ? v : null
    case 'image': case 'file':
      if (field.multiple) {
        // Forme enregistrée, sans élément invalide ; la légende n'est transmise que si le champ en a.
        return (toMediaItems(v) as unknown[]).flatMap((item) => {
          const { media, caption } = (item ?? {}) as Partial<MediaItem>
          if (typeof media !== 'string' || !media) return []
          return [field.captions ? { media, caption: typeof caption === 'string' && caption.trim() ? caption : null } : { media }]
        })
      }
      return typeof v === 'string' && v !== '' ? v : null
    case 'relation':
      if (field.multiple) return (Array.isArray(v) ? v : v == null ? [] : [v]).filter(id => typeof id === 'string' && id !== '')
      return typeof v === 'string' && v !== '' ? v : null
    case 'link': {
      const link = v as Partial<LinkValue> & { url?: unknown; id?: unknown } | null
      return link && typeof link === 'object' && ((link.kind === 'url' && typeof link.url === 'string' && link.url !== '') || (link.kind === 'page' && typeof link.id === 'string' && link.id !== '')) ? v : null
    }
  }
}

/** Prépare les valeurs pour le site : champs masqués vidés, et une seule forme de « vide » par type de champ. */
export function toPublicValues(fields: Fields, values: Values): Values {
  const out: Values = {}
  for (const [key, field] of Object.entries(fields)) out[key] = toPublicValue(field, isVisible(field, values) ? values[key] : undefined)
  return out
}
