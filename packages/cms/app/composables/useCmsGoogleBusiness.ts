import type { GooglePlace } from '../../shared/google-business'

export type { GooglePlace as CmsGooglePlace, GoogleReview as CmsGoogleReview } from '../../shared/google-business'

/**
 * La fiche Google de l'établissement (module `google-business`) : note, nombre d'avis, cinq avis, horaires.
 *
 *   const { data: place } = await useCmsGoogleBusiness()
 *   <p v-if="place?.rating">{{ place.rating }} / 5 sur Google Maps ({{ place.count }} avis)</p>
 *
 * `null` tant que le module n'est pas actif, pas réglé, ou que Google ne répond pas : la page n'affiche alors rien.
 * Pour afficher les avis eux-mêmes, `<CmsGoogleReviews />` respecte les règles d'affichage de Google (auteur, lien
 * vers l'avis, mention « Google Maps ») ; un affichage écrit à la main doit les respecter aussi.
 */
export function useCmsGoogleBusiness(options: { locale?: MaybeRefOrGetter<string | undefined> } = {}) {
  const locale = computed(() => toValue(options.locale))
  return useAsyncData(
    () => `cms-google-business:${locale.value ?? ''}`,
    () => cmsApi<{ place: GooglePlace | null }>('/api/google-business', { query: { locale: locale.value } }).then(r => r.place, () => null),
    { watch: [locale] },
  )
}
