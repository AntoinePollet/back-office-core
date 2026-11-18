/** Protège les pages du back-office : connexion requise, ou création du premier compte. */
export default defineNuxtRouteMiddleware(async () => {
  const user = useCmsUser()
  if (user.value) return
  try {
    // L'adresse est passée comme simple texte : le typage automatique des routes dépasse ici les capacités de TypeScript.
    user.value = await cmsApi<NonNullable<typeof user.value>>('/api/cms/me')
  }
  catch {
    const { needed } = await cmsApi<{ needed: boolean }>('/api/cms/setup')
    return navigateTo(needed ? '/admin/setup' : '/admin/login')
  }
})
