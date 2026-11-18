/**
 * Mode aperçu du site : tant que l'adresse porte `?preview=…`, les brouillons sont affichés.
 * Ce module garde le paramètre pendant toute la navigation et affiche un bandeau qui le rappelle.
 * Le paramètre reste dans l'adresse (plutôt qu'un cookie) parce que c'est lui qui écarte le cache du site :
 * une page d'aperçu ne peut ainsi jamais être confondue avec la page publique.
 */
export default defineNuxtPlugin(() => {
  const router = useRouter()
  const isSite = (path: string) => !path.startsWith('/admin') && !path.startsWith('/api/') && !path.startsWith('/media/')
  const current = () => previewParam(router.currentRoute.value.query)

  // Navigation interne (liens du site) : le paramètre suit.
  router.beforeEach((to, from) => {
    const value = previewParam(from.query)
    if (value !== null && !('preview' in to.query) && isSite(to.path)) return { ...to, query: { ...to.query, preview: value } }
  })

  // Liens ordinaires (rechargement complet de la page) : le paramètre est ajouté au moment du clic.
  document.addEventListener('click', (e) => {
    const value = current()
    const link = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
    if (value === null || !link || link.dataset.cmsPreviewExit !== undefined) return
    const url = new URL(link.href, location.href)
    if (url.origin !== location.origin || !isSite(url.pathname) || url.searchParams.has('preview')) return
    url.searchParams.set('preview', value)
    link.href = url.toString()
  }, true)

  let banner: HTMLElement | null = null
  function update() {
    const value = isSite(router.currentRoute.value.path) ? current() : null
    banner?.remove()
    banner = null
    if (value === null) return
    banner = document.createElement('div')
    banner.setAttribute('role', 'status')
    banner.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483000;background:#111827;color:#fff;font:14px/1.4 system-ui,sans-serif;padding:8px 16px;border-radius:999px;box-shadow:0 4px 16px rgba(0,0,0,.25);display:flex;gap:12px;align-items:center;max-width:calc(100vw - 32px)'
    const text = document.createElement('span')
    // « 1 » : la personne est passée par le back-office. Sinon : lien d'aperçu partagé, elle n'a pas de compte.
    text.textContent = value === '1'
      ? 'Mode aperçu : vous voyez les brouillons, pas le site en ligne.'
      : 'Aperçu partagé : cette version du site n\'est pas encore en ligne.'
    const exit = document.createElement('a')
    exit.dataset.cmsPreviewExit = ''
    exit.textContent = value === '1' ? 'Quitter l\'aperçu' : 'Voir le site en ligne'
    exit.href = location.pathname
    exit.style.cssText = 'color:#fff;text-decoration:underline;white-space:nowrap'
    banner.append(text, exit)
    document.body.append(banner)
  }
  router.afterEach(() => update())
  update()
})
