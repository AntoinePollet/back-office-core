/** Protège les pages du back-office : connexion requise, ou création du premier compte. */
export default defineNuxtRouteMiddleware(async (to) => {
  const user = useCmsUser()
  if (!user.value) {
    try {
      // L'adresse est passée comme simple texte : le typage automatique des routes dépasse ici les capacités de TypeScript.
      user.value = await cmsApi<NonNullable<typeof user.value>>('/api/cms/me')
    }
    catch {
      const { needed } = await cmsApi<{ needed: boolean }>('/api/cms/setup')
      return navigateTo(needed ? '/admin/setup' : '/admin/login')
    }
  }
  // Double authentification exigée et pas encore activée : un seul écran est ouvert (le serveur refuse le reste de toute façon).
  if (user.value?.twoFactor?.setupRequired && to.path !== CMS_TWO_FACTOR_SETUP_PATH) return navigateTo(CMS_TWO_FACTOR_SETUP_PATH)
})
