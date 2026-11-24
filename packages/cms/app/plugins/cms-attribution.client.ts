import { readVisitOrigin } from '../../shared/attribution'

/**
 * Provenance des contacts, côté site : à l'arrivée du visiteur, lit l'adresse de la page (`utm_*`, identifiants de
 * clic des régies) et le site d'où il vient, puis la retient pour les formulaires et les paiements (voir
 * `useCmsAttribution.ts`). Rien n'est relevé dans le back-office, ni dans les aperçus.
 */
export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig().public.cmsAttribution as { enabled?: boolean } | undefined
  if (config?.enabled === false) return
  const router = useRouter()
  const watched = (path: string, query: Record<string, unknown>) => !path.startsWith('/admin') && !('preview' in query)

  const first = router.currentRoute.value
  if (watched(first.path, first.query)) {
    const origin = readVisitOrigin(location.href, document.referrer)
    if (origin) cmsRecordVisit(origin)
  }
  // Navigation dans le site : seul un lien interne qui porte lui-même des paramètres de campagne compte.
  router.afterEach((to) => {
    if (!watched(to.path, to.query)) return
    const origin = readVisitOrigin(new URL(to.fullPath, location.origin).href, '')
    if (origin) cmsRecordVisit(origin)
  })
})
