/**
 * Consentement des visiteurs (module `consent`) : un bandeau sur les pages du site demande l'accord du visiteur pour
 * chaque finalité qui en a besoin, garde son choix six mois et le laisse en changer à tout moment.
 *
 * Règles suivies (recommandations de la CNIL) : rien n'est déposé avant le choix ; refuser est aussi simple
 * qu'accepter (deux boutons de même forme, au même endroit) ; aucune case cochée d'avance ; le choix se change par un
 * lien toujours accessible (`<CmsConsentLink />`) ; il est redemandé au bout de six mois, ou quand une finalité
 * s'ajoute. Garder le choix lui-même sur l'appareil ne demande pas d'accord.
 *
 * Finalités : « publicité » (`ads`), apportée par le core dès que la provenance des contacts est relevée, et celles
 * que le site déclare lui-même (`consent({ purposes: { video: … } })`) pour ses propres contenus.
 *
 * Ce fichier porte la logique pure, partagée par le serveur (configuration envoyée aux pages) et le site (bandeau).
 */

/** Une finalité soumise à l'accord du visiteur. */
export type ConsentPurpose = { id: string; label: string; description: string }

/** Ce que les pages du site reçoivent pour afficher le bandeau. */
export type ConsentConfig = {
  purposes: ConsentPurpose[]
  /** Page « politique de confidentialité » du site, si elle est réglée. */
  policyUrl: string | null
  locales: string[]
  defaultLocale: string
}

/** Le choix gardé sur l'appareil : sa date, et oui ou non pour chaque finalité. */
export type StoredConsent = { v: 1; at: number; choices: Record<string, boolean> }

/** Durée de validité d'un choix : au-delà, il est redemandé. */
export const CONSENT_MONTHS = 6
export const CONSENT_STORAGE_KEY = 'cms-consent'
/** Identifiant de la balise qui porte la configuration dans la page. */
export const CONSENT_SCRIPT_ID = 'cms-consent-config'

/** Finalité apportée par le core : relier un contact à l'annonce qui l'a amené, d'une visite à l'autre et auprès de la régie. */
export const ADS_PURPOSE: ConsentPurpose = {
  id: 'ads',
  label: 'Mesure de la publicité',
  description: 'Savoir quelle annonce vous a amené sur ce site, y compris si vous revenez plus tard, et l\'indiquer à la régie publicitaire quand vous nous contactez.',
}

const KEY = /^[a-z][a-zA-Z0-9]*$/

/** Finalités déclarées par le site dans `consent({ purposes })` : identifiant → libellé et description. */
export type ConsentPurposeOptions = Record<string, { label: string; description: string }>

/** Erreurs d'une déclaration de finalités (messages prêts à afficher au démarrage). */
export function consentOptionsErrors(purposes: unknown): string[] {
  if (purposes === undefined) return []
  if (!purposes || typeof purposes !== 'object' || Array.isArray(purposes)) return ['consent() : purposes doit être un objet { identifiant: { label, description } }']
  const errors: string[] = []
  for (const [id, p] of Object.entries(purposes as Record<string, any>)) {
    if (!KEY.test(id)) errors.push(`consent() : finalité « ${id} » : l'identifiant doit être en camelCase, sans accent`)
    else if (id === ADS_PURPOSE.id) errors.push('consent() : la finalité « ads » est apportée par le core, elle ne se déclare pas')
    if (!p || typeof p.label !== 'string' || !p.label.trim()) errors.push(`consent() : finalité ${id} : label manquant`)
    if (!p || typeof p.description !== 'string' || !p.description.trim()) errors.push(`consent() : finalité ${id} : description manquante (ce que le visiteur accepte, en une phrase)`)
  }
  return errors
}

/** Finalités à proposer : la publicité si le site relève la provenance des contacts, puis celles du site. */
export function consentPurposes(custom: ConsentPurposeOptions | undefined, withAds: boolean): ConsentPurpose[] {
  return [
    ...(withAds ? [ADS_PURPOSE] : []),
    ...Object.entries(custom ?? {}).map(([id, p]) => ({ id, label: p.label, description: p.description })),
  ]
}

/** Adresse de la politique de confidentialité : une page du site ('/confidentialite') ou une adresse complète. */
export const isPolicyUrl = (value: string) => /^(\/[^/\s]\S*|https?:\/\/\S+)$/.test(value)

/**
 * Le choix gardé sur l'appareil, s'il vaut encore : bien formé, de moins de six mois, et avec une réponse pour chaque
 * finalité proposée aujourd'hui (une finalité ajoutée depuis fait redemander). Null : le bandeau doit s'afficher.
 */
export function readStoredConsent(raw: string | null | undefined, purposes: ConsentPurpose[], now = Date.now()): Record<string, boolean> | null {
  if (!raw) return null
  let stored: unknown
  try { stored = JSON.parse(raw) }
  catch { return null }
  const s = stored as Partial<StoredConsent> | null
  if (!s || s.v !== 1 || typeof s.at !== 'number' || !s.choices || typeof s.choices !== 'object') return null
  const limit = new Date(s.at)
  limit.setMonth(limit.getMonth() + CONSENT_MONTHS)
  if (s.at > now + 86_400_000 || limit.getTime() <= now) return null
  const choices: Record<string, boolean> = {}
  for (const p of purposes) {
    if (typeof s.choices[p.id] !== 'boolean') return null
    choices[p.id] = s.choices[p.id]!
  }
  return choices
}

/** Ce qui est écrit sur l'appareil : seulement les finalités proposées, en oui ou non. */
export function storedConsent(choices: Record<string, boolean>, purposes: ConsentPurpose[], now = Date.now()): StoredConsent {
  return { v: 1, at: now, choices: Object.fromEntries(purposes.map(p => [p.id, choices[p.id] === true])) }
}

/** Balise qui porte la configuration dans la page (`<` neutralisé : un texte ne peut pas fermer la balise). */
export const consentConfigTag = (config: ConsentConfig) =>
  `<script type="application/json" id="${CONSENT_SCRIPT_ID}">${JSON.stringify(config).replace(/</g, '\\u003c')}</script>`

// ───────────────────────── Textes du bandeau ─────────────────────────

const TEXTS = {
  fr: {
    title: 'Votre accord',
    intro: 'Ce site souhaite utiliser des traceurs pour les usages ci-dessous. Vous pouvez tout accepter, tout refuser ou choisir, et changer d\'avis à tout moment.',
    policy: 'Politique de confidentialité',
    accept: 'Tout accepter',
    refuse: 'Tout refuser',
    customize: 'Personnaliser',
    save: 'Enregistrer mes choix',
    back: 'Retour',
    manage: 'Gérer mes cookies',
    necessary: 'Le fonctionnement du site lui-même ne demande aucun accord.',
    on: 'Accepté',
    off: 'Refusé',
  },
  en: {
    title: 'Your consent',
    intro: 'This site would like to use trackers for the purposes below. You can accept all, refuse all or choose, and change your mind at any time.',
    policy: 'Privacy policy',
    accept: 'Accept all',
    refuse: 'Refuse all',
    customize: 'Customise',
    save: 'Save my choices',
    back: 'Back',
    manage: 'Manage cookies',
    necessary: 'The site itself needs no consent to work.',
    on: 'Accepted',
    off: 'Refused',
  },
} as const
export type ConsentTexts = { [K in keyof typeof TEXTS['fr']]: string }

/** Textes du bandeau dans une langue : français ou anglais ; toute autre langue reçoit l'anglais. */
export const consentTexts = (locale: string): ConsentTexts => (locale.toLowerCase().startsWith('fr') ? TEXTS.fr : TEXTS.en)

/** Langue d'une page d'après son adresse : `/en/services` → `en` si le site a cette langue, sinon la langue par défaut. */
export function consentLocale(path: string, config: Pick<ConsentConfig, 'locales' | 'defaultLocale'>) {
  const first = path.split('/')[1] ?? ''
  return config.locales.includes(first) ? first : config.defaultLocale
}
