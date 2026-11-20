/**
 * Redirections manuelles en navigation interne (clic sur un lien du site, sans rechargement).
 *
 * À une visite directe, c'est le serveur qui redirige (server/redirects-error-handler.ts). Ici, le navigateur ne
 * demande rien au serveur pour changer de page : quand la navigation aboutit à une page introuvable, on pose donc
 * la question à `/_cms/redirect`. Une page qui existe ne déclenche aucun appel.
 */
type Answer = { to: string | null; status?: number; external?: boolean }

export default defineNuxtPlugin((nuxtApp) => {
  const ask = (path: string) => cmsApi<Answer>('/_cms/redirect', { query: { path } }).catch((): Answer => ({ to: null }))
  const isSite = (path: string) => path !== '/admin' && !path.startsWith('/admin/')

  // Adresse qui ne correspond à aucune page du site : la question est posée avant d'afficher la page 404.
  addRouteMiddleware('cms-redirects', async (to) => {
    // Au premier affichage, le serveur a déjà répondu.
    if (nuxtApp.isHydrating || to.matched.length || !isSite(to.path)) return
    const answer = await ask(to.fullPath)
    if (answer.to) return navigateTo(answer.to, { external: answer.external, replace: true })
  }, { global: true })

  // Page à adresse variable (« /services/[slug] ») qui déclare elle-même son contenu introuvable.
  nuxtApp.hook('app:error', async (error) => {
    const status = (error as { statusCode?: number } | null)?.statusCode
    const route = useRouter().currentRoute.value
    if (nuxtApp.isHydrating || status !== 404 || !isSite(route.path)) return
    const answer = await ask(route.fullPath)
    if (!answer.to) return
    if (answer.external) window.location.replace(answer.to)
    else await nuxtApp.runWithContext(() => clearError({ redirect: answer.to! }))
  })
})
