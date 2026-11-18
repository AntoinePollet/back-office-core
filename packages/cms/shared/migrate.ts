/**
 * Migrations de contenu : faire suivre les données quand `cms.config.ts` change.
 *
 * Le principe : la base mémorise la dernière structure appliquée (un « instantané »). À chaque déploiement,
 * on compare la structure du fichier à cet instantané, on en déduit une liste d'opérations, puis on les
 * exécute sur les contenus. Tout ce fichier est fait de fonctions pures : aucune lecture ni écriture en base.
 *
 * Règle d'or : rien n'est jamais supprimé. Une valeur qui ne peut pas suivre (conversion impossible,
 * traduction devenue inutile, nom déjà occupé) est « mise de côté » sous la clé `_kept` du même objet JSON :
 * elle n'est plus affichée, mais elle reste en base.
 */
import { isEmpty } from './content'
import type { CmsConfig, FieldType } from './format'

type Json = Record<string, unknown>

/** Clé où sont rangées les valeurs mises de côté, dans chaque objet JSON de contenu (et chaque élément de répéteur). */
export const KEPT_KEY = '_kept'

// ───────────────────────── Structure ─────────────────────────

/** Ce que la migration a besoin de savoir d'un champ. `retired` : retiré du fichier, ses valeurs sont encore en base. */
export type FieldShape = {
  type: FieldType
  label: string
  localized: boolean
  multiple?: boolean
  retired?: boolean
  fields?: Record<string, FieldShape>
  /** Présents seulement dans la structure lue du fichier, jamais dans l'instantané. */
  renamedFrom?: string
  options?: string[]
}

export type TypeShape = {
  kind: 'singleton' | 'collection'
  label: string
  retired?: boolean
  fields: Record<string, FieldShape>
  renamedFrom?: string
}

/** Structure des contenus : celle du fichier (avec `renamedFrom`), ou l'instantané mémorisé en base (sans). */
export type Snapshot = { types: Record<string, TypeShape> }

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
/** Écriture canonique : deux objets aux mêmes valeurs sont égaux quel que soit l'ordre de leurs clés. */
const canon = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(canon).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon((v as Json)[k])).join(',')}}`
  : JSON.stringify(v ?? null)
const same = (a: unknown, b: unknown) => canon(a) === canon(b)
const isObject = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v)

function fieldShape(field: Record<string, any>, localized: boolean): FieldShape {
  const out: FieldShape = { type: field.type, label: field.label, localized }
  if (field.multiple) out.multiple = true
  if (field.renamedFrom) out.renamedFrom = field.renamedFrom
  if (field.type === 'select') out.options = (field.options as { value: string }[]).map(o => o.value)
  if (field.type === 'repeater')
    out.fields = Object.fromEntries(Object.entries(field.fields as Record<string, any>).map(([k, sub]) => [k, fieldShape(sub, localized)]))
  return out
}

/** Structure décrite par le fichier de configuration (le résultat de `defineCms`). */
export function shapeOf(config: CmsConfig): Snapshot {
  const types: Snapshot['types'] = {}
  for (const [key, def] of [...Object.entries(config.singletons ?? {}), ...Object.entries(config.collections ?? {})]) {
    types[key] = {
      kind: def.kind,
      label: def.label,
      fields: Object.fromEntries(Object.entries(def.fields).map(([k, field]) => [k, fieldShape(field, !!field.localized)])),
    }
    if (def.renamedFrom) types[key]!.renamedFrom = def.renamedFrom
  }
  return { types }
}

/** Empreinte d'une structure : change dès que le fichier change quelque chose qui intéresse la migration. */
export function hashOf(shape: Snapshot): string {
  const text = JSON.stringify(shape)
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(16).padStart(8, '0') + '-' + text.length.toString(36)
}

/** Retire ce qui ne se mémorise pas (`renamedFrom`, choix des listes). */
function stored<T extends FieldShape | TypeShape>(shape: T): T {
  const { renamedFrom: _r, options: _o, ...rest } = shape as FieldShape
  const out = rest as FieldShape
  if (out.fields) out.fields = Object.fromEntries(Object.entries(out.fields).map(([k, f]) => [k, stored(f)]))
  return out as T
}

type Level = Record<string, FieldShape | TypeShape>

/** Un `renamedFrom` n'est suivi que s'il désigne un nom libre, et un ancien nom ne sert qu'une fois (`validate` refuse déjà le contraire). */
function renameSource(key: string, shape: { renamedFrom?: string }, target: Level, claimed: Set<string>) {
  const from = shape.renamedFrom
  return from && from !== key && !(from in target) && !claimed.has(from) ? from : null
}

/**
 * Structure supposée d'un site qui n'a encore jamais mémorisé la sienne : celle du fichier, où chaque
 * `renamedFrom` est considéré comme pas encore appliqué. Les données diront s'il reste quelque chose à déplacer.
 */
export function assumedBaseline(target: Snapshot): Snapshot {
  const undo = <T extends FieldShape | TypeShape>(level: Record<string, T>): Record<string, T> => {
    const out: Record<string, T> = {}
    const claimed = new Set<string>()
    for (const [key, shape] of Object.entries(level)) {
      const from = renameSource(key, shape, level, claimed)
      if (from) claimed.add(from)
      const copy = stored(clone(shape))
      if (shape.fields) copy.fields = undo(shape.fields)
      out[from ?? key] = copy
    }
    return out
  }
  return { types: undo(target.types) }
}

// ───────────────────────── Opérations ─────────────────────────

export type OpKind = 'add' | 'remove' | 'restore' | 'rename' | 'kind' | 'localized' | 'convert' | 'meta'

/**
 * Une différence entre l'instantané et le fichier.
 * `path` : [type], [type, champ] ou [type, répéteur, sous-champ], avec les noms du fichier
 * (pour `remove`, les anciens noms). Les opérations sont ordonnées : parents avant enfants.
 */
export type Op = {
  id: string
  kind: OpKind
  path: string[]
  /** Libellés des éléments de `path`, pour les messages. */
  labels: string[]
  /** rename : ancien nom. */
  from?: string
  /** Champ : ses valeurs sont dans la partie traduite (true) ou commune (false) au moment où l'opération s'exécute. */
  localized?: boolean
  /** Forme avant (rename, convert, kind, remove) et après (add, convert, localized, kind, meta). */
  before?: FieldShape | TypeShape
  after?: FieldShape | TypeShape
}

function makeOp(kind: OpKind, path: string[], labels: string[], more: Partial<Op> = {}): Op {
  return { id: `${kind}:${path.join('.')}${more.from ? `:${more.from}` : ''}`, kind, path, labels, ...more }
}

/** Compare l'instantané à la structure du fichier. Aucune opération : les deux sont identiques. */
export function diffSchema(base: Snapshot, target: Snapshot): Op[] {
  const ops: Op[] = []

  const level = (baseLevel: Level, targetLevel: Level, path: string[], labels: string[], parentLocalized?: boolean) => {
    const claimed = new Set<string>()
    const kept = new Set<string>()
    const compare: (() => void)[] = []
    for (const [key, after] of Object.entries(targetLevel)) {
      const at = [...path, key]
      const names = [...labels, after.label]
      const isField = path.length > 0
      const where = isField ? { localized: parentLocalized ?? (after as FieldShape).localized } : {}
      let before = baseLevel[key]
      const from = !before || before.retired ? renameSource(key, after, targetLevel, claimed) : null
      if (from && baseLevel[from]) {
        // Les données suivent l'ancien nom. Elles sont là où l'ancien champ les rangeait.
        before = baseLevel[from]!
        claimed.add(from)
        ops.push(makeOp('rename', at, names, { from, before: stored(clone(before)), ...(isField ? { localized: parentLocalized ?? (before as FieldShape).localized } : {}) }))
      }
      else if (!before) {
        ops.push(makeOp('add', at, names, { after: stored(clone(after)), ...where }))
        continue
      }
      else if (before.retired) ops.push(makeOp('restore', at, names, where))
      kept.add(from && baseLevel[from] ? from : key)

      const b = before
      if (b.label !== after.label) ops.push(makeOp('meta', at, names, { after: stored(clone(after)) }))
      if (!isField) {
        const [tb, ta] = [b as TypeShape, after as TypeShape]
        if (tb.kind !== ta.kind) ops.push(makeOp('kind', at, names, { before: stored(clone(tb)), after: stored(clone(ta)) }))
        compare.push(() => level(tb.fields, ta.fields, at, names))
        continue
      }
      const [fb, fa] = [b as FieldShape, after as FieldShape]
      if (parentLocalized === undefined && fb.localized !== fa.localized)
        ops.push(makeOp('localized', at, names, { after: stored(clone(fa)) }))
      if (fb.type !== fa.type || !!fb.multiple !== !!fa.multiple)
        // `after` garde les choix d'une liste : la conversion en a besoin.
        ops.push(makeOp('convert', at, names, { before: stored(clone(fb)), after: { ...stored(clone(fa)), ...(fa.options ? { options: fa.options } : {}) }, ...where }))
      else if (fa.type === 'repeater')
        compare.push(() => level(fb.fields ?? {}, fa.fields ?? {}, at, names, fa.localized))
    }
    for (const [key, before] of Object.entries(baseLevel)) {
      if (before.retired || kept.has(key) || key in targetLevel) continue
      ops.push(makeOp('remove', [...path, key], [...labels, before.label], {
        before: stored(clone(before)), ...(path.length ? { localized: parentLocalized ?? (before as FieldShape).localized } : {}),
      }))
    }
    // Les enfants après tout le niveau : un parent est toujours traité avant ses sous-éléments.
    for (const run of compare) run()
  }

  level(base.types, target.types, [], [])
  return ops
}

/** Reporte une opération exécutée dans l'instantané. Modifie `snapshot`. */
export function applyToSnapshot(snapshot: Snapshot, op: Op): Snapshot {
  let level: Level = snapshot.types
  for (const key of op.path.slice(0, -1)) level = (level[key]!.fields ??= {})
  const key = op.path.at(-1)!
  const current = level[key]
  switch (op.kind) {
    case 'add': level[key] = clone(op.after!); break
    case 'remove': if (current) current.retired = true; break
    case 'restore': if (current) delete current.retired; break
    case 'rename': {
      const moved = level[op.from!]
      if (moved) { delete level[op.from!]; delete moved.retired; level[key] = moved }
      break
    }
    case 'kind': (current as TypeShape).kind = (op.after as TypeShape).kind; break
    case 'meta': current!.label = op.after!.label; break
    case 'localized': {
      const field = current as FieldShape
      field.localized = (op.after as FieldShape).localized
      for (const sub of Object.values(field.fields ?? {})) sub.localized = field.localized
      break
    }
    case 'convert': {
      const [field, after] = [current as FieldShape, stored(clone(op.after as FieldShape))]
      field.type = after.type
      if (after.multiple) field.multiple = true
      else delete field.multiple
      if (after.fields) field.fields = after.fields
      else delete field.fields
      break
    }
  }
  return snapshot
}

// ───────────────────────── Conversion des valeurs ─────────────────────────

type Kind = { type: FieldType; multiple?: boolean; options?: string[] }
/** ok : rien n'est perdu. lossy : converti, mais une partie est perdue (l'original est mis de côté). fail : pas de conversion. */
export type Conversion = { result: 'ok' | 'lossy'; value: unknown } | { result: 'fail' }

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': '\'', '&nbsp;': ' ' }

/** Texte simple → HTML : tout est échappé, une ligne vide sépare deux paragraphes. */
export function textToHtml(text: string): string {
  return text.replace(/\r\n?/g, '\n').split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
    .map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('')
}

/** HTML → texte simple : les balises disparaissent, les paragraphes deviennent des lignes. */
export function htmlToText(html: string): string {
  return html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|h[1-6]|li|blockquote|ul|ol)>/gi, '\n\n').replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, e => ENTITIES[e]!)
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

const oneLine = (text: string) => text.replace(/\s*[\r\n]+\s*/g, ' ').trim()

/**
 * Convertit une valeur d'un type de champ vers un autre. Les conversions acceptées :
 * texte court ↔ texte long ↔ texte mis en forme, nombre/date/choix → texte, texte → nombre/date/choix quand
 * la valeur s'y prête, image → fichier, choix unique ↔ choix multiple. Tout le reste : pas de conversion.
 */
export function convertValue(from: Kind, to: Kind, value: unknown): Conversion {
  if (isEmpty(value)) return { result: 'ok', value }
  const ok = (v: unknown): Conversion => ({ result: 'ok', value: v })
  const lossy = (v: unknown): Conversion => ({ result: 'lossy', value: v })
  const fail: Conversion = { result: 'fail' }

  if (from.type === to.type) {
    if (from.type !== 'select' && from.type !== 'relation') return fail // un répéteur ne change pas de forme
    const list = Array.isArray(value) ? value : [value]
    if (to.multiple) return ok(list)
    return list.length === 1 ? ok(list[0]) : lossy(list[0])
  }
  if (from.multiple || from.type === 'repeater' || to.type === 'repeater') return fail
  const text = typeof value === 'string' ? value : null
  // Vers une liste de choix multiple, la valeur convertie devient une liste d'un élément.
  const choice = (v: string): Conversion => (to.options?.includes(v) ? ok(to.multiple ? [v] : v) : fail)
  if (to.multiple && to.type !== 'select') return fail

  switch (`${from.type}>${to.type}`) {
    case 'text>textarea': return text === null ? fail : ok(text)
    case 'textarea>text': return text === null ? fail : /[\r\n]/.test(text) ? lossy(oneLine(text)) : ok(text)
    case 'text>richText':
    case 'textarea>richText': return text === null ? fail : ok(textToHtml(text))
    case 'richText>text':
    case 'richText>textarea': {
      if (text === null) return fail
      const plain = htmlToText(text)
      // Sans autre balise que des paragraphes et des retours à la ligne, rien n'est perdu.
      const formatted = /<(?!\/?(p|br)\b)[^>]*>/i.test(text)
      if (to.type === 'textarea') return formatted ? lossy(plain) : ok(plain)
      return formatted || plain.includes('\n') ? lossy(oneLine(plain)) : ok(plain)
    }
    case 'number>text':
    case 'number>textarea': return typeof value === 'number' ? ok(String(value)) : fail
    case 'text>number': {
      // Un nombre écrit sans ambiguïté : « 1250 », « 12,5 », « 1 250,50 ». Un zéro en tête (code postal, téléphone) n'en est pas un.
      const trimmed = (text ?? '').trim()
      if (!/^-?(0|[1-9]\d*|[1-9]\d{0,2}([ \u00A0\u202F]\d{3})+)([.,]\d+)?$/.test(trimmed)) return fail
      return ok(Number(trimmed.replace(/[ \u00A0\u202F]/g, '').replace(',', '.')))
    }
    case 'date>text':
    case 'date>textarea':
    case 'select>text':
    case 'select>textarea': return text === null ? fail : ok(text)
    case 'text>date': return text !== null && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/.test(text.trim()) ? ok(text.trim()) : fail
    case 'text>select': return text === null ? fail : choice(text.trim())
    case 'image>file': return text === null ? fail : ok(text)
    default: return fail
  }
}

// ───────────────────────── Exécution sur les contenus ─────────────────────────

type Part = { draft: Json; published: Json | null }
/** Un contenu complet : sa partie commune et une ligne par langue, en brouillon et en version publiée. */
export type Doc = { id: string; type: string; shared: Part; locales: (Part & { locale: string; status: string })[]; gone?: boolean }

export type Site = { locales: readonly string[]; defaultLocale: string }

/**
 * Jusqu'où une opération a le droit d'aller :
 * - strict : seulement ce qui ne perd et ne met rien de côté ;
 * - confirmed : accepte de mettre de côté ce qui n'a plus sa place (traductions, mise en forme) ;
 * - full : applique aussi le choix fait par l'administrateur sur un point bloqué.
 */
export type Mode = 'strict' | 'confirmed' | 'full'

/** Nombre de contenus concernés par une opération, par nature d'effet. */
export type Stats = {
  /** Contenus dont les données changent. */
  entries: number
  /** Contenus où le nouveau nom porte déjà une autre valeur. */
  conflicts: number
  /** Contenus dont la valeur est convertie avec une perte (l'original est mis de côté). */
  lossy: number
  /** Contenus dont la valeur ne se convertit pas. */
  failed: number
  /** Contenus dont les langues n'ont pas toutes la même valeur. */
  differing: number
  /** Contenus existants concernés, même sans changement (champ retiré, type retiré). */
  present: number
}

type Counter = Record<keyof Stats, Set<string>>
const counter = (): Counter => ({ entries: new Set(), conflicts: new Set(), lossy: new Set(), failed: new Set(), differing: new Set(), present: new Set() })
const count = (c: Counter): Stats => Object.fromEntries(Object.entries(c).map(([k, set]) => [k, set.size])) as Stats

/** Range une valeur de côté, sans jamais écraser une valeur déjà rangée. */
export function keepAside(obj: Json, key: string, value: unknown) {
  if (isEmpty(value)) return
  const box = (isObject(obj[KEPT_KEY]) ? obj[KEPT_KEY] : (obj[KEPT_KEY] = {})) as Json
  let name = key
  for (let n = 2; name in box && !same(box[name], value); n++) name = `${key}~${n}`
  box[name] = value
}

const parts = (doc: Doc, localized: boolean): Part[] => (localized ? doc.locales : [doc.shared])
const versions = (part: Part): Json[] => (part.published ? [part.draft, part.published] : [part.draft])

/** Objets JSON qui portent le champ visé par une opération : parties du contenu, ou éléments d'un répéteur. */
function holders(doc: Doc, op: Op): Json[] {
  const top = parts(doc, !!op.localized).flatMap(versions)
  if (op.path.length === 2) return top
  return top.flatMap(obj => (Array.isArray(obj[op.path[1]!]) ? (obj[op.path[1]!] as unknown[]).filter(isObject) : []))
}

const isBlank = (doc: Doc) => !doc.locales.length && !doc.shared.published && isEmpty({ ...doc.shared.draft, [KEPT_KEY]: null })

/** Parcourt toute une valeur JSON et appelle `visit` sur chaque objet. */
function deep(value: unknown, visit: (obj: Json) => void) {
  if (Array.isArray(value)) for (const v of value) deep(v, visit)
  else if (isObject(value)) { visit(value); for (const v of Object.values(value)) deep(v, visit) }
}

/** État attendu d'une langue publiée : « publié » si rien ne diffère du brouillon, sinon « modifié ». */
const statusOf = (doc: Doc, row: Part) => (same(row.draft, row.published) && same(doc.shared.draft, doc.shared.published) ? 'published' : 'changed')

function runOp(docs: Doc[], op: Op, mode: Mode, site: Site): { stats: Stats; blocked: boolean } {
  const c = counter()
  let blocked = false
  const [type, key] = [op.path[0]!, op.path.at(-1)!]
  const mine = docs.filter(d => !d.gone && d.type === (op.path.length === 1 && op.kind === 'rename' ? op.from : type))

  if (op.path.length === 1) {
    for (const doc of mine) c.present.add(doc.id)
    if (op.kind === 'kind' && mine.length && mode !== 'full') blocked = true
    if (op.kind === 'rename' && mine.length) {
      const occupied = docs.filter(d => !d.gone && d.type === type)
      // Un singleton ouvert une fois dans le back-office existe déjà, vide : il ne compte pas.
      const real = occupied.filter(d => !isBlank(d))
      if (real.length) { for (const d of real) c.conflicts.add(d.id); blocked = true }
      else {
        for (const d of occupied) d.gone = true
        const single = (op.before as TypeShape).kind === 'singleton'
        for (const doc of mine) { doc.type = type; c.entries.add(doc.id) }
        // Les liens enregistrés nomment le type de leur cible (et, pour un singleton, son identifiant).
        for (const doc of docs) {
          deep([doc.shared, doc.locales], (obj) => {
            if (obj.kind !== 'page' || obj.type !== op.from) return
            obj.type = type
            if (single && obj.id === op.from) obj.id = type
            c.entries.add(doc.id)
          })
        }
      }
    }
    return { stats: count(c), blocked }
  }

  for (const doc of mine) {
    if (op.kind === 'remove') {
      if (holders(doc, op).some(obj => !isEmpty(obj[key]))) c.present.add(doc.id)
    }
    else if (op.kind === 'rename') {
      for (const obj of holders(doc, op)) {
        const from = op.from!
        if (!(from in obj)) continue
        const old = obj[from]
        if (!isEmpty(old) && !isEmpty(obj[key]) && !same(old, obj[key])) {
          c.conflicts.add(doc.id)
          if (mode !== 'full') { blocked = true; continue }
          keepAside(obj, from, old)
        }
        else if (!isEmpty(old)) { obj[key] = old; c.entries.add(doc.id) }
        delete obj[from]
      }
    }
    else if (op.kind === 'convert') {
      const [from, to] = [op.before as FieldShape, op.after as FieldShape]
      for (const obj of holders(doc, op)) {
        if (!(key in obj) || isEmpty(obj[key])) continue
        const conv = convertValue(from, to, obj[key])
        if (conv.result === 'ok') { if (!same(conv.value, obj[key])) c.entries.add(doc.id); obj[key] = conv.value; continue }
        c[conv.result === 'lossy' ? 'lossy' : 'failed'].add(doc.id)
        if (mode === 'strict' || (conv.result === 'fail' && mode !== 'full')) { blocked = true; continue }
        keepAside(obj, key, obj[key])
        if (conv.result === 'lossy') obj[key] = conv.value
        else delete obj[key]
        c.entries.add(doc.id)
      }
    }
    else if (op.kind === 'localized') {
      const before = doc.locales.map(row => (row.published ? statusOf(doc, row) : null))
      const toShared = !(op.after as FieldShape).localized
      for (const version of ['draft', 'published'] as const) {
        const rows = [...doc.locales].filter(r => r[version])
          .sort((a, b) => Number(b.locale === site.defaultLocale) - Number(a.locale === site.defaultLocale) || site.locales.indexOf(a.locale) - site.locales.indexOf(b.locale))
        if (toShared) {
          // Traduit → commun : la langue principale fait foi ; si elle est vide, la première langue remplie.
          const source = rows.find(r => !isEmpty(r[version]![key]))
          if (!source) { for (const r of rows) delete r[version]![key]; continue }
          const shared = (doc.shared[version] ??= {})
          const value = isEmpty(shared[key]) ? source[version]![key] : shared[key]
          const others = rows.filter(r => !isEmpty(r[version]![key]) && !same(r[version]![key], value))
          if (others.length) {
            c.differing.add(doc.id)
            if (mode === 'strict') { blocked = true; continue }
          }
          shared[key] = value
          for (const r of rows) {
            if (others.includes(r)) keepAside(r[version]!, key, r[version]![key])
            delete r[version]![key]
          }
          c.entries.add(doc.id)
        }
        else {
          // Commun → traduit : la valeur est recopiée dans chaque langue existante, puis retirée de la partie commune.
          const shared = doc.shared[version]
          if (!shared || !(key in shared) || !rows.length) continue
          for (const r of rows) if (isEmpty(r[version]![key])) r[version]![key] = shared[key]
          if (!isEmpty(shared[key])) c.entries.add(doc.id)
          delete shared[key]
        }
      }
      // L'état « publié / modifié » se déduit de la comparaison brouillon-publié : on le garde cohérent.
      doc.locales.forEach((row, i) => {
        const after = row.published ? statusOf(doc, row) : null
        if (after && before[i] && after !== before[i]) row.status = after
      })
    }
  }
  return { stats: count(c), blocked }
}

const isPrefix = (a: string[], b: string[]) => a.length <= b.length && a.every((x, i) => x === b[i])

/**
 * Exécute des opérations, dans l'ordre, sur une copie des contenus.
 * `modeOf` renvoie null pour une opération à ne pas exécuter. Une opération dont un parent n'a pas été
 * exécuté attend (`waiting`). Une opération qui bute sur une donnée est annulée en entier (`blocked`).
 */
export function execute(input: Doc[], ops: Op[], modeOf: (op: Op) => Mode | null, site: Site) {
  let docs = clone(input)
  const stats = new Map<string, Stats>()
  const applied: Op[] = []
  const waiting = new Set<string>()
  const skipped: Op[] = []
  for (const op of ops) {
    const mode = modeOf(op)
    const parent = skipped.find(s => isPrefix(s.path, op.path))
    if (mode === null || parent) {
      if (parent) waiting.add(op.id)
      skipped.push(op)
      continue
    }
    const backup = clone(docs)
    const result = runOp(docs, op, mode, site)
    stats.set(op.id, result.stats)
    if (result.blocked) { docs = backup; skipped.push(op) }
    else applied.push(op)
  }
  return { docs, stats, applied, waiting }
}

// ───────────────────────── Plan : ce qui est automatique, à valider, bloqué ─────────────────────────

/**
 * - auto : sans risque, appliqué tout seul au premier accès après le déploiement ;
 * - confirm : appliqué quand un administrateur valide ;
 * - blocked : demande un choix explicite (`choices`), ou une correction du fichier s'il n'y a pas de choix ;
 * - waiting : dépend d'un point qui n'est pas encore réglé.
 */
export type OpLevel = 'auto' | 'confirm' | 'blocked' | 'waiting'
export type Choice = { id: string; label: string; help: string }
export type PlannedOp = { op: Op; level: OpLevel; stats: Stats; title: string; text: string; warning?: string; choices: Choice[] }

export type PlanOptions = {
  site: Site
  /** Première fois : aucune structure n'était mémorisée, aucun déplacement de données n'est automatique. */
  firstRun?: boolean
  /** Opérations retenues lors de cette première fois : elles attendent une validation tant qu'elles ne sont pas faites. */
  held?: readonly string[]
  /** Identifiants des opérations que l'administrateur a validées. */
  confirmed?: readonly string[]
  /** Choix de l'administrateur sur les points bloqués : { identifiant de l'opération: identifiant du choix }. */
  choices?: Record<string, string>
}

const EMPTY: Stats = { entries: 0, conflicts: 0, lossy: 0, failed: 0, differing: 0, present: 0 }

function levelOf(op: Op, s: Stats, held: boolean): OpLevel {
  const moves = s.entries > 0
  switch (op.kind) {
    case 'rename': return s.conflicts ? 'blocked' : moves && held ? 'confirm' : 'auto'
    case 'kind': return s.present ? 'blocked' : 'auto'
    case 'localized': return s.differing ? 'confirm' : 'auto'
    case 'convert': return s.failed ? 'blocked' : s.lossy ? 'confirm' : 'auto'
    default: return 'auto'
  }
}

/** Examine les contenus et classe chaque opération. Ne modifie rien. */
export function planMigration(docs: Doc[], ops: Op[], options: PlanOptions): PlannedOp[] {
  // Répétition générale : tout est exécuté au plus large, pour compter ce que chaque opération rencontrerait.
  const trial = execute(docs, ops, () => 'full', options.site)
  return ops.map((op) => {
    const stats = trial.stats.get(op.id) ?? EMPTY
    const level = trial.waiting.has(op.id) ? 'waiting' : levelOf(op, stats, !!options.firstRun || !!options.held?.includes(op.id))
    return { op, level, stats, ...describe(op, stats, level, options.site) }
  })
}

/**
 * Exécute ce qui peut l'être : tout ce qui est automatique, plus ce que l'administrateur a validé.
 * Renvoie les contenus transformés, les opérations exécutées et l'instantané mis à jour.
 */
export function runMigration(docs: Doc[], base: Snapshot, ops: Op[], options: PlanOptions) {
  const plan = planMigration(docs, ops, options)
  const confirmed = new Set(options.confirmed ?? [])
  const modeOf = (op: Op): Mode | null => {
    const planned = plan.find(p => p.op.id === op.id)!
    if (planned.level === 'auto' || planned.level === 'waiting') return 'strict'
    if (!confirmed.has(op.id)) return null
    if (planned.level === 'confirm') return 'confirmed'
    return planned.choices.some(c => c.id === options.choices?.[op.id]) ? 'full' : null
  }
  const result = execute(docs, ops, modeOf, options.site)
  const snapshot = clone(base)
  for (const op of result.applied) applyToSnapshot(snapshot, op)
  const done = new Set(result.applied.map(o => o.id))
  return {
    docs: result.docs,
    snapshot,
    applied: plan.filter(p => done.has(p.op.id)),
    pending: plan.filter(p => !done.has(p.op.id)),
    /** Renommages de collection ou de singleton exécutés, dans l'ordre. */
    typeRenames: result.applied.filter(o => o.kind === 'rename' && o.path.length === 1)
      .map(o => ({ from: o.from!, to: o.path[0]!, singleton: (o.before as TypeShape).kind === 'singleton' })),
  }
}

/** Valeurs d'un objet JSON que le formulaire ne connaît pas (champs retirés, valeurs mises de côté) : à conserver à l'enregistrement. */
export function unknownValues(known: Record<string, unknown>, previous: Json | null | undefined, system: string[] = []): Json {
  return Object.fromEntries(Object.entries(previous ?? {}).filter(([key]) => !(key in known) && !system.includes(key)))
}

// ───────────────────────── Messages, en langage clair ─────────────────────────

const TYPE_NAMES: Record<FieldType, string> = {
  text: 'texte court', textarea: 'texte long', richText: 'texte mis en forme', number: 'nombre', boolean: 'interrupteur',
  date: 'date', select: 'liste de choix', image: 'image', file: 'fichier', link: 'lien', relation: 'lien vers un contenu', repeater: 'liste d\'éléments',
}
const typeName = (shape: FieldShape) =>
  TYPE_NAMES[shape.type] + (shape.type === 'select' || shape.type === 'relation' ? (shape.multiple ? ' (plusieurs choix)' : ' (un seul choix)') : '')

const n = (count: number, one = 'contenu', many = 'contenus') => `${count} ${count > 1 ? many : one}`

function describe(op: Op, s: Stats, level: OpLevel, site: Site): Pick<PlannedOp, 'title' | 'text' | 'warning' | 'choices'> {
  const isType = op.path.length === 1
  const name = `« ${op.labels.at(-1)} »`
  const owner = op.labels.slice(0, -1).join(' › ')
  const subject = isType ? name : `Le champ ${name} (${owner})`
  const title = isType ? op.labels[0]! : `${owner} › ${op.labels.at(-1)}`
  const out = (text: string, warning?: string, choices: Choice[] = []) => ({ title, text, ...(warning ? { warning } : {}), choices })
  if (level === 'waiting') return out(`${subject} : ce changement sera traité une fois le point précédent réglé.`)

  switch (op.kind) {
    case 'add': return out(isType ? `Nouveau type de contenu ${name}.` : `Nouveau champ ${name}, vide pour l'instant.`)
    case 'restore': return out(`${subject} est de retour dans la configuration : ses anciennes valeurs réapparaissent.`)
    case 'meta': return out(`${subject} a changé de libellé.`)
    case 'remove': return out(isType
      ? `${name} n'est plus dans la configuration. ${s.present > 1 ? `Ses ${s.present} contenus restent en base, mais ne sont plus affichés.` : s.present ? 'Son contenu reste en base, mais n\'est plus affiché.' : 'Il n\'avait aucun contenu.'}`
      : `${subject} n'est plus dans la configuration. ${s.present ? `Ses valeurs (${n(s.present)}) restent en base, mais ne sont plus affichées.` : 'Il était vide.'}`)
    case 'kind': return out(
      `${name} n'est plus ${(op.before as TypeShape).kind === 'singleton' ? 'une page unique mais une collection' : 'une collection mais une page unique'}.`,
      s.present ? `${n(s.present, 'contenu existe', 'contenus existent')} sous l'ancienne forme et ne peuvent pas être repris automatiquement.` : undefined,
      s.present ? [{ id: 'accept', label: 'Continuer sans reprendre les contenus', help: 'Ils restent en base, mais ne seront plus affichés sous cette forme.' }] : [])
    case 'rename':
      if (isType) return out(
        `${name} a changé d'identifiant (${op.from} → ${op.path[0]}). ${s.entries ? `Tout suit sous le nouvel identifiant : contenus, adresses, redirections et liens qui pointent vers eux (${n(s.entries, 'contenu concerné', 'contenus concernés')}).` : 'Aucun contenu à déplacer.'}`,
        s.conflicts ? `Des contenus existent déjà sous le nouvel identifiant (${s.conflicts}). Les deux ensembles ne peuvent pas être fusionnés automatiquement : supprimez ceux qui sont en trop, ou faites retirer « renamedFrom » du fichier de configuration pour laisser les anciens de côté.` : undefined)
      return out(
        `${subject} a changé de nom interne (${op.from} → ${op.path.at(-1)}). ${s.entries ? `Ses valeurs suivent sous le nouveau nom (${n(s.entries)}).` : 'Aucune valeur à déplacer.'}`,
        s.conflicts ? `Dans ${n(s.conflicts)}, le nouveau nom porte déjà une valeur différente de l'ancienne : impossible de deviner laquelle garder.` : undefined,
        s.conflicts ? [{ id: 'keepNew', label: 'Garder les valeurs déjà saisies sous le nouveau nom', help: 'Pour ces contenus, l\'ancienne valeur est mise de côté : elle reste en base, sans être affichée. Les autres contenus retrouvent leur ancienne valeur.' }] : [])
    case 'localized':
      if ((op.after as FieldShape).localized) return out(`${subject} devient traduisible. ${s.entries ? `Sa valeur actuelle est recopiée dans chaque langue existante (${n(s.entries)}).` : 'Aucune valeur à recopier.'}`)
      return out(
        `${subject} devient commun à toutes les langues. La valeur de la langue principale (${site.defaultLocale}) est conservée ; si elle est vide, celle de la première langue remplie.`,
        s.differing ? `Dans ${n(s.differing)}, les autres langues ont une valeur différente. Elle ne sera plus affichée ; elle est mise de côté en base, pas supprimée.` : undefined)
    case 'convert': {
      const text = `${subject} change de nature : ${typeName(op.before as FieldShape)} → ${typeName(op.after as FieldShape)}.`
      const warnings = [
        s.lossy ? `Dans ${n(s.lossy)}, la conversion perd une partie de la valeur (mise en forme, retours à la ligne ou choix supplémentaires). L'original est mis de côté en base.` : '',
        s.failed ? `Dans ${n(s.failed)}, la valeur actuelle ne peut pas être convertie.` : '',
      ].filter(Boolean).join(' ')
      return out(
        text + (s.entries || s.lossy || s.failed ? '' : ' Aucune valeur à convertir.') + (s.entries && !s.failed && !s.lossy ? ` Les valeurs sont converties sans perte (${n(s.entries)}).` : ''),
        warnings || undefined,
        s.failed ? [{ id: 'setAside', label: 'Vider le champ là où la conversion est impossible', help: 'L\'ancienne valeur est mise de côté : elle reste en base, sans être affichée. Le champ sera à remplir de nouveau dans ces contenus.' }] : [])
    }
  }
}
