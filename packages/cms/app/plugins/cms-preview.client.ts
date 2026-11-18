/** Bandeau affiché sur le site quand une page est ouverte en aperçu depuis le back-office. */
export default defineNuxtPlugin(() => {
  const router = useRouter()
  let banner: HTMLElement | null = null

  function update() {
    const active = 'preview' in router.currentRoute.value.query && !router.currentRoute.value.path.startsWith('/admin')
    if (active && !banner) {
      banner = document.createElement('div')
      banner.setAttribute('role', 'status')
      banner.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483000;background:#111827;color:#fff;font:14px/1.4 system-ui,sans-serif;padding:8px 14px;border-radius:999px;box-shadow:0 4px 16px rgba(0,0,0,.25);display:flex;gap:12px;align-items:center'
      const text = document.createElement('span')
      text.textContent = 'Aperçu du brouillon : cette version n\'est pas en ligne.'
      const quit = document.createElement('a')
      quit.textContent = 'Voir la version en ligne'
      quit.style.cssText = 'color:#fff;text-decoration:underline;cursor:pointer'
      quit.addEventListener('click', () => { location.href = location.pathname })
      banner.append(text, quit)
      document.body.append(banner)
    }
    else if (!active && banner) {
      banner.remove()
      banner = null
    }
  }
  router.afterEach(() => update())
  update()
})
