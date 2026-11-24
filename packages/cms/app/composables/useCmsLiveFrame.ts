import type { Ref } from 'vue'
import { LIVE_PREVIEW_TAG, type LiveDraft, type LiveMessage, type PageHeading, liveFrameUrl, readLiveMessage } from '../../shared/live-preview'

/** Ce qu'il faut d'un contenu en cours d'édition pour l'afficher dans un cadre. */
export type LiveFrameDoc = { id?: string | null; version?: number; shared: Record<string, any>; locales: Record<string, { values: Record<string, any> }> }

/** Titres de la page d'un contenu dans une langue, lus dans le cadre qui l'affiche avec la saisie en cours. */
export type LiveOutline = { id: string; locale: string; path: string; headings: PageHeading[] }

/** Délai après la dernière frappe avant de préparer l'aperçu. */
const DELAY = 300

/**
 * Un cadre qui affiche la page d'un contenu avec les valeurs du formulaire, sans enregistrer
 * (voir `shared/live-preview.ts`). À chaque pause dans la saisie, les valeurs sont préparées par le serveur comme le
 * ferait l'API publique, puis envoyées au cadre. Les titres que le cadre renvoie sont dans `outline`.
 *
 * Tant que `enabled` est faux, rien n'est appelé et le cadre n'a pas d'adresse.
 */
export function useCmsLiveFrame(options: {
  type: string
  doc: () => LiveFrameDoc
  locale: () => string
  defaultLocale: () => string
  enabled: Ref<boolean>
  frame: Ref<HTMLIFrameElement | undefined>
}) {
  const { type, enabled, frame } = options
  /** Adresse chargée dans le cadre ; null tant qu'il n'y a pas de page à afficher. */
  const src = ref<string | null>(null)
  const frameKey = ref(0)
  const status = ref<'wait' | 'updating' | 'live' | 'late'>('wait')
  /** Pourquoi l'aperçu n'est pas disponible (contenu jamais enregistré…), ou pourquoi il est en retard. */
  const unavailable = ref<string | null>(null)
  const problem = ref<string | null>(null)
  /** Derniers titres reçus du cadre ; null tant qu'il n'en a pas envoyé. */
  const outline = ref<LiveOutline | null>(null)

  let draft: LiveDraft | null = null
  let frameReady = false
  let controller: AbortController | null = null
  let request = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  const body = () => ({ locale: options.locale(), shared: options.doc().shared, values: options.doc().locales[options.locale()]?.values ?? {} })
  /** Tout ce dont l'aperçu dépend : la saisie, la langue, et l'enregistrement (qui peut changer l'adresse de la page). */
  const watched = computed(() => (enabled.value ? JSON.stringify({ id: options.doc().id, version: options.doc().version, ...body() }) : ''))

  function send() {
    const target = frame.value?.contentWindow
    if (!frameReady || !draft || !target) return
    const message: LiveMessage = { tag: LIVE_PREVIEW_TAG, kind: 'draft', draft }
    // Remis seulement si le cadre affiche toujours une page de ce site.
    target.postMessage(message, location.origin)
  }

  async function prepare() {
    clearTimeout(timer)
    controller?.abort()
    if (!enabled.value) return
    const id = options.doc().id ?? null
    if (!id) {
      src.value = null
      unavailable.value = 'L\'aperçu en direct sera disponible après le premier enregistrement de ce contenu.'
      return
    }
    const mine = ++request
    controller = new AbortController()
    status.value = 'updating'
    try {
      const { entry } = await cmsApi<{ entry: Record<string, unknown> & { path: string | null } }>(
        `/api/cms/entries/${type}/${id}/live-preview`, { method: 'POST', body: body(), signal: controller.signal })
      if (mine !== request) return
      unavailable.value = problem.value = null
      draft = { type, id, locale: options.locale(), defaultLocale: options.defaultLocale(), entry }
      const url = entry.path ? liveFrameUrl(entry.path) : null
      if (url !== src.value) {
        // Autre page (langue, nouvelle adresse) : le cadre la charge, et le contenu part quand elle se dit prête.
        frameReady = false
        src.value = url
      }
      else send()
      status.value = 'live'
    }
    catch (e: any) {
      // Appel dépassé par une saisie plus récente : sa réponse ne compte plus.
      if (mine !== request) return
      if (e?.statusCode === 409) {
        src.value = null
        draft = null
        unavailable.value = cmsErrorMessage(e, 'L\'aperçu en direct n\'est pas encore disponible pour ce contenu.')
      }
      else {
        status.value = 'late'
        problem.value = cmsErrorMessage(e, 'L\'aperçu n\'a pas pu être mis à jour.')
      }
    }
  }

  watch(watched, (now, before) => {
    if (!now) return
    clearTimeout(timer)
    // À l'ouverture : tout de suite. Pendant la saisie : après une pause, pour ne pas appeler le serveur à chaque frappe.
    if (!before) prepare()
    else timer = setTimeout(prepare, DELAY)
  })

  function onMessage(event: MessageEvent) {
    const message = readLiveMessage(event, { origin: location.origin, source: frame.value?.contentWindow })
    if (message?.kind === 'ready') {
      frameReady = true
      send()
    }
    else if (message?.kind === 'outline' && draft) {
      outline.value = { id: draft.id, locale: draft.locale, path: message.path, headings: message.headings }
    }
  }

  function reload() {
    frameReady = false
    frameKey.value++
    prepare()
  }

  function stop() {
    clearTimeout(timer)
    controller?.abort()
    request++
  }
  watch(enabled, (now) => {
    if (now) return
    // Cadre retiré : plus aucun appel.
    stop()
    src.value = null
    draft = null
    outline.value = null
    frameReady = false
    status.value = 'wait'
  })

  onMounted(() => {
    window.addEventListener('message', onMessage)
    // Volet resté ouvert depuis le contenu précédent.
    if (enabled.value) prepare()
  })
  onBeforeUnmount(() => {
    stop()
    window.removeEventListener('message', onMessage)
  })

  return { src, frameKey, status, unavailable, problem, outline, prepare, reload }
}
