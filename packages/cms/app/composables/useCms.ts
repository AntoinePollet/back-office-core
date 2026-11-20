import type { InjectionKey, MaybeRefOrGetter } from 'vue'
import { adminVars, DEFAULT_ADMIN_COLOR } from '../../shared/theme'

// Adresses d'images redimensionnées, utilisables dans les pages du site.
export { cmsImageSrcset, cmsImageUrl } from '../../shared/media'
import type { MediaFolder } from '../../shared/media-folders'
import type { CmsConfig } from '../../shared/format'
import { seoPageTitle } from '../../shared/seo'

type ReadOptions = { locale?: string }

// ───────────── Pour le site public ─────────────

/** Valeur du paramètre d'aperçu de l'adresse (« 1 » ou le jeton d'un lien partagé), ou null hors aperçu. */
export function previewParam(query: Record<string, unknown>): string | null {
  if (!('preview' in query)) return null
  const value = Array.isArray(query.preview) ? query.preview[0] : query.preview
  return typeof value === 'string' && value ? value : '1'
}

/** Vrai quand la page est ouverte en aperçu (?preview=1, ou lien d'aperçu partagé) : les brouillons sont affichés. */
export function useCmsPreview() {
  const route = useRoute()
  return computed(() => 'preview' in route.query)
}

/**
 * Clé explicite des lectures du site. Sans elle, Nuxt déduit la clé de l'emplacement de l'appel dans le code,
 * mais ne le fait pas pour un layer installé dans node_modules (core installé depuis git) : le serveur et le
 * navigateur calculaient alors des clés différentes, les contenus étaient relus par le navigateur et la page
 * ne correspondait plus au rendu du serveur. La clé dépend seulement de ce qui est lu.
 */
const cmsKey = (kind: string, target: string, query: Record<string, unknown>) => `cms:${kind}:${target}:${JSON.stringify(query)}`

function readOptions(options: ReadOptions) {
  const preview = previewParam(useRoute().query)
  if (preview === null) return { query: options }
  // En aperçu, la session du back-office accompagne la requête, y compris pendant le rendu sur le serveur.
  // La valeur est transmise telle quelle : « 1 » pour une personne connectée, ou le jeton d'un lien partagé.
  return { query: { ...options, preview }, $fetch: useRequestFetch() as typeof $fetch }
}

type Collections = import('#cms-types').CmsCollections
type Singletons = import('#cms-types').CmsSingletons
type Forms = import('#cms-types').CmsForms
type Key<T> = keyof T & string

/** Filtre par valeur de champ : `{ category: 'identifiant', onQuote: true }`. Champs texte, nombre, interrupteur, date, liste de choix et relation. */
type Where<K extends Key<Collections>> = Partial<Record<Exclude<keyof Collections[K], 'id' | 'locale' | 'seo' | 'alternates'> & string, string | number | boolean>>
type ListOptions<K extends Key<Collections>> = ReadOptions & { where?: MaybeRefOrGetter<Where<K> | undefined> }

/** Une page de résultats. */
export type CmsPage<T> = { items: T[]; total: number; page: number; limit: number; pageCount: number }

/** Transforme `{ category: 'x' }` en paramètres d'adresse `where[category]=x`. */
function whereQuery(where: Record<string, unknown> | undefined) {
  return Object.fromEntries(Object.entries(where ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [`where[${k}]`, String(v)]))
}

/**
 * Tous les contenus publiés d'une collection, dans l'ordre réglé au back-office.
 * Les champs sont typés d'après cms.config.ts : `services.value[0].title` est proposé par l'éditeur.
 *
 *   const { data: services } = await useCollection('services')
 *   const { data: byCategory } = await useCollection('services', { where: { category: id } })
 */
export function useCollection<K extends Key<Collections>>(type: K, options: ListOptions<K> = {}) {
  const { where, ...rest } = options
  const base = readOptions(rest)
  const query = computed(() => ({ ...base.query, ...whereQuery(toValue(where)) }))
  return useFetch<Collections[K][]>(`/api/content/${type}`, { ...base, query, key: computed(() => cmsKey('liste', type, query.value)) })
}

/**
 * Une page de contenus : pour les longues listes (articles, actualités).
 * `page` peut être réactif ; la liste se recharge quand il change.
 *
 *   const page = computed(() => Number(route.query.page) || 1)
 *   const { data } = await useCollectionPage('articles', { page, limit: 10 })
 *   // data.value : { items, total, page, limit, pageCount }
 */
export function useCollectionPage<K extends Key<Collections>>(
  type: K,
  options: ListOptions<K> & { page?: MaybeRefOrGetter<number | undefined>; limit: number },
) {
  const { where, page, limit, ...rest } = options
  const base = readOptions(rest)
  const query = computed(() => ({ ...base.query, ...whereQuery(toValue(where)), limit, page: Math.max(1, Math.floor(Number(toValue(page)) || 1)) }))
  return useFetch<CmsPage<Collections[K]>>(`/api/content/${type}`, { ...base, query, key: computed(() => cmsKey('page', type, query.value)) })
}

/**
 * Un contenu publié, retrouvé par son adresse. À appeler avec `await`.
 * Si l'adresse est une ancienne adresse de la page, le visiteur est redirigé vers la nouvelle (redirection permanente).
 */
export async function useEntry<K extends Key<Collections>>(type: K, slug: MaybeRefOrGetter<string>, options: ReadOptions = {}) {
  // Après une attente, Nuxt ne sait plus dans quelle page on se trouve : tout ce qui en dépend est lu avant.
  const nuxtApp = useNuxtApp()
  const preview = previewParam(useRoute().query)
  const read = readOptions(options)
  const result = await useFetch<Collections[K]>(() => `/api/content/${type}/${encodeURIComponent(toValue(slug))}`, { ...read, key: computed(() => cmsKey('contenu', `${type}/${toValue(slug)}`, read.query)) })
  const moved = (result.data.value as { _redirect?: string } | null)?._redirect
  if (moved) await nuxtApp.runWithContext(() => navigateTo(moved + (preview ? `?preview=${encodeURIComponent(preview)}` : ''), { redirectCode: 301 }))
  return result
}

/** Une page unique (accueil, réglages…). `null` tant qu'elle n'est pas publiée. */
export function useSingleton<K extends Key<Singletons>>(key: K, options: ReadOptions = {}) {
  const read = readOptions(options)
  return useFetch<Singletons[K] | null>(`/api/content/${key}`, { ...read, key: cmsKey('page-unique', key, read.query) })
}

type SeoEntry = {
  locale?: string
  path?: string | null
  url?: string | null
  alternates?: { locale: string; url: string }[]
  seo?: {
    title: string | null; description: string | null; image: { url: string } | null; noindex: boolean
    shareTitle?: string | null; shareDescription?: string | null
  } | null
} | null | undefined

type SeoOptions = {
  /**
   * Ajouté après le titre : « Droit des affaires — Cabinet Durand ». Par défaut, le réglage `site.titleSuffix` de
   * cms.config.ts (celui que montre l'aperçu du back-office) ; `false` : pas de suffixe sur cette page.
   */
  titleSuffix?: string | false
  /**
   * Sur la page d'accueil, ajoute le bloc de données structurées qui donne à Google le nom du site (`WebSite`).
   * Défaut : true. À désactiver si le site écrit déjà le sien.
   */
  structuredData?: boolean
}

/**
 * Applique à la page le référencement d'un contenu : titre, description, carte de partage (balises `og:` et
 * `twitter:`), adresse canonique, liens entre langues, et masquage des moteurs de recherche si demandé.
 *
 *   const { data: service } = await useEntry('services', () => route.params.slug)
 *   useCmsSeo(service)
 *
 * Replis, les mêmes que dans l'aperçu de l'onglet Référencement : le titre et la description de partage reprennent
 * ceux du référencement quand ils sont vides ; l'image de partage est celle du contenu, sinon `site.shareImage`.
 */
export function useCmsSeo(entry: MaybeRefOrGetter<SeoEntry>, options: SeoOptions = {}) {
  const origin = useRequestURL().origin
  const preview = useCmsPreview()
  const site = useRuntimeConfig().public.cmsSeo as { siteName?: string; titleSuffix?: string; shareImage?: string } | undefined
  const e = computed(() => toValue(entry))
  // Base des adresses complètes : celle du site déclarée dans la configuration, sinon celle de la requête.
  const base = computed(() => (e.value?.url && e.value.path ? e.value.url.slice(0, e.value.url.length - e.value.path.length) : origin))
  const absolute = (path?: string | null) => (path ? (/^https?:\/\//.test(path) ? path : base.value + path) : undefined)
  const suffix = options.titleSuffix === undefined ? site?.titleSuffix : options.titleSuffix || ''
  // Sans titre : le suffixe réglé pour le site sert de titre ; avec l'option de la page (ancienne écriture), rien, comme avant.
  const title = computed(() => (e.value ? seoPageTitle(e.value.seo?.title, suffix, options.titleSuffix === undefined) ?? undefined : undefined))
  const description = () => e.value?.seo?.description ?? undefined
  const shareTitle = () => e.value?.seo?.shareTitle || title.value
  const shareDescription = () => e.value?.seo?.shareDescription || description()
  const image = () => absolute(e.value?.seo?.image?.url ?? (e.value?.seo ? site?.shareImage : undefined))

  useSeoMeta({
    title,
    description,
    ogTitle: shareTitle,
    ogDescription: shareDescription,
    ogImage: image,
    ogUrl: () => e.value?.url ?? undefined,
    ogType: 'website',
    twitterCard: () => (image() ? 'summary_large_image' : 'summary'),
    twitterTitle: shareTitle,
    twitterDescription: shareDescription,
    twitterImage: image,
    // Un brouillon en aperçu ne doit jamais être indexé.
    robots: () => (e.value?.seo?.noindex || preview.value ? 'noindex, nofollow' : undefined),
  })
  useHead({
    // Données structurées : seulement ce qui est certain. Sur l'accueil (langue par défaut), le nom du site, que Google
    // affiche au-dessus de ses résultats. Rien ailleurs : un fil d'Ariane demanderait le nom des pages parentes, que le
    // back-office ne connaît pas. Jamais en aperçu ni sur une page masquée.
    script: computed(() => {
      const page = e.value
      if (options.structuredData === false || !site?.siteName || !page?.url || page.path !== '/' || page.seo?.noindex || preview.value) return []
      const data = { '@context': 'https://schema.org', '@type': 'WebSite', 'name': site.siteName, 'url': page.url, ...(page.locale ? { inLanguage: page.locale } : {}) }
      return [{ type: 'application/ld+json', key: 'cms-website', innerHTML: JSON.stringify(data).replace(/</g, '\\u003c') }]
    }),
    htmlAttrs: { lang: () => e.value?.locale },
    link: computed(() => {
      const page = e.value
      if (!page?.url) return []
      const alternates = (page.alternates?.length ?? 0) > 1 ? page.alternates! : []
      return [
        { rel: 'canonical', href: page.url },
        ...alternates.map(a => ({ rel: 'alternate', hreflang: a.locale, href: a.url })),
      ]
    }) as never, // la liste mêle deux formes de lien que le type de useHead ne sait pas décrire ensemble
  })
}

// ───────────── Formulaires du site (module `forms`) ─────────────

/**
 * Un formulaire déclaré dans cms.config.ts (`forms({ contact: … })`), prêt à brancher sur une page :
 *
 *   const form = useCmsForm('contact')
 *
 *   <form @submit.prevent="form.submit()">
 *     <input v-model="form.values.email"> <p v-if="form.errors.email">{{ form.errors.email }}</p>
 *     <input v-model="form.trap.value" class="hidden" tabindex="-1" autocomplete="off" aria-hidden="true">
 *     <button :disabled="form.pending.value">Envoyer</button>
 *   </form>
 *   <p v-if="form.sent.value">Merci, votre message est bien parti.</p>
 *
 * Le serveur valide tout (champs obligatoires, formats, longueurs) et renvoie un message par champ dans `errors`.
 * `trap` est un champ piège facultatif : laissé invisible, il n'est rempli que par les robots, dont l'envoi est ignoré.
 * Anti-robots (module `turnstile`) : placer `<CmsTurnstile />` dans le formulaire ; son jeton part avec le message.
 */
export function useCmsForm<K extends Key<Forms>>(id: K, initial: Partial<Forms[K]> = {}) {
  type T = Forms[K]
  const values = reactive<Record<string, any>>({ ...initial }) as T
  /** Message d'erreur de chaque champ refusé par le serveur. */
  const errors = ref<Partial<Record<keyof T & string, string>>>({})
  /** Message général quand l'envoi échoue (trop d'envois, panne…). */
  const error = ref<string | null>(null)
  const pending = ref(false)
  const sent = ref(false)
  const trap = ref('')
  const protection = cmsFormProtection()
  // `<CmsTurnstile />` placé dans la même page retrouve ce formulaire tout seul.
  if (getCurrentInstance()) provide(CMS_FORM_PROTECTION, protection)

  async function submit() {
    if (pending.value) return false
    errors.value = {}
    error.value = null
    if (protection.active.value && !protection.token.value) {
      error.value = 'La vérification anti-robots n\'est pas terminée. Patientez une seconde, puis renvoyez le formulaire.'
      return false
    }
    pending.value = true
    // Un jeton anti-robots ne sert qu'une fois : il est relancé après chaque envoi que le serveur a pu vérifier.
    let consumed = protection.active.value
    try {
      await cmsApi(`/api/forms/${id}`, { method: 'POST', body: { values, website: trap.value, ...(protection.active.value ? { turnstile: protection.token.value } : {}) } })
      sent.value = true
      for (const key of Object.keys(values)) delete (values as Record<string, unknown>)[key]
      Object.assign(values, initial)
      return true
    }
    catch (e: any) {
      // Champs à corriger, trop d'envois : le serveur s'est arrêté avant de vérifier le jeton, il reste valable.
      if (e?.statusCode === 422 || e?.statusCode === 429) consumed = false
      errors.value = e?.data?.data?.errors ?? {}
      error.value = Object.keys(errors.value).length ? 'Certains champs sont à corriger.' : cmsErrorMessage(e, 'L\'envoi a échoué. Réessayez dans un instant.')
      return false
    }
    finally {
      if (consumed) protection.reset()
      pending.value = false
    }
  }
  return { values, errors, error, pending, sent, trap, protection, submit }
}

/** Ce qui relie un formulaire du site à son anti-robots (`<CmsTurnstile>`). */
export type CmsFormProtection = {
  /** Vrai quand un anti-robots est affiché dans le formulaire : son jeton est alors exigé. */
  active: Ref<boolean>
  /** Jeton obtenu par le visiteur, null tant qu'il n'y en a pas (ou après expiration). */
  token: Ref<string | null>
  /** Relance la vérification (le composant y branche la sienne). */
  reset: () => void
}
export const CMS_FORM_PROTECTION: InjectionKey<CmsFormProtection> = Symbol('cms-form-protection')

function cmsFormProtection(): CmsFormProtection {
  const protection: CmsFormProtection = { active: ref(false), token: ref(null), reset: () => { protection.token.value = null } }
  return protection
}

// ───────────── Pour le back-office ─────────────

type CmsRights = { edit: boolean; publish: boolean; delete: boolean; /** Limité aux contenus créés par la personne. */ own: boolean }
export const useCmsUser = () => useState<{
  id: string; name: string; email: string; role?: string
  /** Nom du rôle à afficher. */
  roleName?: string
  /** Peut modifier les champs réservés ; peut supprimer des fichiers. */
  restrictedFields?: boolean
  deleteMedia?: boolean
  /** Peut ranger la médiathèque (dossiers, déplacements). */
  organizeMedia?: boolean
  /** Peut créer un lien d'aperçu à partager. */
  sharePreview?: boolean
  /** Contenus auxquels le compte est limité (null : aucune limite). */
  types?: string[] | null
  /** Droits sur chaque type de contenu, calculés par le serveur. */
  access?: Record<string, CmsRights>
  /** Double authentification : activée ; à activer avant toute autre chose (règle du site). */
  twoFactor?: { enabled: boolean; setupRequired: boolean }
} | null>('cms-user', () => null)

/** Écran où un compte tenu d'activer la double authentification est conduit. */
export const CMS_TWO_FACTOR_SETUP_PATH = '/admin/two-factor-setup'

/**
 * Droits de la personne connectée sur un type de contenu, pour masquer les actions interdites.
 * Le serveur refuse de toute façon ce qui n'est pas permis : ceci n'est que de l'affichage.
 */
export function useCmsAccess(type: string): CmsRights {
  const user = useCmsUser().value
  return user?.access?.[type] ?? { edit: true, publish: user?.role !== 'writer', delete: user?.role !== 'writer', own: false }
}

export async function useCmsSchema() {
  const schema = useState<CmsConfig | null>('cms-schema', () => null)
  if (!schema.value) schema.value = await cmsApi<CmsConfig>('/api/cms/schema')
  return schema as Ref<CmsConfig>
}

/** Nombre de changements de structure en attente de validation (avertissement du back-office). */
export const useCmsMigrationsPending = () => useState<number>('cms-migrations-pending', () => 0)

type Toast = { id: number; message: string; kind: 'success' | 'error' }

export function useCmsToast() {
  const toasts = useState<Toast[]>('cms-toasts', () => [])
  const push = (kind: Toast['kind'], message: string) => {
    const id = Date.now() + Math.random()
    toasts.value.push({ id, message, kind })
    setTimeout(() => { toasts.value = toasts.value.filter(t => t.id !== id) }, kind === 'error' ? 6000 : 2600)
  }
  return { toasts, success: (m: string) => push('success', m), error: (m: string) => push('error', m) }
}

/** Message lisible à partir d'une erreur renvoyée par l'API. */
export const cmsErrorMessage = (error: any, fallback = 'Une erreur est survenue.') =>
  error?.data?.message || error?.message || fallback

/**
 * Vrai quand une modification est bien enregistrée mais que le site n'a pas pu être actualisé tout de suite
 * (le cache du réseau n'a pas pu être vidé). L'avertissement est affiché par `<CmsSiteDelayNotice />`.
 */
export const useCmsSiteDelay = () => useState<boolean>('cms-site-delay', () => false)

/**
 * À appeler avec la réponse d'une route qui modifie le site. Renvoie vrai si le site est à jour,
 * faux si la mise à jour du site a échoué : le message de confirmation ne doit alors pas dire « Le site est à jour ».
 * Une réponse sans `purgeFailed` (rien n'a été mis en ligne) ne change pas l'avertissement en cours.
 */
export function cmsSiteUpdated(response: unknown) {
  const failed = (response as { purgeFailed?: boolean } | null)?.purgeFailed
  if (typeof failed === 'boolean') useCmsSiteDelay().value = failed
  return failed !== true
}

/** Date lisible d'un enregistrement : « aujourd'hui à 14:32 », « le 3 nov. à 09:10 ». */
export function cmsFormatWhen(date: string | Date) {
  const d = new Date(date)
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === new Date().toDateString()) return `aujourd'hui à ${time}`
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return `le ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })} à ${time}`
}

/**
 * Duplique un contenu et renvoie l'adresse du formulaire de la copie.
 * Avec brouillons, la copie est créée tout de suite, en brouillon. Sans brouillons, enregistrer c'est publier :
 * le formulaire s'ouvre prérempli et rien n'existe tant qu'il n'est pas enregistré.
 */
export async function cmsDuplicate(type: string, id: string, drafts: boolean) {
  if (!drafts) return `/admin/${type}/new?copy=${encodeURIComponent(id)}`
  const copy = await cmsApi<{ id: string }>(`/api/cms/entries/${type}/${id}/duplicate`, { method: 'POST' })
  return `/admin/${type}/${copy.id}`
}

// ───────────── Médiathèque et listes de choix (back-office) ─────────────

export type CmsMedia = {
  id: string; url: string; name: string; mime: string; size: number
  width: number | null; height: number | null; alt: Record<string, string>; createdAt: string
  /** Dossier où le fichier est rangé ; null : à la racine. */
  folderId: string | null
}
export type { MediaFolder as CmsMediaFolder } from '../../shared/media-folders'

export function useCmsMedia() {
  const items = useState<CmsMedia[] | null>('cms-media', () => null)

  async function load(force = false) {
    if (!items.value || force) items.value = await cmsApi<CmsMedia[]>('/api/cms/media')
    return items.value
  }
  const byId = (id: unknown) => (typeof id === 'string' ? items.value?.find(m => m.id === id) : undefined)

  /** `folderId` : dossier où ranger le fichier (le dossier affiché). */
  async function upload(file: File, folderId?: string | null) {
    const body = new FormData()
    body.append('file', file)
    if (folderId) body.append('folder', folderId)
    if (file.type.startsWith('image/') && file.type !== 'image/svg+xml') {
      // Les dimensions sont lues dans le navigateur : le serveur n'a pas à décoder l'image.
      const bitmap = await createImageBitmap(file).catch(() => null)
      if (bitmap) { body.append('width', String(bitmap.width)); body.append('height', String(bitmap.height)); bitmap.close() }
    }
    const created = await cmsApi<CmsMedia>('/api/cms/media', { method: 'POST', body })
    items.value = [created, ...(items.value ?? [])]
    return created
  }
  return { items, load, byId, upload }
}

/**
 * Dossiers de la médiathèque et dossier ouvert. Le dossier ouvert est partagé par la page Médiathèque et la fenêtre
 * de choix d'une image, et retenu pendant la session de l'onglet : on retrouve le dossier où l'on rangeait.
 */
let folderRestored = false
export function useCmsMediaFolders() {
  const folders = useState<MediaFolder[] | null>('cms-media-folders', () => null)
  const current = useState<string | null>('cms-media-folder', () => null)
  const { items } = useCmsMedia()

  /** Appelé dans le navigateur seulement (au montage). */
  async function load(force = false) {
    if (!folderRestored) {
      folderRestored = true
      try { current.value ??= sessionStorage.getItem('cms-media-folder') || null }
      catch { /* stockage indisponible */ }
    }
    if (!folders.value || force) folders.value = await cmsApi<MediaFolder[]>('/api/cms/media/folders')
    // Dossier retenu mais supprimé entre-temps : retour à la racine.
    if (current.value && !folders.value.some(f => f.id === current.value)) open(null)
    return folders.value
  }
  function open(id: string | null) {
    current.value = id
    try { if (id) sessionStorage.setItem('cms-media-folder', id); else sessionStorage.removeItem('cms-media-folder') }
    catch { /* stockage indisponible : le dossier n'est retenu que pendant la navigation */ }
  }

  async function create(name: string, parentId: string | null) {
    const folder = await cmsApi<MediaFolder>('/api/cms/media/folders', { method: 'POST', body: { name, parentId } })
    folders.value = [...(folders.value ?? []), folder]
    return folder
  }
  async function update(id: string, body: { name?: string; parentId?: string | null }) {
    const folder = await cmsApi<MediaFolder>(`/api/cms/media/folders/${id}`, { method: 'PATCH', body })
    folders.value = (folders.value ?? []).map(f => (f.id === id ? folder : f))
    return folder
  }
  /** Supprime un dossier ; `force` : son contenu remonte dans le dossier parent. */
  async function remove(id: string, force = false) {
    const folder = folders.value?.find(f => f.id === id)
    await cmsApi(`/api/cms/media/folders/${id}`, { method: 'DELETE', query: force ? { force: 1 } : {} })
    const parentId = folder?.parentId ?? null
    folders.value = (folders.value ?? []).filter(f => f.id !== id).map(f => (f.parentId === id ? { ...f, parentId } : f))
    items.value = (items.value ?? []).map(m => (m.folderId === id ? { ...m, folderId: parentId } : m))
    if (current.value === id) open(parentId)
  }
  /** Range des fichiers dans un dossier (null : la racine). */
  async function moveFiles(ids: string[], folderId: string | null) {
    await cmsApi('/api/cms/media/move', { method: 'POST', body: { ids, folderId } })
    const moved = new Set(ids)
    items.value = (items.value ?? []).map(m => (moved.has(m.id) ? { ...m, folderId } : m))
  }
  return { folders, current, load, open, create, update, remove, moveFiles }
}

/** Contenus d'une collection, pour les champs relation et lien. */
const optionRequests = new Map<string, Promise<unknown>>()

export function useCmsOptions() {
  const cache = useState<Record<string, { id: string; title: string }[]>>('cms-options', () => ({}))
  /**
   * Charge les contenus d'une collection. La liste déjà connue reste affichée pendant le rechargement,
   * et chaque champ recharge à son apparition : un contenu créé entre-temps est donc proposé.
   */
  async function load(type: string) {
    if (!optionRequests.has(type)) {
      optionRequests.set(type, cmsApi<{ id: string; title: string }[]>(`/api/cms/entries/${type}`)
        .then((list) => { cache.value = { ...cache.value, [type]: list.map(({ id, title }) => ({ id, title: title || 'Sans titre' })) } })
        .finally(() => optionRequests.delete(type)))
    }
    await optionRequests.get(type)
    return cache.value[type] ?? []
  }
  return { cache, load }
}

export const formatFileSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} Ko` : `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`

/**
 * Style à poser sur la racine du back-office (avec la classe `cms-admin`) : sa couleur principale.
 * La valeur vient du même appel que le thème du site, donc elle est connue dès la page de connexion.
 */
export function useCmsAdminStyle() {
  const color = useState<string | null>('cms-admin-color', () => null)
  return computed(() => adminVars(color.value ?? DEFAULT_ADMIN_COLOR))
}

/**
 * Appel à l'API du back-office. Même comportement que `$fetch`, mais l'adresse est traitée comme un simple texte :
 * le typage automatique des routes de Nuxt, appliqué à des adresses construites dynamiquement, fait échouer TypeScript.
 */
export function cmsApi<T = unknown>(url: string, options?: Record<string, any>): Promise<T> {
  return ($fetch<T>(url, options) as Promise<T>).catch((error) => {
    // Le site vient d'exiger la double authentification pour ce compte : le serveur refuse tout, on conduit à l'activation.
    if (import.meta.client && error?.status === 403 && error?.data?.data?.code === 'two-factor-required' && location.pathname !== CMS_TWO_FACTOR_SETUP_PATH)
      location.assign(CMS_TWO_FACTOR_SETUP_PATH)
    throw error
  })
}

/** Nombre de messages de formulaire non lus, affiché dans le menu (module « forms »). */
export const useCmsUnreadMessages = () => useState<number>('cms-forms-unread', () => 0)
let unreadRequest = 0
/** Relit ce nombre sur le serveur. Seule la réponse à la demande la plus récente est retenue. */
export async function refreshCmsUnreadMessages() {
  const mine = ++unreadRequest
  const unread = useCmsUnreadMessages()
  const result = await cmsApi<{ unread: number }>('/api/cms/forms/unread').catch(() => null)
  if (result && mine === unreadRequest) unread.value = result.unread
}

/** Un module tel que l'API du back-office le décrit : ses réglages, sans jamais la valeur d'une clé d'API. */
export type CmsModuleState = {
  id: string; label: string; description: string
  /** Logo affiché à côté du nom (tracés SVG 24 × 24). */
  logo: { style: 'fill' | 'stroke'; paths: string[]; color: string } | null
  settings: {
    key: string; label: string; type: 'text' | 'secret'; help?: string; placeholder?: string; required?: boolean
    env?: { name: string }
    value?: string; saved?: boolean; hint?: string; unreadable?: boolean; fromEnv: boolean
  }[]
  configured: boolean; missing: string[]; canTest: boolean; adminPage: { to: string; label: string } | null
  /** Informations à recopier ailleurs (adresse d'un webhook…). */
  details: { label: string; value: string; help?: string }[]
}
