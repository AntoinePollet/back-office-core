/** Réserve une page aux administrateurs et aux éditeurs. À placer après `cms-auth`. */
export default defineNuxtRouteMiddleware(() => {
  if (!['admin', 'editor'].includes(useCmsUser().value?.role ?? '')) return navigateTo('/admin')
})
