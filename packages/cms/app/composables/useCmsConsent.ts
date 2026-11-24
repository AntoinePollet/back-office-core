import { CONSENT_STORAGE_KEY, type ConsentConfig, readStoredConsent, storedConsent } from '../../shared/consent'

/**
 * Consentement du visiteur (module `consent`, voir `shared/consent.ts`), côté site.
 *
 *   const consent = useCmsConsent()
 *   <iframe v-if="consent.allows('video')" src="https://www.youtube-nocookie.com/embed/…" />
 *   <button v-else @click="consent.open()">Accepter les vidéos YouTube pour l'afficher</button>
 *
 * Tant que le visiteur n'a pas choisi, tout est refusé. Sur le serveur et pendant la reprise du rendu, tout est
 * refusé aussi : le choix n'est connu que du navigateur, il est appliqué une fois la page prête.
 * Chaque changement est aussi annoncé par l'événement `cms:consent` de `window` (`event.detail` : les choix).
 */
type State = {
  /** Configuration reçue du serveur ; null : module inactif, ou rien à demander. */
  config: ConsentConfig | null
  /** Oui ou non par finalité ; null tant que le visiteur n'a pas choisi (ou que son choix a expiré). */
  choices: Record<string, boolean> | null
  /** Le bandeau est affiché. */
  open: boolean
}

// État du navigateur seulement : sur le serveur, rien n'est jamais écrit ici (il serait partagé entre les visiteurs).
const state = reactive<State>({ config: null, choices: null, open: false })

function apply(choices: Record<string, boolean>) {
  state.choices = choices
  // La provenance du visiteur n'est gardée d'une visite à l'autre, et transmise, qu'avec son accord.
  cmsAttributionConsent(choices.ads === true)
  window.dispatchEvent(new CustomEvent('cms:consent', { detail: { ...choices } }))
}

/** Démarre le consentement dans le navigateur (plugin `cms-consent.client.ts`) : relit le choix gardé, ou ouvre le bandeau. */
export function cmsConsentStart(config: ConsentConfig) {
  state.config = config
  let raw: string | null = null
  try { raw = localStorage.getItem(CONSENT_STORAGE_KEY) }
  catch { /* stockage indisponible : le choix vaudra pour cette page */ }
  const choices = readStoredConsent(raw, config.purposes)
  if (choices) apply(choices)
  else state.open = true
}

function save(choices: Record<string, boolean>) {
  const config = state.config
  if (!config) return
  const stored = storedConsent(choices, config.purposes)
  try { localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(stored)) }
  catch { /* stockage indisponible */ }
  apply(stored.choices)
  state.open = false
}

export function useCmsConsent() {
  const all = (value: boolean) => Object.fromEntries((state.config?.purposes ?? []).map(p => [p.id, value]))
  return {
    /** Le module est actif et a quelque chose à demander. */
    active: computed(() => !!state.config),
    /** Le visiteur a fait son choix. */
    decided: computed(() => !!state.choices),
    /** Les finalités proposées, et le choix du visiteur (null avant qu'il ait choisi). */
    purposes: computed(() => state.config?.purposes ?? []),
    choices: computed(() => state.choices),
    config: computed(() => state.config),
    isOpen: computed(() => state.open),
    /** Le visiteur a-t-il accepté cette finalité ? Faux tant qu'il n'a pas choisi. */
    allows: (purpose: string) => state.choices?.[purpose] === true,
    acceptAll: () => save(all(true)),
    refuseAll: () => save(all(false)),
    save,
    /** Rouvre le bandeau, pour changer d'avis (lien « Gérer mes cookies »). */
    open: () => { if (state.config) state.open = true },
    /** Ferme le bandeau sans rien changer : possible seulement si un choix a déjà été fait. */
    close: () => { if (state.choices) state.open = false },
  }
}
