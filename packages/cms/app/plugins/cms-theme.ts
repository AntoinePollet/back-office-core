import { type CmsTheme, themeCss } from '../../shared/theme'

/** Applique au site le thème enregistré depuis l'écran Apparence. Le back-office garde son apparence propre. */
export default defineNuxtPlugin(async () => {
  const { data } = await useFetch<{ theme: CmsTheme | null; adminColor: string | null }>('/api/cms/theme', { key: 'cms-theme' })
  const route = useRoute()
  // La couleur du back-office arrive par la même requête : elle est disponible dès la page de connexion.
  const adminColor = useState<string | null>('cms-admin-color', () => data.value?.adminColor ?? null)
  // L'écran de chargement du back-office s'affiche avant toute requête : il relit la couleur retenue ici.
  if (import.meta.client) {
    watch(adminColor, (color) => {
      try { color ? localStorage.setItem('cms-admin-color', color) : localStorage.removeItem('cms-admin-color') }
      catch { /* stockage refusé par le navigateur : l'écran de chargement garde la couleur par défaut */ }
    }, { immediate: true })
  }
  useHead({
    style: () => (data.value?.theme && !route.path.startsWith('/admin')
      ? [{ key: 'cms-theme', innerHTML: themeCss(data.value.theme) }]
      : []),
  })
})
