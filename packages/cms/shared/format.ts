/**
 * Format des collections, version 1.
 *
 * Ce fichier est la référence : il définit ce qu'on peut écrire dans `cms.config.ts`,
 * les règles de validation, et le type des contenus lus par le site.
 * Le résultat de `defineCms()` est sérialisable tel quel : c'est le JSON du back-office.
 */

import { type AccessRules, CMS_ACTIONS, DEFAULT_ACCESS } from './access'
import type { CmsModuleRef } from './modules'

export const FORMAT_VERSION = 1

// ───────────────────────── Champs ─────────────────────────

export type FieldType =
  | 'text' | 'textarea' | 'richText' | 'number' | 'boolean' | 'date'
  | 'select' | 'image' | 'file' | 'link' | 'relation' | 'repeater'

/** Les champs de texte ont une valeur par langue ; les autres sont communs à toutes les langues. */
export const LOCALIZED_BY_DEFAULT: Record<FieldType, boolean> = {
  text: true, textarea: true, richText: true, link: true, repeater: true,
  number: false, boolean: false, date: false, select: false, image: false, file: false, relation: false,
}

type Scalar = string | number | boolean

/**
 * Condition d'affichage, évaluée sur un autre champ du même niveau.
 * Le champ observé doit être de type boolean, select, number ou text (sauf pour `empty`, valable partout).
 * Sur un select multiple, `equals` signifie « contient ».
 */
export type Condition = { field: string } & (
  | { equals: Scalar }
  | { notEquals: Scalar }
  | { in: readonly Scalar[] }
  | { empty: boolean }
)

type Common = {
  /** Nom affiché dans le formulaire. */
  label: string
  /** Texte d'aide sous le champ. */
  help?: string
  required?: boolean
  /** Une valeur par langue. Défaut : voir LOCALIZED_BY_DEFAULT. Interdit dans un répéteur. */
  localized?: boolean
  /** Largeur dans le formulaire. Défaut : 'full'. */
  width?: 'full' | 'half'
  /**
   * Ancien nom du champ, à indiquer quand on le renomme : au premier accès après le déploiement, ses valeurs
   * (brouillons et versions publiées, toutes langues) sont déplacées sous le nouveau nom. Sans cette option,
   * l'ancien champ est considéré comme retiré (ses valeurs restent en base, sans être affichées) et le nouveau est vide.
   * Peut rester dans le fichier après la migration : il est alors ignoré. Ne peut pas désigner un champ encore présent.
   * Dans un répéteur, s'applique aux sous-champs de la même façon. Voir `shared/migrate.ts`.
   */
  renamedFrom?: string
  /**
   * Champ réservé : tout le monde le voit, mais seuls les rôles qui ont le droit « champs réservés » le modifient
   * (administrateur et éditeur ; pas le rédacteur ; au choix pour un rôle personnalisé). Interdit dans un répéteur.
   */
  restricted?: boolean
  /**
   * N'affiche le champ que si la condition est remplie.
   * Un champ masqué n'est pas validé (même `required`) et le site le reçoit vide ;
   * sa valeur reste en base et réapparaît si la condition redevient vraie.
   */
  showIf?: Condition
}

export type RichTextFeature = 'heading' | 'bold' | 'italic' | 'list' | 'link' | 'quote' | 'image'

interface OptsOf {
  /** Une ligne de texte. Valeur : string. */
  text: Common & { min?: number; max?: number; placeholder?: string; format?: 'plain' | 'email' | 'url' | 'tel' }
  /** Texte sur plusieurs lignes, sans mise en forme. Valeur : string. */
  textarea: Common & { min?: number; max?: number; rows?: number }
  /** Texte mis en forme. Valeur : HTML nettoyé à l'enregistrement. Défaut : toutes les options sauf 'image'. */
  richText: Common & { features?: readonly RichTextFeature[] }
  /** Valeur : number. */
  number: Common & { min?: number; max?: number; step?: number; integer?: boolean; unit?: string }
  /** Interrupteur. Valeur : boolean, jamais vide. */
  boolean: Omit<Common, 'required'> & { default?: boolean }
  /** Valeur : date ISO ('2026-11-17'), ou date et heure si `time`. */
  date: Common & { time?: boolean }
  /** Liste de choix fixe. Valeur : une des `value`, ou un tableau si `multiple`. */
  select: Common & { options: readonly { value: string; label: string }[]; multiple?: boolean }
  /** Image de la médiathèque. Valeur : Media. */
  image: Common
  /** Fichier de la médiathèque (PDF…). Valeur : Media. */
  file: Common & { accept?: readonly string[] }
  /** Lien vers une page du site ou une adresse externe. Valeur : Link. */
  link: Common
  /** Référence vers une autre collection. Valeur : EntryRef, ou un tableau si `multiple`. */
  relation: Common & { to: string; multiple?: boolean }
  /** Liste d'éléments ayant les mêmes sous-champs. Valeur : tableau, jamais vide de type. Pas de répéteur imbriqué. */
  repeater: Common & { fields: Record<string, AnyField>; itemLabel?: string; min?: number; max?: number }
}

export type AnyField = Common & { type: FieldType; [option: string]: unknown }

const make = <T extends FieldType>(type: T) =>
  <const O extends OptsOf[T]>(options: O) => ({ ...options, type }) as O & { type: T }

export const f = {
  text: make('text'), textarea: make('textarea'), richText: make('richText'), number: make('number'),
  boolean: make('boolean'), date: make('date'), select: make('select'), image: make('image'),
  file: make('file'), link: make('link'), relation: make('relation'), repeater: make('repeater'),
}

// ───────────────────────── Singletons et collections ─────────────────────────

type Fields = Record<string, AnyField>
type SystemSort = 'createdAt' | 'updatedAt' | 'publishedAt'

type SingletonOpts<F> = {
  /** Nom dans le menu du back-office. */
  label: string
  /** Icône du menu : un nom de https://lucide.dev/icons, en minuscules avec tirets ('briefcase', 'message-square-quote'). */
  icon?: string
  /** Section du menu. Défaut : 'Pages' pour un singleton, 'Collections' pour une collection. */
  group?: string
  /** Adresse publique. Singleton : '/contact'. Collection : '/services/[slug]'. Absent : pas de page propre. */
  path?: string
  /** Ajoute l'onglet Référencement (titre, description, image de partage, masquage). Exige `path`. */
  seo?: boolean
  /** Brouillon et publication séparés. Défaut : true. */
  drafts?: boolean
  /** Réservé aux administrateurs : les autres rôles ne voient ni ne modifient ce contenu. Équivaut à retirer tous les droits. */
  adminOnly?: boolean
  /**
   * Qui peut faire quoi sur ce contenu, par rôle ('editor', 'writer'). L'administrateur a toujours tous les droits.
   * - `edit` : voir et modifier le brouillon. Défaut : ['editor', 'writer'].
   * - `publish` : mettre en ligne, retirer du site, changer l'ordre ou l'adresse d'une page publiée. Défaut : ['editor'].
   * - `delete` : supprimer. Défaut : ['editor'].
   * - `own` : rôles limités aux contenus qu'ils ont créés eux-mêmes (collections seulement). Défaut : aucun.
   * Exemple, des actualités que les rédacteurs publient eux-mêmes : `access: { publish: ['editor', 'writer'] }`.
   * Exemple, chaque rédacteur ne voit que ses propres articles : `access: { own: ['writer'] }`.
   * Les rôles personnalisés créés dans le back-office ont leurs propres droits et ne dépendent pas de ce réglage.
   * Sans brouillons (`drafts: false`), enregistrer c'est publier : il faut alors le droit `publish` pour modifier.
   */
  access?: AccessRules
  fields: F
  /**
   * Ancien identifiant, à indiquer quand on renomme la collection ou le singleton : ses contenus, leurs redirections
   * et les liens qui pointent vers eux suivent au premier accès après le déploiement. Sans cette option, les anciens
   * contenus restent en base mais ne sont plus affichés. Peut rester dans le fichier après la migration (il est ignoré) ;
   * ne peut pas désigner un identifiant encore utilisé. Si des contenus existent déjà sous le nouvel identifiant,
   * rien n'est déplacé : l'écran « Structure des contenus » du back-office l'explique.
   */
  renamedFrom?: string
}

type CollectionOpts<F> = SingletonOpts<F> & {
  /** Nom d'un élément, au singulier. Réservé à de futurs libellés ; l'interface n'en dépend pas encore. */
  labelSingular?: string
  /** Champ texte qui nomme un élément dans les listes et la recherche. */
  titleField: keyof F & string
  /** Champ texte dont on tire l'adresse. Défaut : `titleField`. Utilisé seulement si `path` contient [slug]. */
  slugFrom?: keyof F & string
  /** Ordre manuel par glisser-déposer. Incompatible avec `defaultSort`. */
  orderable?: boolean
  /** Tri par défaut. Sans `orderable` ni `defaultSort` : du plus récent au plus ancien. */
  defaultSort?: { field: (keyof F & string) | SystemSort; dir: 'asc' | 'desc' }
  list?: {
    /** Colonnes de la liste, après le titre. Statut, langues et date sont ajoutés automatiquement. */
    columns?: readonly (keyof F & string)[]
    /** Champ image affiché en vignette. */
    thumbnail?: keyof F & string
  }
}

export function singleton<const F extends Fields>(options: SingletonOpts<F>) {
  return { seo: false, drafts: true, ...options, kind: 'singleton' as const }
}

export function collection<const F extends Fields>(options: CollectionOpts<F>) {
  return { seo: false, drafts: true, orderable: false, ...options, kind: 'collection' as const }
}

type Site = {
  name: string
  /** Adresse du site en production, pour les aperçus et le sitemap. */
  url?: string
  /** Codes de langue : 'fr', 'en', 'pt-BR'. */
  locales: readonly [string, ...string[]]
  defaultLocale: string
}

type Config = {
  site: Site
  /** Fonctions ajoutées au site : `modules: [brevo(), forms({ … })]`. Voir `shared/modules.ts`. */
  modules?: readonly CmsModuleRef[]
  singletons?: Record<string, ReturnType<typeof singleton>>
  collections?: Record<string, ReturnType<typeof collection>>
}

/** Valide la configuration, applique les valeurs par défaut et renvoie le JSON du back-office. */
export function defineCms<const C extends Config>(config: C): C & { formatVersion: number } {
  const errors = validate(config)
  if (errors.length) throw new Error('Configuration invalide :\n' + errors.map(e => '  - ' + e).join('\n'))
  const out = JSON.parse(JSON.stringify(config))
  for (const def of [...Object.values(out.singletons ?? {}), ...Object.values(out.collections ?? {})] as any[])
    for (const field of Object.values(def.fields) as AnyField[])
      field.localized ??= LOCALIZED_BY_DEFAULT[field.type]
  return { formatVersion: FORMAT_VERSION, ...out }
}

// ───────────────────────── Validation ─────────────────────────

const KEY = /^[a-z][a-zA-Z0-9]*$/
const LOCALE = /^[a-z]{2}(-[A-Z]{2})?$/
/** Noms réservés aux champs gérés par le système. */
export const RESERVED = ['id', 'slug', 'status', 'locale', 'seo', 'position', 'createdAt', 'updatedAt', 'publishedAt']

/** Identifiants de collection réservés : ce sont des pages du back-office. */
export const RESERVED_TYPES = ['media', 'users', 'workflows', 'appearance', 'account', 'invite', 'login', 'setup', 'new', 'migrations', 'roles', 'reviews', 'modules', 'forms', 'payments']

export function validate(config: Config): string[] {
  const errors: string[] = []
  const { site, singletons = {}, collections = {} } = config

  const moduleIds = (config.modules ?? []).map(m => m?.id)
  if (moduleIds.some(id => typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id))) errors.push('modules : chaque module doit avoir un identifiant (utilisez brevo(), forms()…)')
  else if (new Set(moduleIds).size !== moduleIds.length) errors.push('modules : un même module est déclaré deux fois')
  // Un module qui désigne des collections ou des champs (stripe()) les vérifie ici.
  else for (const m of config.modules ?? []) if (typeof m.check === 'function') errors.push(...m.check(config))

  if (new Set(site.locales).size !== site.locales.length) errors.push('site.locales contient un doublon')
  for (const l of site.locales) if (!LOCALE.test(l)) errors.push(`langue « ${l} » : attendu un code comme 'fr' ou 'pt-BR'`)
  if (!site.locales.includes(site.defaultLocale)) errors.push('site.defaultLocale doit faire partie de site.locales')

  const isText = (fields: Fields, key: string) => fields[key]?.type === 'text'
  // Un ancien nom encore porté par un voisin, ou revendiqué deux fois : impossible de savoir quelles données suivre.
  const checkRename = (at: string, key: string, from: string | undefined, siblings: Record<string, { renamedFrom?: string }>) => {
    if (!from || from === key) return
    if (from in siblings) errors.push(`${at} : renamedFrom désigne « ${from} », qui existe encore. Retirez renamedFrom si la migration est faite, sinon choisissez un autre nom`)
    else if (Object.entries(siblings).some(([other, s]) => other !== key && s.renamedFrom === from)) errors.push(`${at} : renamedFrom « ${from} » est déjà utilisé par un autre élément`)
  }
  const checkFields = (where: string, fields: Fields, nested: boolean) => {
    if (!Object.keys(fields).length) errors.push(`${where} : aucun champ`)
    for (const [key, field] of Object.entries(fields)) {
      const at = `${where}.${key}`
      if (!KEY.test(key)) errors.push(`${at} : le nom doit être en camelCase, sans accent`)
      if (RESERVED.includes(key)) errors.push(`${at} : nom réservé`)
      if (!field.label) errors.push(`${at} : label manquant`)
      if (field.renamedFrom && !KEY.test(field.renamedFrom)) errors.push(`${at} : renamedFrom invalide`)
      checkRename(at, key, field.renamedFrom, fields)
      if (nested && field.localized !== undefined) errors.push(`${at} : localized se règle sur le répéteur, pas sur ses sous-champs`)
      if (nested && field.restricted) errors.push(`${at} : restricted se règle sur le répéteur, pas sur ses sous-champs`)
      if (field.type === 'select') {
        const values = (field.options as { value: string }[]).map(o => o.value)
        if (!values.length || new Set(values).size !== values.length) errors.push(`${at} : options vides ou en double`)
      }
      if (field.type === 'relation' && !collections[field.to as string]) errors.push(`${at} : la collection « ${field.to} » n'existe pas`)
      if (field.showIf) {
        const c = field.showIf as { field: string } & Record<string, unknown>
        const target = fields[c.field]
        const ops = ['equals', 'notEquals', 'in', 'empty'].filter(op => op in c)
        const localized = (x: AnyField) => x.localized ?? LOCALIZED_BY_DEFAULT[x.type]
        if (!target || c.field === key) errors.push(`${at}.showIf : champ « ${c.field} » introuvable au même niveau`)
        else if (ops.length !== 1) errors.push(`${at}.showIf : une seule condition parmi equals, notEquals, in, empty`)
        else {
          if (ops[0] !== 'empty') {
            const values = ops[0] === 'in' ? (c.in as unknown[]) : [c[ops[0]!]]
            const allowed = target.type === 'select' ? (target.options as { value: string }[]).map(o => o.value) : null
            const ok = values.length > 0 && values.every(v =>
              target.type === 'boolean' ? typeof v === 'boolean'
              : target.type === 'number' ? typeof v === 'number'
              : target.type === 'text' ? typeof v === 'string'
              : allowed ? allowed.includes(v as string) : false)
            if (!ok) errors.push(`${at}.showIf : valeur incompatible avec le champ « ${c.field} » (${target.type})`)
          }
          if (!nested && !localized(field) && localized(target)) errors.push(`${at}.showIf : un champ commun aux langues ne peut pas dépendre d'un champ traduit`)
        }
      }
      if (field.type === 'repeater') {
        const sub = field.fields as Fields
        if (nested) errors.push(`${at} : pas de répéteur dans un répéteur`)
        else checkFields(at, sub, true)
        if (field.itemLabel && !sub[field.itemLabel as string]) errors.push(`${at} : itemLabel ne correspond à aucun sous-champ`)
      }
    }
    for (const key of Object.keys(fields)) {
      const visited = new Set([key])
      let next = fields[key]?.showIf?.field
      while (next && fields[next]) {
        if (visited.has(next)) { errors.push(`${where}.${key}.showIf : dépendance circulaire`); break }
        visited.add(next)
        next = fields[next]?.showIf?.field
      }
    }
  }

  const seen = new Set<string>()
  const checkDef = (key: string, def: ReturnType<typeof singleton> | ReturnType<typeof collection>) => {
    if (!KEY.test(key)) errors.push(`${key} : l'identifiant doit être en camelCase, sans accent`)
    if (RESERVED_TYPES.includes(key)) errors.push(`${key} : identifiant réservé au back-office`)
    if (seen.has(key)) errors.push(`${key} : identifiant utilisé deux fois`)
    seen.add(key)
    if (def.path && !def.path.startsWith('/')) errors.push(`${key}.path doit commencer par /`)
    if (def.seo && !def.path) errors.push(`${key} : seo exige path`)
    for (const [action, roles] of Object.entries(def.access ?? {})) {
      if (![...CMS_ACTIONS, 'own'].includes(action)) errors.push(`${key}.access : droit inconnu « ${action} » (edit, publish, delete ou own)`)
      else if (!Array.isArray(roles) || !roles.every(r => r === 'editor' || r === 'writer')) errors.push(`${key}.access.${action} : liste de rôles attendue ('editor', 'writer')`)
    }
    if (def.adminOnly && def.access) errors.push(`${key} : adminOnly et access sont incompatibles`)
    const edit = def.access?.edit ?? DEFAULT_ACCESS.edit
    if (def.access?.own?.length && def.kind !== 'collection') errors.push(`${key}.access.own : réservé aux collections`)
    for (const action of ['publish', 'delete', 'own'] as const)
      for (const role of def.access?.[action] ?? []) if (!edit.includes(role)) errors.push(`${key}.access.${action} : le rôle « ${role} » doit aussi avoir le droit edit`)
    if (def.renamedFrom && !KEY.test(def.renamedFrom)) errors.push(`${key} : renamedFrom invalide`)
    checkRename(key, key, def.renamedFrom, { ...singletons, ...collections })
    checkFields(key, def.fields, false)
  }

  for (const [key, def] of Object.entries(singletons)) {
    checkDef(key, def)
    if (def.path?.includes('[slug]')) errors.push(`${key}.path : un singleton n'a pas de [slug]`)
  }
  for (const [key, def] of Object.entries(collections)) {
    checkDef(key, def)
    if (def.path && !def.path.includes('[slug]')) errors.push(`${key}.path doit contenir [slug]`)
    if (!isText(def.fields, def.titleField)) errors.push(`${key}.titleField doit désigner un champ de type text`)
    if (def.slugFrom && !isText(def.fields, def.slugFrom)) errors.push(`${key}.slugFrom doit désigner un champ de type text`)
    if (def.orderable && def.defaultSort) errors.push(`${key} : orderable et defaultSort sont incompatibles`)
    const sort = def.defaultSort?.field
    if (sort && !def.fields[sort] && !['createdAt', 'updatedAt', 'publishedAt'].includes(sort)) errors.push(`${key}.defaultSort : champ inconnu`)
    for (const c of def.list?.columns ?? []) if (!def.fields[c]) errors.push(`${key}.list.columns : champ « ${c} » inconnu`)
    const thumb = def.list?.thumbnail
    if (thumb && def.fields[thumb]?.type !== 'image') errors.push(`${key}.list.thumbnail doit désigner un champ image`)
  }
  return errors
}

/** Indique si un champ est affiché, d'après les valeurs des champs du même niveau. Utilisé par le formulaire et par le serveur. */
export function isVisible(field: { showIf?: Condition }, values: Record<string, unknown>): boolean {
  const c = field.showIf as ({ field: string } & Record<string, unknown>) | undefined
  if (!c) return true
  let v = values[c.field]
  // Un interrupteur jamais touché vaut « non », pas « vide ».
  if (v == null && (typeof c.equals === 'boolean' || typeof c.notEquals === 'boolean')) v = false
  if ('empty' in c) return (v == null || v === '' || (Array.isArray(v) && !v.length)) === c.empty
  const has = (x: unknown) => (Array.isArray(v) ? v.includes(x) : v === x)
  if ('equals' in c) return has(c.equals)
  if ('notEquals' in c) return !has(c.notEquals)
  return (c.in as unknown[]).some(has)
}

// ───────────────────────── Types des contenus lus par le site ─────────────────────────

export type Media = { id: string; url: string; name: string; alt: string; mime: string; width: number | null; height: number | null }
export type Link = { label: string; href: string; newTab: boolean }
export type EntryRef = { id: string; collection: string; title: string; slug: string | null }
/** `title` vaut le titre du contenu quand le champ de référencement est laissé vide. */
export type Seo = { title: string | null; description: string | null; image: Media | null; noindex: boolean }

type Raw<F> =
  F extends { type: 'text' | 'textarea' | 'richText' | 'date' } ? string
  : F extends { type: 'number' } ? number
  : F extends { type: 'boolean' } ? boolean
  : F extends { type: 'select'; options: readonly { value: infer V }[] } ? (F extends { multiple: true } ? V[] : V)
  : F extends { type: 'image' | 'file' } ? Media
  : F extends { type: 'link' } ? Link
  : F extends { type: 'relation' } ? (F extends { multiple: true } ? EntryRef[] : EntryRef)
  : F extends { type: 'repeater'; fields: infer S } ? Values<S>[]
  : never

/**
 * ## Ce que le site reçoit quand un champ est vide
 *
 * Un champ vide a toujours la même forme, quelle que soit l'histoire du contenu (jamais rempli, vidé dans le
 * formulaire, importé, champ ajouté à la configuration après coup, champ masqué par `showIf`). Jamais `''`,
 * jamais `undefined`, jamais de clé absente : tous les champs de la configuration sont présents dans l'objet.
 *
 * | Champ                              | Vide           | Rempli                                   |
 * | ---------------------------------- | -------------- | ---------------------------------------- |
 * | `text`, `textarea`                 | `null`         | `string` non vide                        |
 * | `richText`                         | `null`         | HTML ; `<p></p>` (aucun texte) est vide  |
 * | `number`                           | `null`         | `number` (0 est une valeur)              |
 * | `date`                             | `null`         | `'2026-11-17'` ou `'2026-11-17T09:30'`   |
 * | `boolean`                          | jamais vide    | `true` / `false` (`default`, sinon false)|
 * | `select`                           | `null`         | une des `value`                          |
 * | `select` avec `multiple`           | `[]`           | tableau de `value`                       |
 * | `image`, `file`                    | `null`         | `Media`                                  |
 * | `link`                             | `null`         | `Link`                                   |
 * | `relation`                         | `null`         | `EntryRef`                               |
 * | `relation` avec `multiple`         | `[]`           | tableau d'`EntryRef`                     |
 * | `repeater`                         | `[]`           | tableau d'objets, mêmes règles dedans    |
 *
 * Dans une page : `v-if="product.note"` suffit pour un texte ; `product.stock !== null` pour un nombre (0 compte).
 *
 * Les types ci-dessous disent la même chose. Deux précisions :
 * - une référence (`image`, `file`, `link`, `relation` simple) peut être `null` même si le champ est obligatoire :
 *   le fichier a pu être supprimé de la médiathèque, le contenu lié supprimé ou retiré du site dans cette langue ;
 * - un champ obligatoire d'un autre type n'est jamais `null` dans un contenu publié, puisqu'il est vérifié à la
 *   publication. Il peut l'être dans l'aperçu d'un brouillon incomplet, ou si le champ est devenu obligatoire
 *   après la publication : une page ouverte à l'aperçu ne doit pas supposer le contraire.
 */

/** Ces champs ont toujours une valeur : false ou tableau vide quand ils sont vides ou masqués. */
type NeverNull = { type: 'boolean' } | { type: 'repeater' } | { multiple: true }
/** Ces champs désignent autre chose (fichier, page, contenu) qui peut disparaître : `null` reste possible même s'ils sont obligatoires. */
type Reference = { type: 'image' | 'file' | 'link' | 'relation' }

/** Un champ obligatoire n'est jamais null, sauf une référence, ou s'il a une condition d'affichage : masqué, il est vide. */
export type Values<S> = {
  -readonly [K in keyof S]:
    S[K] extends NeverNull ? Raw<S[K]>
    : S[K] extends Reference ? Raw<S[K]> | null
    : S[K] extends { showIf: object } ? Raw<S[K]> | null
    : S[K] extends { required: true } ? Raw<S[K]>
    : Raw<S[K]> | null
}

type System = {
  id: string
  locale: string
  /** Adresse de la page dans cette langue ('/en/services/business-law'), ou null si le contenu n'a pas de page. */
  path: string | null
  /** Adresse complète de la page ('https://cabinet-durand.fr/en/services/business-law'), ou null. */
  url: string | null
  /** La même page dans chaque langue où elle est publiée, langue courante comprise. Sert aux balises hreflang. */
  alternates: { locale: string; path: string; url: string }[]
  status: 'draft' | 'published' | 'changed'
  createdAt: string
  updatedAt: string
  publishedAt: string | null
}

/** Type d'un contenu tel que le site le reçoit : `InferEntry<typeof config.collections.services>`. */
export type InferEntry<T> =
  T extends { kind: 'collection'; fields: infer F } ? System & { slug: string | null; seo: Seo | null } & Values<F>
  : T extends { kind: 'singleton'; fields: infer F } ? System & { seo: Seo | null } & Values<F>
  : never

/** Forme générale du JSON du back-office, quand on n'a pas besoin des types précis d'un projet. */
export type CmsDefinition = ReturnType<typeof singleton> | ReturnType<typeof collection>
export type CmsConfig = Config & { formatVersion: number }
