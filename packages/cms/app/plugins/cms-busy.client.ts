import { cmsBusyTrigger, cmsIsBusy } from '../composables/cmsBusy'

/**
 * Back-office : retient l'élément sur lequel on agit, pour le bloquer pendant que son action s'exécute, et refuse
 * une seconde demande tant que la première n'est pas terminée. Voir composables/cmsBusy.ts.
 */
export default defineNuxtPlugin(() => {
  const TRIGGER = 'button, a, input, select, summary, [role="button"], [role="menuitem"]'
  const inAdmin = () => location.pathname.startsWith('/admin')
  const refuse = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation() }

  // En phase de capture : avant le code de l'écran, qui ne reçoit donc pas une demande refusée.
  document.addEventListener('click', (event) => {
    if (!inAdmin()) return
    const el = (event.target as Element | null)?.closest<HTMLElement>(TRIGGER) ?? null
    if (cmsIsBusy(el)) return refuse(event)
    cmsBusyTrigger(el)
  }, true)

  // Envoi d'un formulaire : par son bouton, ou par la touche Entrée (c'est alors son bouton principal qui est bloqué).
  document.addEventListener('submit', (event) => {
    if (!inAdmin()) return
    const form = event.target as HTMLFormElement
    const button = (event as SubmitEvent).submitter ?? form.querySelector<HTMLElement>('button:not([type="button"]), input[type="submit"]')
    if (cmsIsBusy(button) || cmsIsBusy(form)) return refuse(event)
    cmsBusyTrigger(button ?? form)
  }, true)

  // Listes de choix et cases à cocher qui enregistrent dès qu'on les change (rôle d'un compte, module activé…).
  document.addEventListener('change', (event) => {
    if (!inAdmin()) return
    const el = event.target as HTMLElement
    if (el.matches('select, input[type="checkbox"], input[type="radio"]')) cmsBusyTrigger(el)
  }, true)
})
