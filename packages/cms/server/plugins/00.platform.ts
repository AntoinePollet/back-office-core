/** Prépare l'hébergement au démarrage du serveur (sur un serveur Node : ouverture et mise à niveau de la base). */
export default defineNitroPlugin(() => {
  if (import.meta.prerender) return
  usePlatform().start?.()
})
