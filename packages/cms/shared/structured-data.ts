/**
 * Données structurées (JSON-LD, vocabulaire schema.org) : ce que le site dit de lui-même aux moteurs de recherche
 * dans un format qu'ils lisent sans deviner. Logique pure, partagée par le serveur (ce que reçoit le site), par
 * l'onglet Référencement (aperçu pendant la saisie) et par la validation de `cms.config.ts`.
 *
 * On déclare, sur un contenu, quels champs alimentent quel bloc :
 *
 *   articles: collection({
 *     …,
 *     structuredData: sd.article({ image: 'cover', datePublished: 'date', author: 'author' }),
 *   }),
 *   home: singleton({
 *     …,
 *     structuredData: sd.faq({ items: 'faq', question: 'question', answer: 'answer' }),
 *   }),
 *   settings: singleton({
 *     …,
 *     structuredData: sd.organization({ type: 'LegalService', telephone: 'phone', streetAddress: 'street', addressCountry: sd.value('FR') }),
 *   }),
 *
 * Le fil d'Ariane (`BreadcrumbList`) n'a rien à déclarer : il est déduit des adresses (voir `breadcrumbTrail`).
 * Rien n'est inventé : une propriété dont le champ est vide est simplement absente, et un bloc sans l'essentiel
 * (un article sans titre, une FAQ sans question) n'est pas émis.
 */
import type { AnyField } from './format'
import { htmlToText } from './site-search'

type Fields = Record<string, AnyField>
type Values = Record<string, unknown>

// ───────────────────────── Ce qu'on écrit dans cms.config.ts ─────────────────────────

/** D'où vient une propriété : le nom d'un champ du contenu, ou une valeur fixe (`sd.value('FR')`). */
export type FieldRef = string | { value: string }

export type ArticleSpec = {
  kind: 'article'
  /** Type schema.org. Défaut : 'Article'. */
  type: 'Article' | 'BlogPosting' | 'NewsArticle'
  /** Titre de l'article. Défaut : le titre du contenu (`titleField`). */
  headline?: FieldRef
  /** Résumé. Défaut : la description de l'onglet Référencement. */
  description?: FieldRef
  /** Champ image. Défaut : l'image de partage de l'onglet Référencement. */
  image?: string
  /** Champ date de parution. Défaut : la date de mise en ligne. */
  datePublished?: string
  /** Nom de l'auteur (une personne). Défaut : le site lui-même. */
  author?: FieldRef
}

export type FaqSpec = {
  kind: 'faq'
  /** Répéteur qui contient les questions, et ses sous-champs question et réponse. */
  items: string
  question: string
  answer: string
}

export type OrganizationSpec = {
  kind: 'organization'
  /**
   * Type schema.org : 'Organization', 'LocalBusiness' pour un commerce ou un cabinet qui reçoit du public, ou un
   * type plus précis ('LegalService', 'Restaurant', 'Dentist', 'Store'… : https://schema.org/LocalBusiness).
   */
  type: string
  /** Défaut : le nom du site (`site.name`). */
  name?: FieldRef
  description?: FieldRef
  telephone?: FieldRef
  email?: FieldRef
  /** Champs image. Le logo vaut par défaut `site.logo`. */
  logo?: string
  image?: string
  streetAddress?: FieldRef
  postalCode?: FieldRef
  addressLocality?: FieldRef
  addressRegion?: FieldRef
  /** Code du pays sur deux lettres : `sd.value('FR')`. */
  addressCountry?: FieldRef
  /** Niveau de prix, tel que Google l'affiche : '€€', ou une fourchette. */
  priceRange?: FieldRef
  /**
   * Pages du même organisme ailleurs (réseaux sociaux, annuaires) : un champ texte long, une adresse par ligne,
   * ou un répéteur et son sous-champ adresse (`{ items: 'socials', url: 'url' }`).
   */
  sameAs?: string | { items: string; url: string }
  /**
   * Horaires d'ouverture : un répéteur dont chaque élément a des jours (liste de choix multiple, voir `WEEKDAYS`),
   * une heure d'ouverture et une heure de fermeture ('09:00', '18:30').
   */
  openingHours?: { items: string; days: string; opens: string; closes: string }
}

export type StructuredDataSpec = ArticleSpec | FaqSpec | OrganizationSpec

/** Nom d'une page dans le fil d'Ariane : un texte, ou un texte par langue. */
export type BreadcrumbName = string | Record<string, string>

/** Jours de la semaine, pour la liste de choix des horaires : `f.select({ label: 'Jours', multiple: true, options: WEEKDAYS })`. */
export const WEEKDAYS = [
  { value: 'Monday', label: 'Lundi' }, { value: 'Tuesday', label: 'Mardi' }, { value: 'Wednesday', label: 'Mercredi' },
  { value: 'Thursday', label: 'Jeudi' }, { value: 'Friday', label: 'Vendredi' }, { value: 'Saturday', label: 'Samedi' }, { value: 'Sunday', label: 'Dimanche' },
] as const

/** Fabriques à utiliser dans `cms.config.ts` : `structuredData: sd.article({ … })`. */
export const sd = {
  /** Un article daté (actualité, billet de blog). */
  article: (options: Omit<ArticleSpec, 'kind' | 'type'> & { type?: ArticleSpec['type'] } = {}): ArticleSpec => ({ type: 'Article', ...options, kind: 'article' }),
  /** Des questions et leurs réponses, visibles sur la page. */
  faq: (options: Omit<FaqSpec, 'kind'>): FaqSpec => ({ ...options, kind: 'faq' }),
  /**
   * L'organisme derrière le site (entreprise, cabinet, commerce, association). À déclarer sur la page unique qui
   * porte ses coordonnées ; le bloc est émis sur la page d'accueil, et sur cette page si elle a une adresse.
   */
  organization: (options: Omit<OrganizationSpec, 'kind' | 'type'> & { type?: string } = {}): OrganizationSpec => ({ type: 'Organization', ...options, kind: 'organization' }),
  /** Une valeur fixe, à la place d'un champ : `addressCountry: sd.value('FR')`. */
  value: (value: string) => ({ value }),
}

/** Les blocs déclarés par un contenu, toujours sous forme de liste. */
export const specsOf = (def: { structuredData?: unknown }): StructuredDataSpec[] => {
  const raw = def.structuredData
  return (Array.isArray(raw) ? raw : raw ? [raw] : []) as StructuredDataSpec[]
}

// ───────────────────────── Validation de la configuration ─────────────────────────

const TEXTUAL = ['text', 'textarea', 'richText', 'number', 'select', 'date']
const SCHEMA_TYPE = /^[A-Z][A-Za-z]+$/
const ARTICLE_TYPES = ['Article', 'BlogPosting', 'NewsArticle']

/** Erreurs de la déclaration `structuredData` (et `breadcrumb`) d'un contenu, pour `defineCms`. */
export function structuredDataErrors(key: string, def: { kind: string; path?: string; fields: Fields; structuredData?: unknown; breadcrumb?: unknown }, locales: readonly string[]): string[] {
  const errors: string[] = []
  const at = `${key}.structuredData`
  const crumb = def.breadcrumb
  if (crumb !== undefined && crumb !== false) {
    const ok = typeof crumb === 'string' ? !!crumb.trim()
      : !!crumb && typeof crumb === 'object' && Object.entries(crumb).every(([l, v]) => locales.includes(l) && typeof v === 'string' && !!v.trim())
    if (!ok) errors.push(`${key}.breadcrumb : attendu false, un texte, ou un texte par langue ({ fr: 'Services', en: 'Services' })`)
  }
  const specs = specsOf(def)
  if (!specs.length) return errors
  // L'organisme peut être déclaré sur une page unique sans adresse (« Réglages du site ») : il est émis sur l'accueil.
  if (!def.path && specs.some(s => s?.kind !== 'organization')) { errors.push(`${at} exige path : un article ou une FAQ décrivent une page`); return errors }

  const fields = def.fields
  const ref = (name: string, value: unknown, types: string[] = TEXTUAL) => {
    if (value === undefined) return
    if (value && typeof value === 'object' && typeof (value as { value?: unknown }).value === 'string') return
    if (typeof value !== 'string' || !fields[value]) return void errors.push(`${at}.${name} : champ « ${String(value)} » introuvable (ou utilisez sd.value('…') pour une valeur fixe)`)
    if (!types.includes(fields[value]!.type)) errors.push(`${at}.${name} : le champ « ${value} » est de type ${fields[value]!.type} (attendu : ${types.join(', ')})`)
  }
  const field = (name: string, value: unknown, types: string[]) => {
    if (value === undefined) return
    if (typeof value !== 'string') return void errors.push(`${at}.${name} : le nom d'un champ est attendu`)
    ref(name, value, types)
  }
  const repeater = (name: string, items: unknown, subs: Record<string, [unknown, string[]]>) => {
    const list = typeof items === 'string' ? fields[items] : undefined
    if (!list || list.type !== 'repeater') return void errors.push(`${at}.${name}.items : un champ répéteur est attendu`)
    const inner = list.fields as Fields
    for (const [sub, [value, types]] of Object.entries(subs)) {
      const found = typeof value === 'string' ? inner[value] : undefined
      if (!found) errors.push(`${at}.${name}.${sub} : sous-champ « ${String(value)} » introuvable dans « ${items} »`)
      else if (!types.includes(found.type) || (sub === 'days' && !found.multiple)) errors.push(`${at}.${name}.${sub} : le sous-champ « ${value} » n'a pas le bon type (attendu : ${sub === 'days' ? 'select multiple' : types.join(', ')})`)
    }
  }

  const kinds = specs.map(s => s?.kind)
  if (new Set(kinds).size !== kinds.length) errors.push(`${at} : un même bloc est déclaré deux fois`)
  for (const spec of specs) {
    if (spec?.kind === 'article') {
      if (!ARTICLE_TYPES.includes(spec.type)) errors.push(`${at}.type : attendu ${ARTICLE_TYPES.join(', ')}`)
      ref('headline', spec.headline, ['text', 'textarea'])
      ref('description', spec.description, ['text', 'textarea', 'richText'])
      ref('author', spec.author, ['text', 'select'])
      field('image', spec.image, ['image'])
      field('datePublished', spec.datePublished, ['date'])
    }
    else if (spec?.kind === 'faq') {
      repeater('faq', spec.items, { question: [spec.question, ['text', 'textarea']], answer: [spec.answer, ['text', 'textarea', 'richText']] })
    }
    else if (spec?.kind === 'organization') {
      if (def.kind !== 'singleton') errors.push(`${at} : sd.organization() se déclare sur une page unique (celle qui porte les coordonnées)`)
      if (!SCHEMA_TYPE.test(String(spec.type))) errors.push(`${at}.type : un type schema.org est attendu ('Organization', 'LocalBusiness', 'LegalService'…)`)
      for (const name of ['name', 'description', 'telephone', 'email', 'streetAddress', 'postalCode', 'addressLocality', 'addressRegion', 'addressCountry', 'priceRange'] as const) ref(name, spec[name])
      field('logo', spec.logo, ['image'])
      field('image', spec.image, ['image'])
      if (spec.sameAs !== undefined) {
        if (typeof spec.sameAs === 'string') field('sameAs', spec.sameAs, ['textarea', 'text'])
        else repeater('sameAs', spec.sameAs?.items, { url: [spec.sameAs?.url, ['text', 'link']] })
      }
      if (spec.openingHours !== undefined) {
        const h = spec.openingHours
        repeater('openingHours', h?.items, { days: [h?.days, ['select']], opens: [h?.opens, ['text']], closes: [h?.closes, ['text']] })
      }
    }
    else errors.push(`${at} : bloc inconnu (utilisez sd.article(), sd.faq() ou sd.organization())`)
  }
  return errors
}

// ───────────────────────── Lecture des valeurs ─────────────────────────

const squash = (text: string) => text.replace(/\s+/g, ' ').trim()

/** Texte d'une valeur de champ, quel que soit son type ; vide si elle n'en a pas. */
function textOf(field: AnyField | undefined, value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return field?.type === 'richText' ? htmlToText(value) : squash(value)
  if (typeof value === 'object') {
    // Lien : tel que le site le reçoit ({ href }) ou tel qu'il est enregistré ({ kind: 'url', url }).
    const link = value as { href?: unknown; url?: unknown }
    return typeof link.href === 'string' ? link.href : typeof link.url === 'string' ? link.url : ''
  }
  return ''
}

const read = (ref: FieldRef | undefined, fields: Fields, values: Values) =>
  (ref === undefined ? '' : typeof ref === 'string' ? textOf(fields[ref], values[ref]) : squash(ref.value))

const rows = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is Values => !!v && typeof v === 'object') : [])

/** Retire les propriétés vides d'un bloc (texte vide, liste vide, objet réduit à son type). */
function compact<T extends Record<string, unknown>>(block: T): T {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(block)) {
    if (value == null || value === '') continue
    if (Array.isArray(value)) { if (value.length) out[key] = value; continue }
    if (typeof value === 'object') {
      const inner = compact(value as Record<string, unknown>)
      if (Object.keys(inner).some(k => !k.startsWith('@'))) out[key] = inner
      continue
    }
    out[key] = value
  }
  return out as T
}

// ───────────────────────── Blocs ─────────────────────────

export type JsonLd = Record<string, unknown>

/** Ce que les blocs ont besoin de savoir du site et de la page. */
export type StructuredContext = {
  site: { name: string; logo?: string }
  /** Adresse du site, sans barre finale ('https://cabinet-durand.fr'). */
  base: string
  locale: string
  /** Adresse d'une image à partir de la valeur d'un champ image (identifiant, ou fichier déjà résolu) ; null si elle manque. */
  imageUrl: (value: unknown) => string | null
}

export type StructuredPage = {
  url: string
  /** Titre et description de la page (onglet Référencement, sinon titre du contenu), sans le suffixe du site. */
  title: string
  description: string
  /** Image de partage du contenu (valeur du champ), s'il en a une. */
  image?: unknown
  publishedAt?: string | Date | null
  updatedAt?: string | Date | null
}

const absolute = (base: string, path: string) => (/^https?:\/\//.test(path) ? path : base + path)
const iso = (date: string | Date | null | undefined) => (date ? (date instanceof Date ? date.toISOString() : String(date)) : undefined)

function articleBlock(spec: ArticleSpec, def: { titleField?: string; fields: Fields }, values: Values, page: StructuredPage, ctx: StructuredContext): JsonLd | null {
  const headline = read(spec.headline ?? def.titleField, def.fields, values) || page.title
  if (!headline) return null
  const author = read(spec.author, def.fields, values)
  const image = ctx.imageUrl(spec.image ? values[spec.image] : undefined) ?? ctx.imageUrl(page.image)
  const logo = ctx.site.logo ? absolute(ctx.base, ctx.site.logo) : undefined
  return compact({
    '@type': spec.type,
    'headline': headline,
    'description': read(spec.description, def.fields, values) || page.description,
    'image': image ? [image] : [],
    'datePublished': (spec.datePublished && read(spec.datePublished, def.fields, values)) || iso(page.publishedAt),
    'dateModified': iso(page.updatedAt),
    'author': author ? { '@type': 'Person', 'name': author } : { '@type': 'Organization', 'name': ctx.site.name, 'url': ctx.base },
    'publisher': { '@type': 'Organization', 'name': ctx.site.name, 'logo': logo ? { '@type': 'ImageObject', 'url': logo } : undefined },
    'mainEntityOfPage': page.url,
    'inLanguage': ctx.locale,
  })
}

function faqBlock(spec: FaqSpec, def: { fields: Fields }, values: Values): JsonLd | null {
  const inner = (def.fields[spec.items]?.fields ?? {}) as Fields
  const questions = rows(values[spec.items]).flatMap((item) => {
    const name = textOf(inner[spec.question], item[spec.question])
    const raw = item[spec.answer]
    // La réponse peut garder sa mise en forme : Google accepte un HTML simple dans `text`.
    const text = inner[spec.answer]?.type === 'richText' && typeof raw === 'string' ? raw.trim() : textOf(inner[spec.answer], raw)
    return name && textOf(inner[spec.answer], raw) ? [{ '@type': 'Question', 'name': name, 'acceptedAnswer': { '@type': 'Answer', 'text': text } }] : []
  })
  return questions.length ? { '@type': 'FAQPage', 'mainEntity': questions } : null
}

const DAYS: Record<string, string> = {
  monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday', thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday', sunday: 'Sunday',
  mo: 'Monday', tu: 'Tuesday', we: 'Wednesday', th: 'Thursday', fr: 'Friday', sa: 'Saturday', su: 'Sunday',
  lundi: 'Monday', mardi: 'Tuesday', mercredi: 'Wednesday', jeudi: 'Thursday', vendredi: 'Friday', samedi: 'Saturday', dimanche: 'Sunday',
}
/** Heure telle qu'on la saisit ('9h', '9:00', '18h30') ramenée à 'HH:MM', ou null. */
export function normalizeTime(input: unknown): string | null {
  const match = /^\s*(\d{1,2})\s*(?:[:hH.]\s*(\d{2})?)?\s*$/.exec(String(input ?? ''))
  if (!match) return null
  const hours = Number(match[1]), minutes = Number(match[2] ?? 0)
  return hours <= 24 && minutes < 60 ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}` : null
}

function organizationBlock(spec: OrganizationSpec, def: { fields: Fields }, values: Values, ctx: StructuredContext): JsonLd {
  const get = (ref: FieldRef | undefined) => read(ref, def.fields, values)
  const hours = spec.openingHours
  const openingHours = hours
    ? rows(values[hours.items]).flatMap((item) => {
        const days = [item[hours.days]].flat().map(d => DAYS[String(d ?? '').toLowerCase()]).filter((d): d is string => !!d)
        const opens = normalizeTime(item[hours.opens]), closes = normalizeTime(item[hours.closes])
        return days.length && opens && closes ? [{ '@type': 'OpeningHoursSpecification', 'dayOfWeek': days, opens, closes }] : []
      })
    : []
  const same = spec.sameAs
  const sameAs = (typeof same === 'string'
    ? String(values[same] ?? '').split(/\s+/)
    : same ? rows(values[same.items]).map(item => textOf(undefined, item[same.url])) : [])
    .filter(url => /^https?:\/\/\S+$/.test(url))
  const logo = ctx.imageUrl(spec.logo ? values[spec.logo] : undefined) ?? (ctx.site.logo ? absolute(ctx.base, ctx.site.logo) : null)
  return compact({
    '@type': spec.type,
    '@id': `${ctx.base}/#organization`,
    'name': get(spec.name) || ctx.site.name,
    'url': ctx.base,
    'description': get(spec.description),
    'telephone': get(spec.telephone),
    'email': get(spec.email),
    'logo': logo,
    'image': ctx.imageUrl(spec.image ? values[spec.image] : undefined),
    'priceRange': get(spec.priceRange),
    'address': {
      '@type': 'PostalAddress',
      'streetAddress': get(spec.streetAddress),
      'postalCode': get(spec.postalCode),
      'addressLocality': get(spec.addressLocality),
      'addressRegion': get(spec.addressRegion),
      'addressCountry': get(spec.addressCountry),
    },
    'sameAs': [...new Set(sameAs)],
    'openingHoursSpecification': openingHours,
  })
}

/** Les blocs déclarés par un contenu, pour sa propre page (l'organisme n'y figure que si `organization` le demande). */
export function contentBlocks(def: { titleField?: string; fields: Fields; structuredData?: unknown }, values: Values, page: StructuredPage, ctx: StructuredContext, options: { organization?: boolean } = {}): JsonLd[] {
  const out: (JsonLd | null)[] = []
  for (const spec of specsOf(def)) {
    if (spec.kind === 'article') out.push(articleBlock(spec, def, values, page, ctx))
    else if (spec.kind === 'faq') out.push(faqBlock(spec, def, values))
    else if (spec.kind === 'organization' && options.organization !== false) out.push(organizationBlock(spec, def, values, ctx))
  }
  return out.filter((b): b is JsonLd => !!b)
}

// ───────────────────────── Fil d'Ariane ─────────────────────────

/** Adresses des pages au-dessus d'une adresse : '/services/droit' → ['/', '/services']. */
export function parentPaths(path: string): string[] {
  const parts = path.split('/').filter(Boolean)
  return parts.map((_, i) => '/' + parts.slice(0, i).join('/'))
}

/** Nom d'une page dans le fil d'Ariane : réglage `breadcrumb` (dans la langue, sinon la langue par défaut), sinon son nom dans le menu. */
export function breadcrumbName(def: { label: string; breadcrumb?: unknown }, locale: string, defaultLocale: string): string {
  const name = def.breadcrumb
  if (typeof name === 'string') return name
  if (name && typeof name === 'object') return (name as Record<string, string>)[locale] ?? (name as Record<string, string>)[defaultLocale] ?? def.label
  return def.label
}

export type Crumb = { name: string; url: string }

/**
 * Fil d'Ariane d'une page, déduit des adresses : pour '/services/droit-des-affaires', la page unique d'adresse '/',
 * puis celle d'adresse '/services', puis la page elle-même. Une page parente absente de la configuration, non
 * publiée dans cette langue (`isLive`) ou réglée sur `breadcrumb: false` est simplement sautée.
 * Liste vide si le fil n'aurait qu'un élément, ou si la page elle-même refuse le sien.
 */
export function breadcrumbTrail(input: {
  /** Définition de la page, son adresse sans préfixe de langue ('/services/droit'), et son nom. */
  def: { path?: string; breadcrumb?: unknown }
  path: string
  name: string
  url: string
  locale: string
  defaultLocale: string
  base: string
  /** Pages uniques du site, par identifiant. */
  singletons: Record<string, { label: string; path?: string; breadcrumb?: unknown }>
  isLive: (type: string) => boolean
}): Crumb[] {
  if (input.def.breadcrumb === false || !input.name) return []
  const prefix = input.locale === input.defaultLocale ? '' : `/${input.locale}`
  const trail: Crumb[] = []
  for (const parent of parentPaths(input.path)) {
    const found = Object.entries(input.singletons).find(([, def]) => def.path === parent)
    if (!found || found[1].breadcrumb === false || !input.isLive(found[0])) continue
    trail.push({ name: breadcrumbName(found[1], input.locale, input.defaultLocale), url: input.base + prefix + parent })
  }
  if (!trail.length) return []
  return [...trail, { name: input.name, url: input.url }]
}

export const breadcrumbBlock = (trail: Crumb[]): JsonLd | null => (trail.length < 2
  ? null
  : { '@type': 'BreadcrumbList', 'itemListElement': trail.map((crumb, i) => ({ '@type': 'ListItem', 'position': i + 1, 'name': crumb.name, 'item': crumb.url })) })

// ───────────────────────── Balise ─────────────────────────

/** Le contenu de la balise `<script type="application/ld+json">` : tous les blocs d'une page, dans un seul graphe. */
export function structuredDataJson(blocks: JsonLd[]): string | null {
  if (!blocks.length) return null
  // « < » est écrit autrement : un texte saisi ne peut pas fermer la balise.
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': blocks }).replace(/</g, '\\u003c')
}

// ───────────────────────── Aperçu dans le back-office ─────────────────────────

const BLOCK_LABELS: Record<string, string> = { FAQPage: 'Questions fréquentes', BreadcrumbList: 'Fil d\'Ariane', Article: 'Article', BlogPosting: 'Billet de blog', NewsArticle: 'Article d\'actualité' }

/** Ce qu'un bloc contient, en clair, pour l'onglet Référencement. */
export type BlockSummary = { type: string; label: string; lines: string[]; warnings: string[] }

/** Résumé lisible d'un bloc : ce que les moteurs de recherche y liront, et ce qui lui manque pour être utile. */
export function summarizeBlock(block: JsonLd): BlockSummary {
  const type = String(block['@type'])
  const lines: string[] = []
  const warnings: string[] = []
  if (type === 'FAQPage') {
    const questions = block.mainEntity as { name: string }[]
    lines.push(`${questions.length} question${questions.length > 1 ? 's' : ''} : ${questions.slice(0, 3).map(q => `« ${q.name} »`).join(', ')}${questions.length > 3 ? '…' : ''}`)
  }
  else if (type === 'BreadcrumbList') {
    lines.push((block.itemListElement as { name: string }[]).map(i => i.name).join(' › '))
  }
  else if ('headline' in block) {
    lines.push(`Titre : ${block.headline}`)
    if (block.datePublished) lines.push(`Date : ${String(block.datePublished).slice(0, 10)}`)
    lines.push(`Auteur : ${(block.author as { name: string }).name}`)
    if (!block.image) warnings.push('Pas d\'image : Google en demande une pour mettre un article en avant.')
  }
  else {
    const address = block.address as Record<string, string> | undefined
    lines.push(`Nom : ${block.name}`)
    if (address) lines.push(`Adresse : ${[address.streetAddress, [address.postalCode, address.addressLocality].filter(Boolean).join(' '), address.addressCountry].filter(Boolean).join(', ')}`)
    if (block.telephone) lines.push(`Téléphone : ${block.telephone}`)
    const hours = block.openingHoursSpecification as unknown[] | undefined
    if (hours?.length) lines.push(`Horaires : ${hours.length} plage${hours.length > 1 ? 's' : ''}`)
    if (type !== 'Organization' && !address?.streetAddress) warnings.push('Pas d\'adresse : un établissement qui reçoit du public doit en avoir une.')
    if (type !== 'Organization' && !block.telephone) warnings.push('Pas de téléphone.')
  }
  return { type, label: BLOCK_LABELS[type] ?? (type === 'Organization' ? 'Organisme' : `Établissement (${type})`), lines, warnings }
}
