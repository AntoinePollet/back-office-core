/**
 * Import de contenus : lecture du fichier d'import et préparation des envois.
 *
 * Tout ce fichier est fait de fonctions pures (aucun accès au disque ni au réseau) : il vérifie le fichier par rapport
 * à `cms.config.ts` et le traduit en demandes pour l'API du back-office. L'exécution est dans `import.ts`.
 *
 * ## Le fichier d'import
 *
 * ```json
 * {
 *   "status": "published",
 *   "singletons": { "contact": { "email": "contact@exemple.fr", "phone": "" } },
 *   "collections": {
 *     "categories": [{ "id": "entreprises", "name": "Entreprises", "en": { "name": "Companies" } }],
 *     "services": [{
 *       "id": "droit-des-affaires",
 *       "title": "Droit des affaires",
 *       "cover": { "file": "/photos/affaires.jpg", "alt": "Une salle de réunion" },
 *       "category": "entreprises",
 *       "en": { "title": "Business law" }
 *     }]
 *   }
 * }
 * ```
 *
 * - Un élément donne ses valeurs par nom de champ, dans la langue par défaut. L'outil sait, d'après la configuration,
 *   lesquelles sont traduites. Une autre langue s'écrit dans un bloc à son code (`"en": { … }`), avec les seuls champs traduits.
 * - `id` (collections, obligatoire) : un nom au choix, stable, unique dans la collection. Il sert à retrouver l'élément
 *   quand on relance l'import (il est alors mis à jour, pas recréé) et à le désigner dans un champ relation ou lien.
 * - `slug`, `seo`, `status` (`"published"` ou `"draft"`) : adresse de la page, référencement, publication.
 * - Image ou fichier : un chemin (`"/photos/a.jpg"` : dans `public/` ; `"photos/a.jpg"` : à côté du fichier d'import),
 *   ou `{ "file": "…", "alt": "…", "folder": "Chantiers/Isolation", "focus": { "x": 0.3, "y": 0.2 } }` ; `focus` est le point
 *   d'intérêt de l'image (où se trouve le sujet : 0 à 1 depuis la gauche et le haut) ; `alt` peut être un objet par langue ; `folder` range
 *   le fichier dans ce dossier de la médiathèque (« / » sépare les niveaux ; les dossiers manquants sont créés).
 * - Galerie (image ou fichier avec `multiple`) : une liste, dans l'ordre d'affichage, de chemins ou d'objets
 *   `{ "file": "…", "alt": "…", "caption": "Marseille (13)" }` (`caption` si le champ a `captions: true`).
 * - Relation : l'`id` d'un élément de la collection visée, présent dans le même fichier (un tableau si le champ est multiple).
 * - Lien : une adresse (`"https://…"`, `"/contact"`, `"mailto:…"`), ou `{ "url": "…", "label": "…", "newTab": true }`,
 *   ou une page du site : `{ "page": "services", "id": "droit-des-affaires" }` (`{ "page": "home" }` pour une page unique).
 * - Répéteur : un tableau d'objets. Texte mis en forme : du HTML. Date : `"2026-11-17"` (ou `"2026-11-17T09:30"`).
 * - `null` ou `""` vide un champ. Un champ absent du fichier n'est pas touché.
 * - `redirections` (à la racine, facultatif) : les anciennes adresses d'un précédent site, une liste de
 *   `{ "from": "/ancienne-page.html", "to": "/contact" }`. `to` est une adresse (`"/…"` ou `"https://…"`) ou une page du
 *   site, comme pour un lien : `{ "page": "services", "id": "droit-des-affaires" }` (et `"locale": "en"` pour une autre
 *   langue). `"status": 302` pour une redirection provisoire (301, définitive, par défaut). Une redirection déjà
 *   présente pour la même ancienne adresse est mise à jour.
 */
import { createHash } from 'node:crypto'
import { isAbsolute, join, resolve } from 'node:path'
import { isEmpty, partition } from '../shared/content'
import { isFocusInput } from '../shared/media'
import { parseFolderPath } from '../shared/media-folders'
import { type RedirectTarget, normalizeSource, normalizeUrlTarget } from '../shared/redirects'
import { type AnyField, type CmsConfig, type CmsDefinition, isVisible } from '../shared/format'

type Fields = Record<string, AnyField>
type Values = Record<string, unknown>

export type Status = 'published' | 'draft'

/** Fichier de la médiathèque attendu à cet endroit : remplacé par son identifiant une fois le fichier lu. */
export type MediaToken = { $media: string }
export const isMediaToken = (v: unknown): v is MediaToken => !!v && typeof v === 'object' && typeof (v as MediaToken).$media === 'string'

export type PlannedEntry = {
  type: string
  kind: 'collection' | 'singleton'
  /** Clé choisie dans le fichier (`id`) ; vide pour une page unique. */
  key: string
  /** Identifiant du contenu dans le back-office : toujours le même pour une même clé. */
  id: string
  /** Nom de l'élément dans le compte rendu : « droit-des-affaires », ou le libellé de la page unique. */
  name: string
  publish: boolean
  /** Langue par défaut : valeurs à plat (champs communs et traduits). */
  locale: string
  values: Values
  slug?: string
  /** Autres langues : champs traduits seulement. */
  translations: Record<string, { values: Values; slug?: string }>
}

export type PlannedFile = {
  /** Chemin absolu du fichier sur le disque. */
  path: string
  /** Chemin tel qu'il est écrit dans le fichier d'import. */
  cited: string
  /** Le premier endroit où il est cité, pour les messages d'erreur. */
  where: string
  /** Vrai si un champ image le désigne : ce doit être une image. */
  image: boolean
  /** Texte alternatif par langue, s'il est donné. */
  alt: Record<string, string>
  /** Dossier de la médiathèque où le ranger, niveau par niveau (`"Chantiers/Isolation"` → ['Chantiers', 'Isolation']). */
  folder?: string[]
  /** Point d'intérêt de l'image, s'il est donné (`"focus": { "x": 0.3, "y": 0.2 }`). */
  focus?: { x: number; y: number }
}

/** Redirection d'une ancienne adresse (rubrique `redirections`). */
export type PlannedRedirect = { from: string; to: string | RedirectTarget; status: 301 | 302 }

export type Plan = { errors: string[]; warnings: string[]; entries: PlannedEntry[]; files: PlannedFile[]; redirects: PlannedRedirect[] }

// ───────────────────────── Identifiants stables ─────────────────────────

const asUuid = (hash: Buffer) => {
  const b = Buffer.from(hash.subarray(0, 16))
  b[6] = (b[6]! & 0x0f) | 0x50 // version 5 : identifiant dérivé d'un nom
  b[8] = (b[8]! & 0x3f) | 0x80
  const hex = b.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Identifiant d'un contenu importé, calculé à partir de sa collection et de sa clé : relancer l'import retrouve
 * donc le même contenu sans rien mémoriser, ni dans le projet ni dans la base.
 */
export const importId = (type: string, key: string) => asUuid(createHash('sha1').update(`backoffice-import:${type}:${key}`).digest())

/** Identifiant d'un fichier importé, calculé à partir de son contenu : le même fichier n'est jamais envoyé deux fois. */
export const mediaId = (content: Uint8Array) => asUuid(createHash('sha256').update(content).digest())

// ───────────────────────── Lecture du fichier ─────────────────────────

const isObject = (v: unknown): v is Values => !!v && typeof v === 'object' && !Array.isArray(v)
const kindOf = (v: unknown) =>
  v === null ? 'vide' : Array.isArray(v) ? 'une liste' : typeof v === 'string' ? 'un texte' : typeof v === 'number' ? 'un nombre'
  : typeof v === 'boolean' ? 'vrai/faux' : typeof v === 'object' ? 'un objet' : typeof v
const list = (names: string[]) => names.join(', ') || '(aucun)'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/
const URL_LINK = /^(https?:\/\/|mailto:|tel:|\/)\S+$/
const STATUSES = ['published', 'draft']

export type PlanOptions = {
  /** Dossier du fichier d'import : base des chemins relatifs. */
  baseDir: string
  /** Dossier `public/` du projet : base des chemins qui commencent par « / ». */
  publicDir: string
  /** Statut des éléments qui n'en précisent pas, si le fichier n'en donne pas non plus. Défaut : 'published'. */
  status?: Status
}

/**
 * Vérifie le fichier d'import par rapport à la configuration et prépare les envois.
 * S'il y a des erreurs, rien ne doit être envoyé : elles disent toutes où est le problème.
 */
export function planImport(config: CmsConfig, data: unknown, options: PlanOptions): Plan {
  const errors: string[] = []
  const warnings: string[] = []
  const entries: PlannedEntry[] = []
  const files = new Map<string, PlannedFile>()
  const { locales, defaultLocale } = config.site
  const others = locales.filter(l => l !== defaultLocale)
  const collections = config.collections ?? {}
  const singletons = config.singletons ?? {}

  if (!isObject(data)) return { errors: ['Le fichier d\'import doit contenir un objet : { "collections": { … }, "singletons": { … } }.'], warnings, entries, files: [], redirects: [] }
  for (const key of Object.keys(data))
    if (!['collections', 'singletons', 'status', 'redirections'].includes(key)) errors.push(`« ${key} » : clé inconnue à la racine du fichier. Clés possibles : collections, singletons, status, redirections.`)
  if (data.status !== undefined && !STATUSES.includes(data.status as string)) errors.push('status : attendu "published" ou "draft".')
  const defaultStatus: Status = STATUSES.includes(data.status as string) ? data.status as Status : options.status ?? 'published'

  // Clés déclarées dans chaque collection : un champ relation ou lien ne peut désigner que celles-là.
  const keys = new Map<string, Set<string>>()
  const lists = isObject(data.collections) ? data.collections : {}
  for (const [type, items] of Object.entries(lists))
    keys.set(type, new Set(Array.isArray(items) ? items.flatMap(item => (isObject(item) && typeof item.id === 'string' ? [item.id] : [])) : []))

  function mediaToken(value: unknown, field: AnyField, at: string, extra: string[] = []): MediaToken | null | undefined {
    const cited = typeof value === 'string' ? value : isObject(value) ? value.file : undefined
    if (typeof cited !== 'string' || !cited) {
      errors.push(`${at} : attendu le chemin d'un fichier ("/photos/a.jpg"), ou { "file": "…", "alt": "…"${extra.length ? extra.map(k => `, "${k}": "…"`).join('') : ''} } (reçu ${kindOf(value)}).`)
      return undefined
    }
    const keys = ['file', 'alt', 'folder', 'focus', ...extra]
    if (isObject(value)) for (const k of Object.keys(value)) if (!keys.includes(k)) errors.push(`${at}.${k} : clé inconnue. Clés possibles : ${list(keys)}.${k === 'caption' ? ' (Ce champ n\'a pas de légende : captions: true dans la configuration.)' : ''}`)
    // « /photos/a.jpg » se lit dans public/, comme dans une page du site ; un chemin relatif part du fichier d'import.
    const path = cited.startsWith('/') ? join(options.publicDir, cited) : isAbsolute(cited) ? cited : resolve(options.baseDir, cited)
    const alt: Record<string, string> = {}
    const given = isObject(value) ? value.alt : undefined
    if (typeof given === 'string') alt[defaultLocale] = given
    else if (isObject(given)) {
      for (const [l, text] of Object.entries(given)) {
        if (!locales.includes(l)) errors.push(`${at}.alt.${l} : langue inconnue. Langues du site : ${list([...locales])}.`)
        else if (typeof text !== 'string') errors.push(`${at}.alt.${l} : texte attendu (reçu ${kindOf(text)}).`)
        else alt[l] = text
      }
    }
    else if (given != null) errors.push(`${at}.alt : attendu un texte, ou un objet par langue { "${defaultLocale}": "…" } (reçu ${kindOf(given)}).`)
    let folder: string[] | undefined
    if (isObject(value) && value.folder != null) {
      const parsed = parseFolderPath(value.folder)
      if (parsed.error) errors.push(`${at}.folder : ${parsed.error}.`)
      else folder = parsed.names
    }
    let focus: { x: number; y: number } | undefined
    if (isObject(value) && value.focus != null) {
      if (!isFocusInput(value.focus)) errors.push(`${at}.focus : attendu le point d'intérêt de l'image, { "x": 0.3, "y": 0.2 } (deux nombres entre 0 et 1, depuis la gauche et le haut).`)
      else focus = value.focus as { x: number; y: number }
    }
    const known = files.get(path)
    if (!known) files.set(path, { path, cited, where: at, image: field.type === 'image', alt, ...(folder ? { folder } : {}), ...(focus ? { focus } : {}) })
    else {
      if (focus && !known.focus) known.focus = focus
      else if (focus && (known.focus!.x !== focus.x || known.focus!.y !== focus.y)) warnings.push(`${at} : le fichier ${cited} a déjà un autre point d'intérêt (${known.where}) ; c'est le premier qui est gardé.`)
      known.image ||= field.type === 'image'
      if (folder && !known.folder) known.folder = folder
      else if (folder && known.folder!.join('/').toLocaleLowerCase('fr') !== folder.join('/').toLocaleLowerCase('fr'))
        warnings.push(`${at} : le fichier ${cited} est déjà rangé dans un autre dossier (${known.where}) ; c'est le premier qui est gardé.`)
      for (const [l, text] of Object.entries(alt)) {
        if (known.alt[l] !== undefined && known.alt[l] !== text) warnings.push(`${at} : le fichier ${cited} a déjà un autre texte alternatif (${known.where}) ; c'est le premier qui est gardé.`)
        else known.alt[l] = text
      }
    }
    return { $media: path }
  }

  function linkValue(value: unknown, at: string): unknown {
    if (typeof value === 'string') {
      if (!URL_LINK.test(value)) errors.push(`${at} : l'adresse doit commencer par https://, mailto:, tel: ou /.`)
      return { kind: 'url', url: value }
    }
    if (!isObject(value)) { errors.push(`${at} : attendu une adresse ("https://…"), { "url": "…" } ou { "page": "…" } (reçu ${kindOf(value)}).`); return undefined }
    for (const k of Object.keys(value)) if (!['url', 'page', 'id', 'label', 'newTab'].includes(k)) errors.push(`${at}.${k} : clé inconnue. Clés possibles : url, page, id, label, newTab.`)
    if (value.label != null && typeof value.label !== 'string') errors.push(`${at}.label : texte attendu (reçu ${kindOf(value.label)}).`)
    if (value.newTab != null && typeof value.newTab !== 'boolean') errors.push(`${at}.newTab : true ou false attendu (reçu ${kindOf(value.newTab)}).`)
    const extra = { ...(typeof value.label === 'string' && value.label ? { label: value.label } : {}), ...(value.newTab === true ? { newTab: true } : {}) }
    if (typeof value.url === 'string' && value.page === undefined) {
      if (!URL_LINK.test(value.url)) errors.push(`${at}.url : l'adresse doit commencer par https://, mailto:, tel: ou /.`)
      return { kind: 'url', url: value.url, ...extra }
    }
    if (typeof value.page === 'string' && value.url === undefined) {
      const type = value.page
      if (singletons[type]) {
        if (value.id !== undefined) errors.push(`${at}.id : « ${type} » est une page unique, elle n'a pas d'id.`)
        return { kind: 'page', type, id: type, ...extra }
      }
      if (!collections[type]) { errors.push(`${at}.page : « ${type} » n'est ni une collection ni une page unique. Possibles : ${list([...Object.keys(singletons), ...Object.keys(collections)])}.`); return undefined }
      if (typeof value.id !== 'string') { errors.push(`${at}.id : indiquez l'id de l'élément de « ${type} » visé.`); return undefined }
      if (!keys.get(type)?.has(value.id)) errors.push(`${at}.id : aucun élément « ${value.id} » dans collections.${type} de ce fichier.`)
      return { kind: 'page', type, id: importId(type, value.id), ...extra }
    }
    errors.push(`${at} : indiquez soit "url", soit "page".`)
    return undefined
  }

  /** Traduit la valeur d'un champ du fichier vers la forme enregistrée. `undefined` : valeur refusée (l'erreur est notée). */
  function convert(field: AnyField, value: unknown, at: string): unknown {
    if (value === null) return null
    const wrong = (expected: string) => { errors.push(`${at} : ${expected} (reçu ${kindOf(value)}).`); return undefined }
    switch (field.type) {
      case 'text': case 'textarea': case 'richText': {
        if (typeof value !== 'string') return wrong('texte attendu')
        const max = field.max as number | undefined
        const min = field.min as number | undefined
        if (field.type !== 'richText' && value) {
          if (max != null && value.length > max) errors.push(`${at} : ${max} caractères au maximum (${value.length} ici).`)
          else if (min != null && value.length < min) errors.push(`${at} : ${min} caractères au minimum (${value.length} ici).`)
          else if (field.format === 'email' && !/^\S+@\S+\.\S+$/.test(value)) errors.push(`${at} : adresse e-mail invalide.`)
          else if (field.format === 'url' && !/^https?:\/\/\S+$/.test(value)) errors.push(`${at} : l'adresse doit commencer par http:// ou https://.`)
        }
        return value
      }
      case 'number': {
        if (typeof value !== 'number' || !Number.isFinite(value)) return wrong('nombre attendu')
        const max = field.max as number | undefined
        const min = field.min as number | undefined
        if (field.integer && !Number.isInteger(value)) errors.push(`${at} : nombre entier attendu.`)
        else if (max != null && value > max) errors.push(`${at} : ${max} au maximum.`)
        else if (min != null && value < min) errors.push(`${at} : ${min} au minimum.`)
        return value
      }
      case 'boolean':
        return typeof value === 'boolean' ? value : wrong('true ou false attendu')
      case 'date': {
        if (typeof value !== 'string') return wrong(field.time ? 'date et heure attendues, comme "2026-11-17T09:30"' : 'date attendue, comme "2026-11-17"')
        if (value === '') return ''
        const ok = (field.time ? DATE_TIME : DATE).test(value) && !Number.isNaN(new Date(value).getTime())
        if (!ok) errors.push(`${at} : ${field.time ? 'date et heure attendues, comme "2026-11-17T09:30"' : 'date attendue, comme "2026-11-17"'} (reçu "${value}").`)
        return value
      }
      case 'select': {
        const allowed = (field.options as { value: string }[]).map(o => o.value)
        const check = (v: unknown, where: string) => {
          if (typeof v !== 'string' || !allowed.includes(v)) errors.push(`${where} : choix inconnu ${JSON.stringify(v)}. Choix possibles : ${list(allowed)}.`)
        }
        if (field.multiple) {
          if (!Array.isArray(value)) return wrong('liste de choix attendue (ce champ accepte plusieurs choix)')
          value.forEach((v, i) => check(v, `${at}[${i}]`))
          return value
        }
        if (Array.isArray(value)) return wrong('un seul choix attendu')
        if (value !== '') check(value, at)
        return value
      }
      case 'image': case 'file': {
        if (!field.multiple) {
          if (Array.isArray(value)) return wrong('un seul fichier attendu (ce champ n\'est pas une galerie)')
          return value === '' ? null : mediaToken(value, field, at)
        }
        if (value === '') return []
        if (!Array.isArray(value)) return wrong(`liste de fichiers attendue, dans l'ordre d'affichage : ["/photos/a.jpg", { "file": "…", "alt": "…"${field.captions ? ', "caption": "…"' : ''} }]`)
        const max = field.max as number | undefined
        const min = field.min as number | undefined
        if (max != null && value.length > max) errors.push(`${at} : ${max} fichiers au maximum (${value.length} ici).`)
        else if (min != null && value.length && value.length < min) errors.push(`${at} : ${min} fichiers au minimum (${value.length} ici).`)
        return value.map((v, i) => {
          const where = `${at}[${i}]`
          const media = mediaToken(v, field, where, field.captions ? ['caption'] : [])
          const caption = isObject(v) ? v.caption : undefined
          if (caption != null && typeof caption !== 'string') errors.push(`${where}.caption : texte attendu (reçu ${kindOf(caption)}).`)
          return { media, ...(typeof caption === 'string' && caption.trim() ? { caption } : {}) }
        })
      }
      case 'link':
        return value === '' ? null : linkValue(value, at)
      case 'relation': {
        const to = field.to as string
        const one = (v: unknown, where: string) => {
          if (typeof v !== 'string') { errors.push(`${where} : attendu l'id d'un élément de « ${to} » (reçu ${kindOf(v)}).`); return undefined }
          if (!keys.get(to)?.has(v)) errors.push(`${where} : aucun élément « ${v} » dans collections.${to} de ce fichier.`)
          return importId(to, v)
        }
        if (field.multiple) {
          if (!Array.isArray(value)) return wrong(`liste d'id d'éléments de « ${to} » attendue`)
          return value.map((v, i) => one(v, `${at}[${i}]`))
        }
        if (Array.isArray(value)) return wrong(`un seul id d'élément de « ${to} » attendu`)
        return value === '' ? null : one(value, at)
      }
      case 'repeater': {
        if (!Array.isArray(value)) return wrong('liste attendue')
        const sub = field.fields as Fields
        const max = field.max as number | undefined
        const min = field.min as number | undefined
        if (max != null && value.length > max) errors.push(`${at} : ${max} éléments au maximum (${value.length} ici).`)
        else if (min != null && value.length < min) errors.push(`${at} : ${min} éléments au minimum (${value.length} ici).`)
        return value.map((item, i) => {
          const where = `${at}[${i}]`
          if (!isObject(item)) { errors.push(`${where} : objet attendu (reçu ${kindOf(item)}).`); return {} }
          const out: Values = {}
          for (const [k, v] of Object.entries(item)) {
            if (!sub[k]) errors.push(`${where}.${k} : champ inconnu. Champs possibles : ${list(Object.keys(sub))}.`)
            else out[k] = convert(sub[k], v, `${where}.${k}`)
          }
          // Un élément de liste est donné en entier : ses champs obligatoires peuvent être vérifiés ici.
          for (const [k, f] of Object.entries(sub))
            if (f.required && isVisible(f, out) && isEmpty(out[k]) && !(k in item && out[k] === undefined)) errors.push(`${where}.${k} : champ obligatoire.`)
          return out
        })
      }
    }
  }

  function seoValues(value: unknown, at: string, translated: boolean): Values | undefined {
    if (!isObject(value)) { errors.push(`${at} : objet attendu, comme { "title": "…", "description": "…" } (reçu ${kindOf(value)}).`); return undefined }
    const out: Values = {}
    const texts = ['title', 'description', 'shareTitle', 'shareDescription']
    const allowed = translated ? texts : [...texts, 'image', 'noindex']
    for (const [k, v] of Object.entries(value)) {
      const where = `${at}.${k}`
      if (!allowed.includes(k)) errors.push(['image', 'noindex'].includes(k) ? `${where} : commun à toutes les langues, à écrire dans le seo de l'élément.` : `${where} : clé inconnue. Clés possibles : ${list(allowed)}.`)
      else if (k === 'image') out.image = v === null || v === '' ? null : mediaToken(v, { type: 'image', label: '' }, where)
      else if (k === 'noindex') { if (typeof v === 'boolean') out.noindex = v; else errors.push(`${where} : true ou false attendu (reçu ${kindOf(v)}).`) }
      else if (v === null || typeof v === 'string') out[k] = v ?? ''
      else errors.push(`${where} : texte attendu (reçu ${kindOf(v)}).`)
    }
    return out
  }

  function planEntry(type: string, def: CmsDefinition, item: Values, at: string, key: string) {
    const fields = def.fields as Fields
    const parts = partition(fields)
    const hasSlug = def.kind === 'collection' && !!def.path?.includes('[slug]')
    const before = errors.length
    const clash = others.filter(l => l in fields)
    if (clash.length) errors.push(`${at} : le champ « ${clash[0]} » de « ${type} » porte le nom d'une langue du site ; l'import ne sait pas le distinguer d'une traduction.`)

    const entry: PlannedEntry = {
      type, kind: def.kind, key, id: def.kind === 'singleton' ? type : importId(type, key), name: def.kind === 'singleton' ? def.label : key,
      publish: defaultStatus === 'published', locale: defaultLocale, values: {}, translations: {},
    }
    const slug = (value: unknown, where: string) => {
      if (!hasSlug) errors.push(`${where} : « ${type} » n'a pas d'adresse de page (pas de path avec [slug] dans la configuration).`)
      else if (typeof value !== 'string' || !value) errors.push(`${where} : texte attendu (reçu ${kindOf(value)}).`)
      else return value
    }
    /** Lit les valeurs d'une langue. `only` : les champs acceptés (tous pour la langue par défaut, les champs traduits ailleurs). */
    const read = (source: Values, where: string, locale: string): { values: Values; slug?: string } => {
      const main = locale === defaultLocale
      const out: { values: Values; slug?: string } = { values: {} }
      for (const [k, v] of Object.entries(source)) {
        const here = `${where}.${k}`
        if (v === undefined) continue
        if (main && k === 'id' && def.kind === 'collection') continue
        if (main && k === 'status') {
          if (!STATUSES.includes(v as string)) errors.push(`${here} : attendu "published" ou "draft".`)
          else entry.publish = v === 'published'
        }
        else if (k === 'slug') out.slug = slug(v, here)
        else if (k === 'seo') {
          if (!def.seo) errors.push(`${here} : « ${type} » n'a pas l'onglet Référencement (seo: true dans la configuration).`)
          else { const seo = seoValues(v, here, !main); if (seo) out.values.seo = seo }
        }
        else if (locales.includes(k) && !(k in fields)) {
          if (!main) errors.push(`${here} : une traduction ne contient pas d'autre traduction.`)
          // La langue par défaut peut aussi s'écrire dans son propre bloc ; les autres sont lues plus bas.
          else if (k === defaultLocale) {
            if (!isObject(v)) errors.push(`${here} : objet attendu (reçu ${kindOf(v)}).`)
            else {
              const own = read(v, here, defaultLocale)
              for (const name of Object.keys(own.values)) if (name in source) errors.push(`${here}.${name} : déjà donné au niveau de l'élément.`)
              Object.assign(out.values, own.values)
              if (own.slug) out.slug = own.slug
            }
          }
        }
        else if (!fields[k]) {
          const meta = main ? [...(def.kind === 'collection' ? ['id'] : []), ...(hasSlug ? ['slug'] : []), ...(def.seo ? ['seo'] : []), 'status', ...others] : []
          errors.push(`${here} : champ inconnu dans « ${type} ». Champs possibles : ${list(Object.keys(main ? fields : parts.localized))}${meta.length ? ` ; et aussi : ${list(meta)}` : ''}.`)
        }
        else if (!main && !(k in parts.localized)) {
          // Répété à l'identique dans une traduction : sans conséquence. Différent : il n'y a qu'une valeur pour toutes les langues.
          if (JSON.stringify(v) !== JSON.stringify(item[k])) errors.push(`${here} : ce champ est commun à toutes les langues. Donnez sa valeur une seule fois, au niveau de l'élément.`)
        }
        else {
          const value = convert(fields[k], v, here)
          if (value !== undefined) out.values[k] = value
        }
      }
      return out
    }

    const main = read(item, at, defaultLocale)
    entry.values = main.values
    if (main.slug) entry.slug = main.slug
    for (const locale of others) {
      const block = item[locale]
      if (block === undefined || locale in fields) continue
      if (!isObject(block)) { errors.push(`${at}.${locale} : objet attendu, avec les champs traduits (reçu ${kindOf(block)}).`); continue }
      const translated = read(block, `${at}.${locale}`, locale)
      entry.translations[locale] = { values: translated.values, ...(translated.slug ? { slug: translated.slug } : {}) }
    }
    if (errors.length === before) entries.push(entry)
  }

  if (data.singletons !== undefined && !isObject(data.singletons)) errors.push('singletons : objet attendu, { "nomDeLaPage": { … } }.')
  for (const [type, item] of Object.entries(isObject(data.singletons) ? data.singletons : {})) {
    const def = singletons[type]
    const at = `singletons.${type}`
    if (!def) errors.push(`${at} : ${collections[type] ? 'c\'est une collection, à écrire dans "collections"' : 'page unique inconnue'}. Pages uniques de cms.config.ts : ${list(Object.keys(singletons))}.`)
    else if (!isObject(item)) errors.push(`${at} : objet attendu, avec les valeurs par nom de champ (reçu ${kindOf(item)}).`)
    else planEntry(type, def, item, at, '')
  }

  if (data.collections !== undefined && !isObject(data.collections)) errors.push('collections : objet attendu, { "nomDeLaCollection": [ … ] }.')
  for (const [type, items] of Object.entries(lists)) {
    const def = collections[type]
    if (!def) { errors.push(`collections.${type} : ${singletons[type] ? 'c\'est une page unique, à écrire dans "singletons"' : 'collection inconnue'}. Collections de cms.config.ts : ${list(Object.keys(collections))}.`); continue }
    if (!Array.isArray(items)) { errors.push(`collections.${type} : liste d'éléments attendue (reçu ${kindOf(items)}).`); continue }
    const seen = new Set<string>()
    items.forEach((item, i) => {
      const position = `collections.${type}[${i}]`
      if (!isObject(item)) { errors.push(`${position} : objet attendu, avec les valeurs par nom de champ (reçu ${kindOf(item)}).`); return }
      const key = item.id
      if (typeof key !== 'string' || !key.trim()) {
        errors.push(`${position} : id manquant. Donnez à chaque élément un nom stable de votre choix ("id": "mon-element") : il sert à le retrouver quand on relance l'import.`)
        return
      }
      const at = `${position} (« ${key} »)`
      if (seen.has(key)) { errors.push(`${at} : l'id « ${key} » est déjà utilisé par un autre élément de « ${type} ».`); return }
      seen.add(key)
      planEntry(type, def, item, at, key)
    })
  }

  // Redirections : anciennes adresses d'un précédent site. Le serveur refait toutes les vérifications (boucles, pages en ligne…).
  const redirects: PlannedRedirect[] = []
  if (data.redirections !== undefined) {
    if (!Array.isArray(data.redirections)) errors.push(`redirections : attendu une liste de { "from": "/ancienne", "to": "/nouvelle" } (reçu ${kindOf(data.redirections)}).`)
    else data.redirections.forEach((item, i) => {
      const at = `redirections[${i}]`
      if (!isObject(item)) { errors.push(`${at} : attendu { "from": "/ancienne", "to": "/nouvelle" } (reçu ${kindOf(item)}).`); return }
      for (const k of Object.keys(item)) if (!['from', 'to', 'status'].includes(k)) errors.push(`${at}.${k} : clé inconnue. Clés possibles : from, to, status.`)
      const from = normalizeSource(item.from)
      if (!from.ok) { errors.push(`${at}.from : ${from.error}`); return }
      if (redirects.some(r => r.from === from.path)) { errors.push(`${at}.from : « ${from.path} » figure déjà plus haut dans la liste.`); return }
      if (item.status !== undefined && item.status !== 301 && item.status !== 302) { errors.push(`${at}.status : attendu 301 (définitive) ou 302 (provisoire).`); return }
      const status = item.status === 302 ? 302 : 301
      if (typeof item.to === 'string') {
        const to = normalizeUrlTarget(item.to, config.site.url)
        if (!to.ok) errors.push(`${at}.to : ${to.error}`)
        else redirects.push({ from: from.path, to: to.url, status })
        return
      }
      if (!isObject(item.to) || typeof item.to.page !== 'string') { errors.push(`${at}.to : attendu une adresse ("/nouvelle", "https://…") ou une page du site { "page": "…", "id": "…" }.`); return }
      for (const k of Object.keys(item.to)) if (!['page', 'id', 'locale'].includes(k)) errors.push(`${at}.to.${k} : clé inconnue. Clés possibles : page, id, locale.`)
      const type = item.to.page
      const def = singletons[type] ?? collections[type]
      if (!def) { errors.push(`${at}.to.page : « ${type} » n'est ni une collection ni une page unique. Possibles : ${list([...Object.keys(singletons), ...Object.keys(collections)])}.`); return }
      if (!def.path) { errors.push(`${at}.to.page : « ${type} » n'a pas d'adresse sur le site (pas de "path" dans la configuration).`); return }
      const locale = item.to.locale === undefined ? defaultLocale : String(item.to.locale)
      if (!locales.includes(locale)) { errors.push(`${at}.to.locale : langue inconnue. Langues du site : ${list([...locales])}.`); return }
      if (singletons[type]) {
        if (item.to.id !== undefined) errors.push(`${at}.to.id : « ${type} » est une page unique, elle n'a pas d'id.`)
        redirects.push({ from: from.path, to: { kind: 'page', type, id: type, locale }, status })
        return
      }
      if (typeof item.to.id !== 'string') { errors.push(`${at}.to.id : indiquez l'id de l'élément de « ${type} » visé.`); return }
      if (!keys.get(type)?.has(item.to.id)) { errors.push(`${at}.to.id : aucun élément « ${item.to.id} » dans collections.${type} de ce fichier.`); return }
      redirects.push({ from: from.path, to: { kind: 'page', type, id: importId(type, item.to.id), locale }, status })
    })
  }

  return { errors, warnings, entries, files: [...files.values()], redirects }
}

// ───────────────────────── Demandes envoyées à l'API ─────────────────────────

/** Remplace les fichiers attendus par leur identifiant dans la médiathèque. */
export function withMedia<T>(value: T, ids: Map<string, string>): T {
  if (isMediaToken(value)) return (ids.get(value.$media) ?? null) as T
  if (Array.isArray(value)) return value.map(v => withMedia(v, ids)) as T
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withMedia(v, ids)])) as T
  return value
}

/** Chemins des fichiers cités par un élément. */
export function mediaOf(value: unknown, out = new Set<string>()): Set<string> {
  if (isMediaToken(value)) out.add(value.$media)
  else if (Array.isArray(value)) for (const v of value) mediaOf(v, out)
  else if (value && typeof value === 'object') for (const v of Object.values(value)) mediaOf(v, out)
  return out
}

/**
 * Corps de la demande d'enregistrement d'un élément (écriture à plat de l'API, voir `server/utils/entries.ts`).
 * `create` : l'élément n'existe pas encore, son identifiant est fourni.
 */
export function requestBody(entry: PlannedEntry, ids: Map<string, string>, options: { create: boolean; dryRun: boolean }) {
  // Une traduction vide (« "en": {} ») n'est pas envoyée : il n'y aurait rien à enregistrer ni à publier dans cette langue.
  const translations = Object.fromEntries(Object.entries(entry.translations)
    .filter(([, t]) => Object.keys(t.values).length || t.slug)
    .map(([locale, t]) => [locale, { values: withMedia(t.values, ids), ...(t.slug ? { slug: t.slug } : {}) }]))
  return {
    ...(options.create && entry.kind === 'collection' ? { id: entry.id } : {}),
    locale: entry.locale,
    values: withMedia(entry.values, ids),
    ...(entry.slug ? { slug: entry.slug } : {}),
    ...(Object.keys(translations).length ? { translations } : {}),
    ...(entry.publish ? { publish: [entry.locale, ...Object.keys(translations)] } : {}),
    ...(options.dryRun ? { dryRun: true } : {}),
  }
}
