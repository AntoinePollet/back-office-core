import { readGoogleBusiness } from '../cms-modules/google-business'

/**
 * La fiche Google de l'établissement pour le site (module `google-business`) : note, nombre d'avis, cinq avis,
 * horaires. `?locale=fr` : langue des textes de Google. Route publique. `place` est null tant que le module n'est
 * pas réglé ou que Google ne répond pas : la page n'affiche alors rien, sans erreur.
 */
export default defineEventHandler(async (event) => {
  await requireModule(event, 'google-business')
  const { site } = cmsConfig
  const wanted = String(getQuery(event).locale ?? '')
  const answer = await readGoogleBusiness(event, site.locales.includes(wanted) ? wanted : site.defaultLocale)
  if (answer.state !== 'ok') return { place: null }
  allowSiteCache(event)
  return { place: answer.place }
})
