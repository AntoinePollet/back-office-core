/**
 * Action en cours : le bouton qui l'a lancée est bloqué et montre un petit indicateur jusqu'à la réponse du serveur.
 * Une même action ne peut donc pas partir deux fois (création de compte, changement de mot de passe, suppression…).
 *
 * Rien à écrire dans les écrans : le navigateur retient l'élément sur lequel on vient d'agir (clic, envoi de formulaire,
 * choix dans une liste : voir plugins/cms-busy.client.ts), et `cmsApi` lui rattache la requête d'écriture qui part
 * aussitôt. L'élément porte alors `data-cms-busy` : son apparence est dans admin.css, et les clics sont refusés.
 * Pour qu'un élément ne soit jamais bloqué (enregistrement qui se voit tout de suite à l'écran) : `data-cms-busy-off`.
 */
export const CMS_BUSY_ATTR = 'data-cms-busy'

/** Élément sur lequel on vient d'agir. `chained` : il vient de recevoir une réponse et enchaîne sur d'autres requêtes. */
let current: { el: HTMLElement; chained: boolean } | null = null
let forget: ReturnType<typeof setTimeout> | undefined
const pending = new WeakMap<HTMLElement, number>()

/**
 * Retient l'élément jusqu'à la fin de la tâche en cours du navigateur : le temps, pour le code de l'écran, de lancer
 * sa requête (y compris après une question « Confirmer ? » ou une attente très courte).
 */
export function cmsBusyTrigger(el: HTMLElement | null, chained = false) {
  clearTimeout(forget)
  current = el && !el.closest('[data-cms-busy-off]') ? { el, chained } : null
  if (current) forget = setTimeout(() => { current = null })
}

/** Vrai si l'élément, ou un élément qui le contient, attend une réponse du serveur. */
export const cmsIsBusy = (el: Element | null) => !!el?.closest(`[${CMS_BUSY_ATTR}]`)

function hold(el: HTMLElement) {
  pending.set(el, (pending.get(el) ?? 0) + 1)
  el.setAttribute(CMS_BUSY_ATTR, '')
  el.setAttribute('aria-busy', 'true')
}
function release(el: HTMLElement) {
  const left = (pending.get(el) ?? 1) - 1
  pending.set(el, left)
  if (left > 0) return
  el.removeAttribute(CMS_BUSY_ATTR)
  el.removeAttribute('aria-busy')
}

/**
 * Rattache une requête à l'élément sur lequel on vient d'agir. Une simple lecture ne bloque rien, sauf quand elle
 * suit immédiatement la réponse d'une écriture (« enregistrer, puis relire la liste ») : le bouton reste alors
 * bloqué jusqu'au bout de l'enchaînement, sans se rallumer entre deux requêtes.
 */
export function cmsBusyTrack<T>(request: Promise<T>, method?: string): Promise<T> {
  if (!import.meta.client || !current) return request
  const { el, chained } = current
  const read = !method || ['GET', 'HEAD'].includes(method.toUpperCase())
  if (read && !chained) return request
  hold(el)
  const done = () => {
    // Le code qui attendait cette réponse reprend juste après : ce qu'il lance maintenant appartient à la même action.
    cmsBusyTrigger(el, true)
    setTimeout(() => release(el))
  }
  return request.then((value) => { done(); return value }, (error) => { done(); throw error })
}
