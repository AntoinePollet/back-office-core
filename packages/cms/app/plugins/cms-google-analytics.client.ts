import { GA_META_NAME, GA_SCRIPT_SRC, gaCookieNames } from '../../shared/google-analytics'

/**
 * Google Analytics (module `google-analytics`), côté page du site. Le serveur pose dans la page l'identifiant de
 * mesure, rien de plus. Le script de Google n'est chargé, et ses cookies déposés, qu'une fois la finalité « mesure
 * d'audience » acceptée dans le bandeau du module Consentement. Si le visiteur retire son accord, la mesure s'arrête
 * tout de suite et les cookies de Google Analytics sont retirés.
 *
 * Les changements de page sans rechargement sont comptés par Google Analytics lui-même (« mesure améliorée »,
 * active par défaut sur un flux web).
 */
type Gtag = (...args: unknown[]) => void
type GaWindow = Window & { dataLayer?: unknown[]; gtag?: Gtag } & Record<string, unknown>

export default defineNuxtPlugin(() => {
  const id = document.querySelector(`meta[name="${GA_META_NAME}"]`)?.getAttribute('content') ?? ''
  if (!/^G-[A-Z0-9]{4,20}$/.test(id)) return
  const w = window as unknown as GaWindow
  const disabled = `ga-disable-${id}`
  let loaded = false

  function start() {
    w[disabled] = false
    if (loaded) return
    loaded = true
    w.dataLayer = w.dataLayer ?? []
    // Google attend l'objet `arguments` lui-même, pas un tableau.
    w.gtag = function gtag() { w.dataLayer!.push(arguments) } // eslint-disable-line prefer-rest-params
    w.gtag('js', new Date())
    w.gtag('config', id)
    const script = document.createElement('script')
    script.async = true
    script.src = `${GA_SCRIPT_SRC}?id=${encodeURIComponent(id)}`
    document.head.append(script)
  }

  function stop() {
    // Interrupteur prévu par Google : plus rien n'est envoyé pour cet identifiant.
    w[disabled] = true
    const names = gaCookieNames(id, document.cookie.split(';').map(c => c.split('=')[0]!.trim()).filter(Boolean))
    // Les cookies sont posés sur le domaine le plus large possible : on les retire à chaque niveau.
    const parts = location.hostname.split('.')
    const domains = ['', ...parts.map((_, i) => `.${parts.slice(i).join('.')}`).filter(d => d.split('.').length > 2 || parts.length === 1)]
    for (const name of names) for (const domain of domains) document.cookie = `${name}=; Max-Age=0; path=/${domain ? `; domain=${domain}` : ''}`
  }

  const apply = (allowed: boolean) => (allowed ? start() : stop())
  window.addEventListener('cms:consent', event => apply((event as CustomEvent<Record<string, boolean>>).detail?.audience === true))
  // Le choix a pu être relu avant ce plugin.
  if (useCmsConsent().allows('audience')) start()
})
