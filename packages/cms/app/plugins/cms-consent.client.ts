import { h, render } from 'vue'
import { CONSENT_SCRIPT_ID, type ConsentConfig } from '../../shared/consent'
import CmsConsentBanner from '../components/cms/ConsentBanner.vue'

/**
 * Consentement, côté page du site : lit la configuration posée par le serveur, relit le choix du visiteur et affiche
 * le bandeau (voir `useCmsConsent.ts`). Sans configuration (module inactif, back-office, aperçu), rien ne se passe.
 */
export default defineNuxtPlugin((nuxtApp) => {
  const source = document.getElementById(CONSENT_SCRIPT_ID)
  if (!source) return
  let config: ConsentConfig
  try { config = JSON.parse(source.textContent ?? '') }
  catch { return }
  if (!config?.purposes?.length) return
  // Une fois la page prête : le choix relu ne doit pas contredire ce que le serveur a rendu pendant la reprise.
  onNuxtReady(() => {
    cmsConsentStart(config)
    const host = document.createElement('div')
    host.setAttribute('data-cms-consent-host', '')
    document.body.append(host)
    const vnode = h(CmsConsentBanner)
    vnode.appContext = nuxtApp.vueApp._context
    render(vnode, host)
  })
})
