// ───────────── Paiement en ligne (module `stripe`) ─────────────

type Sellable = import('#cms-types').CmsSellable

/**
 * Bouton « Acheter » : envoie au serveur le produit et la quantité, puis redirige vers la page de paiement de Stripe.
 * Le prix n'est jamais envoyé : le serveur relit celui qui est publié dans le back-office.
 *
 *   const { checkout, pending, error } = useCmsCheckout()
 *
 *   <button :disabled="pending" @click="checkout('products', product.id, { quantity })">Acheter</button>
 *   <p v-if="error">{{ error }}</p>
 *
 * Sans `returnPath`, un acheteur qui abandonne revient sur la page où il a cliqué.
 */
export function useCmsCheckout() {
  const pending = ref(false)
  const error = ref<string | null>(null)

  async function checkout(collection: Sellable, id: string, options: { quantity?: number; locale?: string; returnPath?: string } = {}) {
    if (pending.value) return false
    pending.value = true
    error.value = null
    try {
      const { url } = await cmsApi<{ url: string }>('/api/stripe/checkout', {
        method: 'POST',
        body: { collection, id, quantity: options.quantity ?? 1, locale: options.locale, returnPath: options.returnPath ?? window.location.pathname, origin: cmsVisitOrigin() },
      })
      window.location.assign(url)
      // La page part chez Stripe : le bouton reste désactivé jusque-là.
      return true
    }
    catch (e) {
      error.value = cmsErrorMessage(e, 'Le paiement n\'a pas pu être préparé. Réessayez dans un instant.')
      pending.value = false
      return false
    }
  }
  return { checkout, pending, error }
}

export type CmsCheckoutResult = {
  /**
   * - `paid` : Stripe a confirmé le paiement (événement signé reçu) ;
   * - `pending` : pas encore de confirmation (elle arrive en général en quelques secondes ; plus tard pour un virement) ;
   * - `failed` : le paiement différé a échoué ; `refunded` : remboursé depuis.
   */
  status: 'paid' | 'pending' | 'failed' | 'refunded'
  product: string | null
  quantity: number | null
  /** Montant payé, prêt à afficher (« 149,90 € »). */
  amount: string | null
}

/**
 * Page de succès (`/merci?session_id=…`) : dit où en est le paiement, sans jamais l'annoncer confirmé avant Stripe.
 * Tant que la confirmation n'est pas arrivée, l'état est relu toutes les 2 secondes, pendant 30 secondes au plus.
 *
 *   const { result } = useCmsCheckoutResult()
 *   <p v-if="result?.status === 'paid'">Merci ! Votre paiement de {{ result.amount }} est confirmé.</p>
 *   <p v-else>Merci ! Votre paiement est en cours de confirmation : vous recevrez un reçu par e-mail.</p>
 */
export function useCmsCheckoutResult() {
  const route = useRoute()
  const sessionId = computed(() => (typeof route.query.session_id === 'string' ? route.query.session_id : null))
  const result = ref<CmsCheckoutResult | null>(null)
  const loading = ref(true)
  let timer: ReturnType<typeof setTimeout> | undefined
  let tries = 0

  async function load() {
    if (!sessionId.value) { loading.value = false; return }
    result.value = await cmsApi<CmsCheckoutResult>(`/api/stripe/sessions/${encodeURIComponent(sessionId.value)}`).catch(() => result.value)
    loading.value = false
    if (result.value?.status === 'pending' && ++tries < 15) timer = setTimeout(load, 2000)
  }
  onMounted(load)
  onBeforeUnmount(() => clearTimeout(timer))
  return { result, loading, sessionId }
}
