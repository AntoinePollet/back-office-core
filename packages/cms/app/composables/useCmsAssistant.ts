/**
 * Assistant de rédaction du back-office (module `assistant`) : propose un texte alternatif, une description de page
 * ou une traduction. `active` dit si le module est activé sur ce site (les boutons ne s'affichent pas sinon) ; `busy`
 * porte la demande en cours, pour griser son bouton. Une erreur s'affiche en notification, et la fonction renvoie null.
 *
 * L'assistant ne fait que proposer : c'est l'écran qui place la proposition dans son formulaire, et la personne qui
 * l'enregistre.
 */
export function useCmsAssistant() {
  const schema = useState<{ modules?: { id: string }[] } | null>('cms-schema')
  const active = computed(() => !!schema.value?.modules?.some(m => m.id === 'assistant'))
  const busy = ref<string | null>(null)
  const toast = useCmsToast()

  async function ask<T>(key: string, path: string, body: Record<string, unknown>): Promise<T | null> {
    if (busy.value) return null
    busy.value = key
    try {
      // Une demande peut prendre plusieurs secondes : le bouton montre l'attente, l'écran reste utilisable.
      return await cmsApi<T>(`/api/cms/assistant/${path}`, { method: 'POST', body, busy: false })
    }
    catch (e) {
      toast.error(cmsErrorMessage(e, 'L\'assistant n\'a pas pu répondre.'))
      return null
    }
    finally {
      busy.value = null
    }
  }

  return {
    active,
    busy,
    /** Texte alternatif d'une image de la médiathèque, dans une langue. */
    alt: async (id: string, locale: string) => (await ask<{ alt: string }>(`alt:${id}:${locale}`, 'alt', { id, locale }))?.alt ?? null,
    /** Description d'une page, d'après le contenu du formulaire (champs communs et champs de la langue). */
    description: async (type: string, locale: string, values: Record<string, unknown>) => (await ask<{ description: string }>(`description:${locale}`, 'description', { type, locale, values }))?.description ?? null,
    /** Traduction des champs d'une langue vers une autre : le contenu d'arrivée complet. */
    translate: (type: string, from: string, to: string, values: Record<string, unknown>) => ask<{ values: Record<string, any>; translated: number; total: number }>(`translate:${to}`, 'translate', { type, from, to, values }),
  }
}
