import type { MaybeRefOrGetter } from 'vue'
import { adminVars, DEFAULT_ADMIN_COLOR } from '../../shared/theme'

// Adresses d'images redimensionnées, utilisables dans les pages du site.
export { cmsImageSrcset, cmsImageUrl } from '../../shared/media'
import type { CmsConfig } from '../../shared/format'

type ReadOptions = { locale?: string }

// ───────────── Pour le site public ─────────────

/** Vrai quand la page est ouverte en aperçu depuis le back-office (?preview=1) : les brouillons sont affichés. */
export function useCmsPreview() {
  const route = useRoute()
  return computed(() => 'preview' in route.query)
}

function readOptions(options: ReadOptions) {
  if (!('preview' in useRoute().query)) return { query: options }
  // En aperçu, la session du back-office accompagne la requête, y compris pendant le rendu sur le serveur.
  return { query: { ...options, preview: 1 }, $fetch: useRequestFetch() as typeof $fetch }
}

type Collections = import('#cms-types').CmsCollections
type Singletons = import('#cms-types').CmsSingletons
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
  return useFetch<Collections[K][]>(`/api/content/${type}`, { ...base, query: computed(() => ({ ...base.query, ...whereQuery(toValue(where)) })) })
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
  return useFetch<CmsPage<Collections[K]>>(`/api/content/${type}`, {
    ...base,
    query: computed(() => ({ ...base.query, ...whereQuery(toValue(where)), limit, page: Math.max(1, Math.floor(Number(toValue(page)) || 1)) })),
  })
}

/**
 * Un contenu publié, retrouvé par son adresse. À appeler avec `await`.
 * Si l'adresse est une ancienne adresse de la page, le visiteur est redirigé vers la nouvelle (redirection permanente).
 */
export async function useEntry<K extends Key<Collections>>(type: K, slug: MaybeRefOrGetter<string>, options: ReadOptions = {}) {
  // Après une attente, Nuxt ne sait plus dans quelle page on se trouve : tout ce qui en dépend est lu avant.
  const nuxtApp = useNuxtApp()
  const preview = 'preview' in useRoute().query
  const result = await useFetch<Collections[K]>(() => `/api/content/${type}/${encodeURIComponent(toValue(slug))}`, readOptions(options))
  const moved = (result.data.value as { _redirect?: string } | null)?._redirect
  if (moved) await nuxtApp.runWithContext(() => navigateTo(moved + (preview ? '?preview=1' : ''), { redirectCode: 301 }))
  return result
}

/** Une page unique (accueil, réglages…). `null` tant qu'elle n'est pas publiée. */
export function useSingleton<K extends Key<Singletons>>(key: K, options: ReadOptions = {}) {
  return useFetch<Singletons[K] | null>(`/api/content/${key}`, readOptions(options))
}

type SeoEntry = {
  locale?: string
  path?: string | null
  url?: string | null
  alternates?: { locale: string; url: string }[]
  seo?: { title: string | null; description: string | null; image: { url: string } | null; noindex: boolean } | null
} | null | undefined

/**
 * Applique à la page le référencement d'un contenu : titre, description, image de partage,
 * adresse canonique, liens entre langues, et masquage des moteurs de recherche si demandé.
 *
 *   const { data: service } = await useEntry('services', () => route.params.slug)
 *   useCmsSeo(service)
 */
export function useCmsSeo(entry: MaybeRefOrGetter<SeoEntry>, options: { /** Ajouté après le titre : « Droit des affaires — Cabinet Durand ». */ titleSuffix?: string } = {}) {
  const origin = useRequestURL().origin
  const preview = useCmsPreview()
  const e = computed(() => toValue(entry))
  // Base des adresses complètes : celle du site déclarée dans la configuration, sinon celle de la requête.
  const base = computed(() => (e.value?.url && e.value.path ? e.value.url.slice(0, e.value.url.length - e.value.path.length) : origin))
  const absolute = (path?: string | null) => (path ? (/^https?:\/\//.test(path) ? path : base.value + path) : undefined)
  const title = computed(() => (e.value?.seo?.title ? e.value.seo.title + (options.titleSuffix ? ` — ${options.titleSuffix}` : '') : undefined))

  useSeoMeta({
    title,
    description: () => e.value?.seo?.description ?? undefined,
    ogTitle: title,
    ogDescription: () => e.value?.seo?.description ?? undefined,
    ogImage: () => absolute(e.value?.seo?.image?.url),
    ogUrl: () => e.value?.url ?? undefined,
    ogType: 'website',
    twitterCard: () => (e.value?.seo?.image ? 'summary_large_image' : 'summary'),
    // Un brouillon en aperçu ne doit jamais être indexé.
    robots: () => (e.value?.seo?.noindex || preview.value ? 'noindex, nofollow' : undefined),
  })
  useHead({
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

// ───────────── Pour le back-office ─────────────

export const useCmsUser = () => useState<{ id: string; name: string; email: string; role?: string } | null>('cms-user', () => null)

export async function useCmsSchema() {
  const schema = useState<CmsConfig | null>('cms-schema', () => null)
  if (!schema.value) schema.value = await cmsApi<CmsConfig>('/api/cms/schema')
  return schema as Ref<CmsConfig>
}

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
}

export function useCmsMedia() {
  const items = useState<CmsMedia[] | null>('cms-media', () => null)

  async function load(force = false) {
    if (!items.value || force) items.value = await cmsApi<CmsMedia[]>('/api/cms/media')
    return items.value
  }
  const byId = (id: unknown) => (typeof id === 'string' ? items.value?.find(m => m.id === id) : undefined)

  async function upload(file: File) {
    const body = new FormData()
    body.append('file', file)
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
  return $fetch<T>(url, options) as Promise<T>
}
