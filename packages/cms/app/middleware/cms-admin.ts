/** Réserve une page aux administrateurs. À placer après `cms-auth`. */
export default defineNuxtRouteMiddleware(() => {
  if (useCmsUser().value?.role !== 'admin') return navigateTo('/admin')
})
