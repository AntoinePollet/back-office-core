/**
 * Format des collections, version 1.
 *
 * Ce fichier est la référence : il définit ce qu'on peut écrire dans `cms.config.ts`,
 * les règles de validation, et le type des contenus lus par le site.
 * Le résultat de `defineCms()` est sérialisable tel quel : c'est le JSON du back-office.
 */

import { type AccessRules, CMS_ACTIONS, DEFAULT_ACCESS } from './access'
import type { CmsModuleRef } from './modules'
import { type FeedOptions, feedErrors } from './feeds'
import { isValidTimeZone } from './schedule'
import { type BreadcrumbName, type StructuredDataSpec, structuredDataErrors } from './structured-data'

export { sd, WEEKDAYS } from './structured-data'

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
   * Section du formulaire où le champ est rangé. S'écrit plutôt avec `section()` (voir plus bas), qui la pose sur un groupe de champs.
   * Pure présentation : ni les données, ni ce que reçoit le site, ni l'import ne changent. Interdit dans un répéteur.
   */
  section?: Section
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
  /**
   * Image de la médiathèque. Valeur : Media.
   * Avec `multiple: true`, une galerie : une liste ordonnée d'images (valeur : Media[], `[]` si vide), utilisable
   * aussi dans un répéteur. Voir `MediaOpts`.
   */
  image: Common & MediaOpts
  /** Fichier de la médiathèque (PDF…). Valeur : Media. Avec `multiple: true` : une liste de fichiers, comme une galerie. */
  file: Common & MediaOpts & { accept?: readonly string[] }
  /** Lien vers une page du site ou une adresse externe. Valeur : Link. */
  link: Common
  /** Référence vers une autre collection. Valeur : EntryRef, ou un tableau si `multiple`. */
  relation: Common & { to: string; multiple?: boolean }
  /** Liste d'éléments ayant les mêmes sous-champs. Valeur : tableau, jamais vide de type. Pas de répéteur imbriqué. */
  repeater: Common & { fields: Record<string, AnyField>; itemLabel?: string; min?: number; max?: number }
}

/**
 * Options d'un champ image ou fichier.
 *
 * ```ts
 * cover: f.image({ label: 'Photo principale' }),                                  // une image
 * photos: f.image({ label: 'Photos', multiple: true, captions: true, max: 12 }),  // une galerie légendée
 * ```
 *
 * Dans une page, une galerie se parcourt directement ; avec `captions`, chaque image porte sa légende :
 *
 * ```vue
 * <figure v-for="photo in item.photos" :key="photo.id">
 *   <CmsImage :media="photo" sizes="(min-width: 768px) 33vw, 100vw" />
 *   <figcaption v-if="photo.caption">{{ photo.caption }}</figcaption>
 * </figure>
 * ```
 *
 * Pour des vignettes toutes de mêmes proportions, `ratio` fait recadrer l'image par le serveur, autour du point
 * d'intérêt réglé dans la médiathèque (proportions servies : `IMAGE_RATIOS` dans shared/media.ts) :
 *
 * ```vue
 * <CmsImage :media="photo" ratio="1/1" sizes="12rem" />
 * ```
 *
 * La légende est propre à cet usage de l'image (« Marseille (13) ») ; le texte alternatif (`alt`), lui, appartient
 * au fichier et se règle une fois dans la médiathèque. Comme toute valeur d'un champ, les légendes sont traduites si
 * le champ l'est : une galerie est commune aux langues par défaut (`localized: true` pour des légendes par langue) ;
 * dans un répéteur traduit, elle suit le répéteur.
 *
 * Valeur enregistrée (API d'écriture, historique) : `[{ media: '<id du fichier>', caption?: 'Marseille (13)' }]`.
 * L'API accepte aussi une liste d'identifiants (`['<id>', '<id>']`), enregistrée sous la forme ci-dessus.
 */
type MediaOpts = {
  /** Plusieurs fichiers, dans un ordre choisi (glisser-déposer). Défaut : un seul. */
  multiple?: boolean
  /** Avec `multiple` : une légende facultative par image, saisie dans le formulaire. */
  captions?: boolean
  /** Avec `multiple` : nombre minimal d'éléments (s'il y en a au moins un ; `required` exige d'en avoir un). */
  min?: number
  /** Avec `multiple` : nombre maximal d'éléments. */
  max?: number
}

export type AnyField = Common & { type: FieldType; [option: string]: unknown }

/**
 * Titre d'une section du formulaire.
 * - `label` : titre de la section ; il l'identifie (deux sections d'un même contenu ont deux titres différents) ;
 * - `help` : texte d'aide sous le titre ;
 * - `collapsed` : repliée à l'ouverture du formulaire. Défaut : dépliée. Une section se replie et se déplie toujours d'un clic.
 */
export type Section = { label: string; help?: string; collapsed?: boolean }

/**
 * Range des champs dans une section du formulaire du back-office. Ne change rien d'autre : les noms des champs,
 * les données en base, ce que reçoit le site et le fichier d'import restent les mêmes. On peut donc ajouter,
 * renommer ou retirer des sections sur un site existant sans migration.
 *
 * ```ts
 * fields: {
 *   title: f.text({ label: 'Titre', required: true }),                 // hors section
 *   ...section({ label: 'Bandeau', help: 'En haut de la page.' }, {
 *     heroTitle: f.text({ label: 'Titre' }),
 *     heroImage: f.image({ label: 'Image' }),
 *   }),
 *   ...section({ label: 'Bas de page', collapsed: true }, cta()),     // fonction qui fabrique des champs
 * }
 * ```
 *
 * Les champs d'une section se suivent. Dans un formulaire multilingue, la section apparaît dans la zone des champs
 * traduits et dans celle des champs communs, avec chaque fois les champs qui s'y trouvent. Une section dont aucun
 * champ n'est affiché (`showIf`) disparaît ; une section repliée qui contient une erreur s'ouvre. Pas de section dans
 * un répéteur (les éléments d'un répéteur sont déjà repliables).
 */
export function section<const F extends Record<string, AnyField>>(meta: Section, fields: F): { [K in keyof F]: F[K] & { section: Section } } {
  return Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, { ...field, section: meta }])) as never
}

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
  /**
   * Ajoute l'onglet Référencement. Exige `path`. On y saisit, par langue : le titre et la description pour les moteurs
   * de recherche, et (facultatifs) un titre et une description propres au partage sur les réseaux et par message ;
   * pour toutes les langues : l'image de partage et « masquer des moteurs de recherche ». L'onglet montre l'aperçu du
   * résultat Google et de la carte de partage, et une liste de conseils (seuils dans `shared/seo.ts`). Ces valeurs sont
   * rangées sous la clé `seo` du contenu, sans champ à déclarer ; le site les reçoit dans `entry.seo` (type `Seo`) et
   * `useCmsSeo(entry)` les applique. L'écran « Référencement » du back-office liste toutes les pages concernées.
   */
  seo?: boolean
  /**
   * Le contenu apparaît-il dans la recherche du site (`useCmsSearch`, `/api/search`) ? Défaut : oui s'il a une page
   * (`path`). `false` l'en retire (mentions légales, page de remerciement…). Une page masquée des moteurs de
   * recherche ou non publiée n'y figure jamais.
   */
  search?: boolean
  /**
   * Données structurées (JSON-LD) de la page, pour les moteurs de recherche : quels champs alimentent quel bloc.
   * `sd.article({ image: 'cover', datePublished: 'date' })`, `sd.faq({ items: 'faq', question: 'question', answer: 'answer' })`,
   * `sd.organization({ type: 'LocalBusiness', telephone: 'phone', … })`, ou une liste de blocs. Un article ou une FAQ
   * exigent `path` ; l'organisme se déclare sur la page unique qui porte les coordonnées, avec ou sans adresse.
   * Le site les reçoit dans `entry.structuredData` et `useCmsSeo(entry)` les place dans la page ; l'onglet
   * Référencement en montre l'aperçu. Voir `shared/structured-data.ts`.
   */
  structuredData?: StructuredDataSpec | readonly StructuredDataSpec[]
  /**
   * Nom de la page dans le fil d'Ariane transmis aux moteurs de recherche (« Accueil › Services › Droit des affaires »),
   * déduit des adresses : un texte, ou un texte par langue (`{ fr: 'Services', en: 'Services' }`). Défaut : `label`
   * pour une page unique, le titre du contenu pour un élément de collection. `false` : cette page n'est pas dans les
   * fils d'Ariane, et n'en a pas elle-même.
   */
  breadcrumb?: BreadcrumbName | false
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
  /**
   * Flux RSS des derniers contenus publiés de la collection, à l'adresse `/feeds/<identifiant>.xml` (et
   * `/feeds/<langue>/<identifiant>.xml` pour les autres langues). `true`, ou des réglages : champs du résumé, de la
   * date et de l'image, contenu entier (`content`), titre, nombre d'éléments. Exige `path` avec [slug]. Dans une page,
   * `useCmsFeed('<identifiant>')` annonce le flux aux navigateurs et aux lecteurs. Voir `shared/feeds.ts`.
   */
  feed?: boolean | FeedOptions
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
  /**
   * Ce qu'est le site, en une phrase : « Cabinet d'avocats en droit des affaires, à Lyon ». Sert d'introduction au
   * fichier `/llms.txt` et de description aux flux RSS. Un texte, ou un texte par langue.
   */
  description?: string | Record<string, string>
  /**
   * Le fichier `/llms.txt` (liste des pages publiées et de leur résumé, à l'intention des assistants) est servi par
   * défaut ; `false` le retire. Un fichier `public/llms.txt` écrit à la main dans le projet prend le dessus.
   */
  llms?: boolean
  /** Adresse du site en production, pour les aperçus et le sitemap. */
  url?: string
  /** Codes de langue : 'fr', 'en', 'pt-BR'. */
  locales: readonly [string, ...string[]]
  defaultLocale: string
  /**
   * Fuseau horaire du site : celui des heures de la publication programmée (« le 3 décembre à 9 h »).
   * Un identifiant comme 'Europe/Paris' (valeur par défaut), 'Indian/Reunion', 'America/Montreal'.
   */
  timeZone?: string
  /**
   * Fin du titre de chaque page : avec 'Cabinet Durand', la page « Droit des affaires » a pour titre
   * « Droit des affaires — Cabinet Durand ». Appliqué par `useCmsSeo` et montré dans l'aperçu de l'onglet Référencement.
   * Il n'est pas répété si le titre le contient déjà ; une page sans titre a ce texte pour titre.
   * Une page peut s'en passer : `useCmsSeo(entry, { titleSuffix: false })`.
   */
  titleSuffix?: string
  /**
   * Image de partage par défaut, pour les pages qui n'en ont pas : un fichier du dossier `public/` du site
   * ('/partage.jpg', 1200 × 630 px dans l'idéal) ou une adresse complète.
   */
  shareImage?: string
  /**
   * Logo du site, affiché en haut du menu du back-office à la place de l'initiale : un fichier du dossier `public/`
   * du site ('/logo.svg', carré de préférence) ou une adresse complète.
   */
  logo?: string
  /**
   * Provenance des contacts (« Messages reçus », « Paiements ») : d'où venait le visiteur, lu dans l'adresse de sa
   * page d'arrivée (`utm_*`, `gclid` de Google Ads…) et le site précédent. Par défaut, elle n'est gardée que le temps
   * de la visite, en mémoire : rien n'est écrit sur l'appareil du visiteur.
   * - `false` : rien n'est relevé ;
   * - `{ rememberDays: 30 }` : la provenance est aussi gardée 30 jours sur l'appareil (stockage local), pour un
   *   visiteur qui revient plus tard. C'est un traceur : il n'est écrit qu'après l'accord du visiteur, que le bandeau
   *   de consentement du site transmet par `cmsAttributionConsent(true)`.
   */
  attribution?: false | { rememberDays?: number }
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
export const RESERVED_TYPES = ['media', 'users', 'workflows', 'appearance', 'account', 'invite', 'login', 'setup', 'new', 'migrations', 'roles', 'reviews', 'modules', 'forms', 'payments', 'audience', 'trash', 'activity', 'backups', 'scheduled', 'seo', 'health', 'newsletter']

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
  if (site.timeZone !== undefined && !isValidTimeZone(site.timeZone)) errors.push(`site.timeZone : fuseau horaire inconnu « ${site.timeZone} » (attendu un identifiant comme 'Europe/Paris')`)
  if (site.titleSuffix !== undefined && (typeof site.titleSuffix !== 'string' || !site.titleSuffix.trim())) errors.push('site.titleSuffix : un texte est attendu (ou rien)')
  if (site.shareImage !== undefined && !/^(\/[^/]|https?:\/\/)\S*$/.test(String(site.shareImage))) errors.push('site.shareImage : attendu un fichier du dossier public (\'/partage.jpg\') ou une adresse complète (https://…)')
  if (site.attribution !== undefined && site.attribution !== false) {
    const days = (site.attribution as { rememberDays?: unknown } | null)?.rememberDays
    if (!site.attribution || typeof site.attribution !== 'object' || (days !== undefined && (!Number.isInteger(days) || (days as number) < 1 || (days as number) > 395)))
      errors.push('site.attribution : attendu false, ou { rememberDays: n } avec n entre 1 et 395 jours')
  }
  if (site.description !== undefined && !(typeof site.description === 'string' ? site.description.trim() : site.description && typeof site.description === 'object' && Object.entries(site.description).every(([l, v]) => site.locales.includes(l) && typeof v === 'string' && !!v.trim())))
    errors.push('site.description : un texte est attendu, ou un texte par langue ({ fr: \'…\', en: \'…\' })')
  if (site.logo !== undefined && !/^(\/[^/]|https?:\/\/)\S*$/.test(String(site.logo))) errors.push('site.logo : attendu un fichier du dossier public (\'/logo.svg\') ou une adresse complète (https://…)')

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
      if (nested && field.section) errors.push(`${at} : pas de section dans un répéteur (ses éléments se replient déjà) ; rangez le répéteur entier dans une section`)
      if (field.type === 'image' || field.type === 'file') {
        const count = (k: 'min' | 'max') => field[k] === undefined || (Number.isInteger(field[k]) && (field[k] as number) >= 0)
        if (!field.multiple && (field.captions || field.min !== undefined || field.max !== undefined)) errors.push(`${at} : captions, min et max demandent multiple: true`)
        else if (!count('min') || !count('max')) errors.push(`${at} : min et max sont des nombres entiers positifs`)
        else if (field.min !== undefined && field.max !== undefined && (field.min as number) > (field.max as number)) errors.push(`${at} : min est plus grand que max`)
      }
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
    if (!nested) checkSections(where, fields)
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

  /** Sections : un titre, des réglages identiques sur tous leurs champs, et des champs qui se suivent. */
  function checkSections(where: string, fields: Fields) {
    const metas = new Map<string, Section>()
    const closed = new Set<string>()
    let current: string | null = null
    for (const [key, field] of Object.entries(fields)) {
      const meta = field.section as Section | undefined
      const label = meta === undefined ? null : meta && typeof meta === 'object' && typeof meta.label === 'string' && meta.label.trim() ? meta.label : ''
      if (label === '') { errors.push(`${where}.${key}.section : un titre est attendu (utilisez section({ label: '…' }, { … }))`); continue }
      if (label !== current) {
        if (current !== null) closed.add(current)
        if (label !== null && closed.has(label)) errors.push(`${where} : les champs de la section « ${label} » doivent se suivre (« ${key} » est séparé des autres)`)
        current = label
      }
      if (label === null) continue
      const known = metas.get(label)
      if (!known) metas.set(label, meta!)
      else if ((known.help ?? '') !== (meta!.help ?? '') || !!known.collapsed !== !!meta!.collapsed)
        errors.push(`${where}.${key}.section : la section « ${label} » est déclarée avec d'autres réglages (help, collapsed) plus haut`)
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
    if (def.search && !def.path) errors.push(`${key} : search exige path (la recherche du site mène à des pages)`)
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
    errors.push(...structuredDataErrors(key, def as never, site.locales))
    errors.push(...feedErrors(key, def as never, site.locales))
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
    if (thumb && def.fields[thumb]?.type !== 'image') errors.push(`${key}.list.thumbnail doit désigner un champ image (pour une galerie : sa première image)`)
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

/**
 * Fichier de la médiathèque tel que le site le reçoit. `focus` : point d'intérêt de l'image réglé dans la médiathèque
 * (`{ x, y }` entre 0 et 1 depuis la gauche et le haut ; `null` : le centre). `<CmsImage>` s'en sert tout seul pour ne pas
 * couper le sujet ; avec une balise `<img>` écrite à la main : `:style="{ objectPosition: cmsObjectPosition(photo) }"`.
 */
export type Media = { id: string; url: string; name: string; alt: string; mime: string; width: number | null; height: number | null; focus: { x: number; y: number } | null }
/** Image (ou fichier) d'une liste avec `captions` : le fichier, plus la légende propre à cet usage. */
export type CaptionedMedia = Media & { caption: string | null }
export type Link = { label: string; href: string; newTab: boolean }
export type EntryRef = { id: string; collection: string; title: string; slug: string | null }
/**
 * Référencement d'un contenu, tel que le site le reçoit. `useCmsSeo(entry)` s'en sert ; une page peut aussi le lire.
 * - `title` : titre pour les moteurs de recherche ; vaut le titre du contenu (`titleField`) quand il est laissé vide,
 *   `null` pour une page unique sans titre. Sans le suffixe du site (`site.titleSuffix`), que `useCmsSeo` ajoute ;
 * - `description` : `null` si elle est vide ;
 * - `shareTitle`, `shareDescription` : titre et description propres au partage (balises `og:` et `twitter:`), `null`
 *   quand ils sont laissés vides : `useCmsSeo` reprend alors le titre et la description ci-dessus ;
 * - `image` : image de partage du contenu, `null` s'il n'en a pas (`useCmsSeo` prend alors `site.shareImage`) ;
 * - `noindex` : page masquée des moteurs de recherche (et absente du plan du site).
 *
 * En base et dans l'API d'écriture, ces valeurs sont sous la clé `seo` : `title`, `description`, `shareTitle` et
 * `shareDescription` dans chaque langue, `image` et `noindex` dans les champs communs. Une clé absente est une valeur
 * vide : aucune migration quand une clé s'ajoute.
 */
export type Seo = {
  title: string | null
  description: string | null
  shareTitle: string | null
  shareDescription: string | null
  image: Media | null
  noindex: boolean
}

type Raw<F> =
  F extends { type: 'text' | 'textarea' | 'richText' | 'date' } ? string
  : F extends { type: 'number' } ? number
  : F extends { type: 'boolean' } ? boolean
  : F extends { type: 'select'; options: readonly { value: infer V }[] } ? (F extends { multiple: true } ? V[] : V)
  : F extends { type: 'image' | 'file' } ? (F extends { multiple: true } ? (F extends { captions: true } ? CaptionedMedia[] : Media[]) : Media)
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
 * | `image`, `file` avec `multiple`    | `[]`           | tableau de `Media`, dans l'ordre choisi  |
 * | … et `captions`                    | `[]`           | tableau de `Media & { caption }`         |
 * | `link`                             | `null`         | `Link`                                   |
 * | `relation`                         | `null`         | `EntryRef`                               |
 * | `relation` avec `multiple`         | `[]`           | tableau d'`EntryRef`                     |
 * | `repeater`                         | `[]`           | tableau d'objets, mêmes règles dedans    |
 *
 * Dans une page : `v-if="product.note"` suffit pour un texte ; `product.stock !== null` pour un nombre (0 compte) ;
 * `v-if="item.photos.length"` pour une galerie. Une légende vide vaut `null`. Un fichier supprimé de la médiathèque
 * disparaît de la liste (il ne laisse pas de trou).
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
  /**
   * Données structurées (JSON-LD) de la page : les blocs déclarés par `structuredData` dans cms.config.ts, l'organisme
   * sur la page d'accueil, et le fil d'Ariane. Présent quand on lit un seul contenu (`useEntry`, `useSingleton`), pas
   * dans les listes ni en aperçu. `useCmsSeo(entry)` les place dans la page.
   */
  structuredData?: Record<string, unknown>[]
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
