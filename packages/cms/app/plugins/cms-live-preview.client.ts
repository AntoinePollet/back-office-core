import { LIVE_PREVIEW_TAG, type LiveMessage, readLiveMessage } from '../../shared/live-preview'

/**
 * Aperçu en direct, côté page du site : quand la page est affichée dans le cadre du formulaire du back-office,
 * elle reçoit le contenu en cours de saisie et le met à la place du contenu enregistré dans toutes les lectures
 * du site qui le contiennent. Les pages du site n'ont rien à faire.
 *
 * Seuls les messages de la fenêtre parente, de la même origine que la page, sont écoutés (`readLiveMessage`),
 * et seulement en mode aperçu. Une page ouverte hors d'un cadre n'écoute rien.
 */
export default defineNuxtPlugin((nuxtApp) => {
  if (window.parent === window) return
  const router = useRouter()
  const active = () => {
    const route = router.currentRoute.value
    return 'preview' in route.query && !route.path.startsWith('/admin')
  }

  /** Met les contenus en cours de saisie dans les lectures déjà faites par la page. */
  function applyAll() {
    nuxtApp.runWithContext(() => {
      // Portée jetable : `useNuxtData` s'inscrit comme lecteur de la donnée, il faut le désinscrire aussitôt.
      const scope = effectScope()
      scope.run(() => {
        for (const key of Object.keys(nuxtApp.payload.data)) {
          if (!key.startsWith('cms:')) continue
          const { data } = useNuxtData(key)
          const next = cmsLiveApply(key, data.value)
          if (next !== data.value) data.value = next
        }
      })
      scope.stop()
    })
  }

  let bannerHidden = false
  window.addEventListener('message', (event) => {
    const message = readLiveMessage(event, { origin: location.origin, source: window.parent })
    if (message?.kind !== 'draft' || !active()) return
    cmsLiveStore(message.draft)
    if (!bannerHidden) {
      // Le formulaire dit déjà que c'est un aperçu : le bandeau du mode aperçu masquerait le bas de la page.
      bannerHidden = true
      const style = document.createElement('style')
      style.textContent = '[data-cms-preview-banner]{display:none!important}'
      document.head.append(style)
    }
    // Jamais pendant la reprise du rendu du serveur : la page doit d'abord correspondre à ce que le serveur a envoyé.
    onNuxtReady(applyAll)
  })

  // Signale au formulaire que la page est prête. Le message n'est remis qu'à une fenêtre parente de la même origine.
  onNuxtReady(() => {
    if (!active()) return
    const ready: LiveMessage = { tag: LIVE_PREVIEW_TAG, kind: 'ready', path: location.pathname }
    window.parent.postMessage(ready, location.origin)
  })
})
