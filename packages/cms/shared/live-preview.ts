/**
 * Aperçu en direct : la page du site, affichée dans un cadre à côté du formulaire, suit la saisie sans enregistrer.
 *
 * Le formulaire fait préparer ses valeurs non enregistrées par le serveur (`POST /api/cms/entries/<type>/<id>/live-preview`,
 * qui leur applique le traitement de l'API publique), puis envoie le contenu obtenu au cadre par `postMessage`.
 * Dans le cadre, le core remplace ce contenu dans toutes les lectures du site qui le contiennent (`useSingleton`,
 * `useEntry`, `useCollection`, `useCollectionPage`) : les pages du site n'ont rien à écrire.
 *
 * Ce fichier porte la logique pure, partagée par le formulaire et par le cadre : forme et contrôle des messages,
 * correspondance entre un contenu et une lecture, remplacement dans une réponse.
 */

/** Marque des messages de l'aperçu en direct : tout autre message est ignoré. */
export const LIVE_PREVIEW_TAG = 'cms-live-preview'

/** Un contenu en cours de saisie, tel que l'API publique le renverrait s'il était enregistré. */
export type LiveDraft = {
  type: string
  id: string
  /** Langue du contenu. */
  locale: string
  /** Langue par défaut du site : celle d'une lecture qui ne précise pas de langue. */
  defaultLocale: string
  entry: Record<string, unknown>
}

export type LiveMessage =
  /** Formulaire → cadre : le contenu en cours de saisie. */
  | { tag: typeof LIVE_PREVIEW_TAG; kind: 'draft'; draft: LiveDraft }
  /** Cadre → formulaire : la page est chargée et prête à recevoir le contenu. */
  | { tag: typeof LIVE_PREVIEW_TAG; kind: 'ready'; path: string }
  /** Cadre → formulaire : les titres (h1 à h6) de la page telle qu'elle s'affiche, à chaque changement. */
  | { tag: typeof LIVE_PREVIEW_TAG; kind: 'outline'; path: string; headings: PageHeading[] }

/** Partie de la page où se trouve un titre : le contenu, ou les parties communes à tout le site. */
export type HeadingPlace = 'main' | 'header' | 'nav' | 'footer' | 'aside'
/** Un titre de la page : son niveau (1 pour `<h1>`…), son texte, et où il se trouve. */
export type PageHeading = { level: number; text: string; place: HeadingPlace }

/** Au-delà, les titres suivants sont ignorés : une page normale en a quelques dizaines au plus. */
export const OUTLINE_MAX_HEADINGS = 300
/** Longueur gardée du texte d'un titre. */
export const OUTLINE_MAX_TEXT = 200
const PLACES: HeadingPlace[] = ['header', 'nav', 'footer', 'aside']

type OutlineNode = { tagName: string; textContent: string | null; closest: (selector: string) => unknown; querySelectorAll: (selector: string) => ArrayLike<{ getAttribute: (name: string) => string | null }> }

/**
 * Titres d'une page, dans l'ordre du document, tels qu'un moteur de recherche les lit. Un titre fait seulement
 * d'une image prend son texte alternatif. Le bandeau du mode aperçu, ajouté par le core, n'en fait pas partie.
 */
export function readOutline(root: { querySelectorAll: (selector: string) => ArrayLike<unknown> }): PageHeading[] {
  const out: PageHeading[] = []
  for (const node of Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6')) as OutlineNode[]) {
    if (out.length >= OUTLINE_MAX_HEADINGS) break
    if (node.closest('[data-cms-preview-banner]')) continue
    let text = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (!text) text = Array.from(node.querySelectorAll('img[alt]')).map(img => img.getAttribute('alt') ?? '').join(' ').replace(/\s+/g, ' ').trim()
    // Titre dans un en-tête, un menu ou un pied de page qui n'est pas celui d'un article du contenu.
    const place = PLACES.find(p => node.closest(p) && !node.closest(`main ${p}, article ${p}`)) ?? 'main'
    out.push({ level: Number(node.tagName.slice(1)), text: text.slice(0, OUTLINE_MAX_TEXT), place })
  }
  return out
}

function readHeadings(value: unknown): PageHeading[] | null {
  if (!Array.isArray(value) || value.length > OUTLINE_MAX_HEADINGS) return null
  const out: PageHeading[] = []
  for (const h of value) {
    if (!isRecord(h) || !Number.isInteger(h.level) || (h.level as number) < 1 || (h.level as number) > 6) return null
    if (typeof h.text !== 'string' || h.text.length > OUTLINE_MAX_TEXT || !(['main', ...PLACES] as unknown[]).includes(h.place)) return null
    out.push({ level: h.level as number, text: h.text, place: h.place as HeadingPlace })
  }
  return out
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const isText = (v: unknown): v is string => typeof v === 'string' && v !== ''

/**
 * Contrôle un message reçu par `postMessage`. Il n'est accepté que s'il vient de la fenêtre attendue (le cadre pour
 * le formulaire, la fenêtre parente pour le cadre), de la même origine que la page qui le reçoit, et s'il a la forme
 * prévue. Renvoie le message, ou null : tout le reste est ignoré sans effet.
 */
export function readLiveMessage(
  event: { origin: string; source: unknown; data: unknown },
  expected: { origin: string; source: unknown },
): LiveMessage | null {
  if (!expected.source || event.source !== expected.source) return null
  if (!expected.origin || expected.origin === 'null' || event.origin !== expected.origin) return null
  const data = event.data
  if (!isRecord(data) || data.tag !== LIVE_PREVIEW_TAG) return null
  if (data.kind === 'ready') return isText(data.path) ? { tag: LIVE_PREVIEW_TAG, kind: 'ready', path: data.path } : null
  if (data.kind === 'outline') {
    const headings = readHeadings(data.headings)
    return isText(data.path) && headings ? { tag: LIVE_PREVIEW_TAG, kind: 'outline', path: data.path, headings } : null
  }
  if (data.kind !== 'draft') return null
  const draft = data.draft
  if (!isRecord(draft) || !isText(draft.type) || !isText(draft.id) || !isText(draft.locale) || !isText(draft.defaultLocale) || !isRecord(draft.entry)) return null
  // Le contenu annoncé et le contenu transmis doivent être le même.
  if (draft.entry.id !== draft.id || draft.entry.locale !== draft.locale) return null
  return { tag: LIVE_PREVIEW_TAG, kind: 'draft', draft: { type: draft.type, id: draft.id, locale: draft.locale, defaultLocale: draft.defaultLocale, entry: draft.entry } }
}

/** Ce qu'une lecture du site a demandé, retrouvé dans sa clé (voir `cmsKey` dans `useCms.ts`). */
export type LiveRead = {
  kind: 'liste' | 'page' | 'contenu' | 'page-unique'
  type: string
  /** Langue demandée ; absente : la langue par défaut du site. */
  locale: string | null
  /** Vrai si la lecture a été faite en aperçu (`?preview=…`) : seules ces lectures reçoivent le contenu en cours de saisie. */
  preview: boolean
}

/** Lit la clé d'une lecture du site : `cms:<nature>:<cible>:<paramètres en JSON>`. Null pour toute autre clé. */
export function parseReadKey(key: string): LiveRead | null {
  const match = /^cms:(liste|page|contenu|page-unique):([^:{]+):(\{.*\})$/s.exec(key)
  if (!match) return null
  const kind = match[1] as LiveRead['kind']
  let query: unknown
  try { query = JSON.parse(match[3]!) }
  catch { return null }
  if (!isRecord(query)) return null
  // Un contenu est lu par « type/adresse » : seul le type sert, le contenu est reconnu à son identifiant.
  const type = kind === 'contenu' ? match[2]!.split('/')[0]! : match[2]!
  return { kind, type, locale: isText(query.locale) ? query.locale : null, preview: 'preview' in query }
}

/**
 * Remplace, dans la réponse d'une lecture du site, le contenu en cours de saisie par ses valeurs non enregistrées.
 * Renvoie la réponse telle quelle (le même objet) si la lecture ne contient pas ce contenu :
 * autre type, autre langue, lecture hors aperçu, contenu absent de la liste.
 *
 * - page unique : la réponse entière est remplacée (y compris `null`, quand la page n'a encore rien d'enregistré) ;
 * - contenu lu par son adresse : remplacé si c'est bien lui ;
 * - liste, page de liste : l'élément qui porte son identifiant est remplacé, à sa place. Un contenu absent de la liste
 *   n'y est pas ajouté, et la liste n'est ni filtrée ni triée de nouveau.
 */
export function applyLiveDraft<T>(key: string, data: T, draft: LiveDraft): T {
  const read = parseReadKey(key)
  if (!read || !read.preview || read.type !== draft.type || (read.locale ?? draft.defaultLocale) !== draft.locale) return data
  const isDraft = (item: unknown) => isRecord(item) && item.id === draft.id && (item.locale === undefined || item.locale === draft.locale)
  const inList = (list: unknown[]) => (list.some(isDraft) ? list.map(item => (isDraft(item) ? draft.entry : item)) : list)

  if (read.kind === 'page-unique') return (draft.id === draft.type ? draft.entry : data) as T
  if (read.kind === 'contenu') return (isDraft(data) ? draft.entry : data) as T
  if (read.kind === 'liste') return (Array.isArray(data) ? inList(data) : data) as T
  if (isRecord(data) && Array.isArray(data.items)) {
    const items = inList(data.items)
    return (items === data.items ? data : { ...data, items }) as T
  }
  return data
}

/** Applique plusieurs contenus en cours de saisie à la même réponse. */
export const applyLiveDrafts = <T>(key: string, data: T, drafts: Iterable<LiveDraft>): T => {
  let out = data
  for (const draft of drafts) out = applyLiveDraft(key, out, draft)
  return out
}

/** Largeurs proposées pour le cadre : la page est affichée à cette largeur, puis réduite pour tenir dans le volet. */
export const LIVE_DEVICES = [
  { id: 'desktop', label: 'Ordinateur', width: 1280 },
  { id: 'tablet', label: 'Tablette', width: 768 },
  { id: 'phone', label: 'Téléphone', width: 390 },
] as const
export type LiveDeviceId = typeof LIVE_DEVICES[number]['id']

/** Réduction à appliquer au cadre pour qu'une page de `width` pixels tienne dans `available` pixels (jamais d'agrandissement). */
export const liveScale = (width: number, available: number) => (available > 0 && width > available ? available / width : 1)

/** Part de la largeur donnée à l'aperçu, bornée pour que le formulaire et la page restent utilisables. */
export const clampLiveShare = (share: number) => (Number.isFinite(share) ? Math.min(0.7, Math.max(0.3, share)) : 0.5)

/** Adresse à charger dans le cadre : la page, en mode aperçu (c'est ce paramètre qui écarte le cache du site). */
export const liveFrameUrl = (path: string) => `${path}${path.includes('?') ? '&' : '?'}preview=1`
