import { readGoogleBusiness } from '../../../cms-modules/google-business'

/** La fiche Google de l'établissement pour le back-office : la même que sur le site, ou la raison de son absence. */
export default defineEventHandler(async (event) => {
  await requireModule(event, 'google-business')
  await requireUser(event)
  return readGoogleBusiness(event, cmsConfig.site.defaultLocale)
})
