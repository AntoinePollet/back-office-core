/**
 * Suivi des erreurs (module `monitoring`) : les erreurs survenues dans le navigateur sont signalées au site, qui les
 * regroupe dans l'écran « Surveillance ». Rien ne part tant que le module n'est pas actif (le serveur pose alors une
 * balise dans la page). Ce qui part : le nom de l'erreur, son message, sa pile d'appels et l'adresse de la page sans
 * ses paramètres. Cinq erreurs au plus par page affichée : une erreur qui se répète en boucle ne noie rien.
 */
export default defineNuxtPlugin((nuxtApp) => {
  if (!document.querySelector('meta[name="cms-monitoring"]')) return
  let sent = 0
  const seen = new Set<string>()
  const report = (error: unknown, fallback = '') => {
    const e = (error && typeof error === 'object' ? error : { message: String(error ?? fallback) }) as { name?: string; message?: string; stack?: string }
    const message = String(e.message ?? fallback).slice(0, 500)
    if (!message || seen.has(message) || sent >= 5) return
    seen.add(message)
    sent++
    const body = JSON.stringify({ type: e.name ?? 'Error', message, stack: String(e.stack ?? '').slice(0, 4000), path: location.pathname })
    // `sendBeacon` part même si la page se ferme ; à défaut, une requête ordinaire.
    if (!navigator.sendBeacon?.('/api/monitoring/error', new Blob([body], { type: 'text/plain' }))) fetch('/api/monitoring/error', { method: 'POST', body, keepalive: true }).catch(() => {})
  }
  window.addEventListener('error', (event) => { if (event.error || event.message) report(event.error ?? { message: event.message }) })
  window.addEventListener('unhandledrejection', event => report(event.reason, 'Promesse rejetée sans raison'))
  // Les erreurs des composants ne remontent pas jusqu'à la fenêtre : Vue les donne ici.
  nuxtApp.hook('vue:error', error => report(error))
})
