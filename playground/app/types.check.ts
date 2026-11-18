// Vérification des types déduits de cms.config.ts. Ce fichier n'est jamais exécuté :
// `pnpm typecheck` échoue si l'autocomplétion des contenus ne fonctionne plus.
export async function typesCheck() {
  const { data: services } = await useCollection('services')
  const first = services.value![0]!
  const title: string = first.title
  const excerpt: string | null = first.excerpt
  const audience: 'companies' | 'individuals' | null = first.audience
  const coverUrl: string | undefined = first.cover?.url
  const category: string | undefined = first.category?.title
  const path: string | null = first.path
  // @ts-expect-error champ qui n'existe pas dans la collection
  first.inconnu
  // @ts-expect-error un titre obligatoire n'est jamais null
  const wrong: null = first.title

  // @ts-expect-error collection qui n'existe pas dans cms.config.ts
  useCollection('articles')

  const { data: page } = await useCollectionPage('services', { limit: 10, page: 2, where: { audience: 'companies', onQuote: true } })
  const total: number = page.value!.total
  const pageTitle: string = page.value!.items[0]!.title

  const { data: service } = await useEntry('services', 'droit-des-affaires')
  const body: string | null = service.value!.body

  const { data: home } = await useSingleton('home')
  const hero: string | undefined = home.value?.heroTitle
  const question: string | undefined = home.value?.faq[0]?.question
  const featured: string[] | undefined = home.value?.featured.map(s => s.title)
  // @ts-expect-error 'services' est une collection, pas une page unique
  useSingleton('services')

  return { title, excerpt, audience, coverUrl, category, path, wrong, total, pageTitle, body, hero, question, featured }
}

// Paiement : seules les collections déclarées vendables dans cms.config.ts sont acceptées.
export function checkoutTypesCheck() {
  const { checkout } = useCmsCheckout()
  checkout('products', 'id', { quantity: 2 })
  // @ts-expect-error collection qui n'est pas vendable
  checkout('services', 'id')
}
