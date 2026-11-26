import { eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import type { StoredSecret } from '../database/schema'
import { decryptSecret, encryptSecret, secretHint } from '../../shared/secrets'
import type { AudiencePeriod, AudienceStats } from '../../shared/analytics'
import type { ModuleCategory } from '../../shared/modules'
import { brevoModule } from '../cms-modules/brevo'
import { resendModule } from '../cms-modules/resend'
import { plausibleModule } from '../cms-modules/plausible'
import { formsModule } from '../cms-modules/forms'
import { stripeModule } from '../cms-modules/stripe'
import { analyticsModule } from '../cms-modules/analytics'
import { turnstileModule } from '../cms-modules/turnstile'
import { googleAdsModule } from '../cms-modules/google-ads'
import { consentModule } from '../cms-modules/consent'
import { newsletterModule } from '../cms-modules/newsletter'
import { searchConsoleModule } from '../cms-modules/search-console'
import { googleAnalyticsModule } from '../cms-modules/google-analytics'
import { appointmentsModule } from '../cms-modules/appointments'
import { googleBusinessModule } from '../cms-modules/google-business'
import { assistantModule } from '../cms-modules/assistant'
import { monitoringModule } from '../cms-modules/monitoring'

/**
 * Modules : ce qu'un module apporte au serveur, et le registre où ils sont inscrits.
 *
 * Tous les modules connus sont montrés dans l'écran « Modules » du back-office, où un administrateur les active ou
 * les désactive. Sans choix enregistré, un module est actif s'il est déclaré dans `cms.config.ts`
 * (`modules: [brevo(), …]`) : un site existant garde ses modules. Un module qui a besoin d'options écrites dans le code
 * (`needsCode` : les formulaires, les produits vendus) ne peut être actif que s'il est déclaré.
 *
 * Sa définition, ici, dit ce qu'il sait faire. Un projet client peut inscrire son propre module depuis un
 * plugin Nitro (`registerCmsModule({ id: 'mon-module', … })`) et le déclarer avec `{ id: 'mon-module' }`.
 */

/** Un réglage saisi dans le back-office, écran « Modules ». */
export type ModuleSettingField = {
  key: string
  label: string
  /** `secret` : clé d'API. Enregistrée chiffrée, jamais renvoyée à l'interface. */
  type: 'text' | 'secret'
  help?: string
  placeholder?: string
  required?: boolean
  /** Réglage de l'hébergement utilisé tant que rien n'est saisi : clé de `runtimeConfig` et nom de la variable à afficher. */
  env?: { key: string; name: string }
}

export type ModuleSettings = Record<string, string>
type Variable = { key: string; label: string }
export type TemplateContext = Record<string, Record<string, string>>

/** Un déclencheur de workflow apporté par un module. */
export type ModuleWorkflowEvent = {
  /** Nom de l'événement : 'form.submitted'. */
  name: string
  /** Libellé dans la liste « Quand » : « Un formulaire du site est envoyé ». */
  label: string
  /** Variables utilisables dans les textes. */
  variables: Variable[]
  /** Ce sur quoi on peut restreindre le workflow (les formulaires, par exemple), et la question posée. */
  targets?: { key: string; label: string }[]
  targetsLabel?: string
  /** Données d'exemple pour le bouton « Tester ». */
  sample: (target?: string) => { summary: string; context: TemplateContext; target?: string }
}

export type MailMessage = { to: string[]; subject: string; html: string; replyTo?: string }

/**
 * Logo d'un module, affiché dans l'écran « Modules ». Un tracé SVG dans une grille de 24 × 24.
 * - `fill` : logo officiel d'une marque, rempli de sa couleur (tracés de https://simpleicons.org, couleur de la marque) ;
 * - `stroke` : icône dessinée au trait (style Lucide), pour un module sans marque.
 */
export type ModuleLogo = { style: 'fill' | 'stroke'; paths: string[]; color: string }


/** Un module de mesure d'audience : la balise à ajouter aux pages, et la lecture des statistiques pour l'écran « Audience ». */
export type AudienceCapability = {
  /** Réglages complets et valides : le module peut mesurer et lire. */
  ready: (settings: ModuleSettings) => boolean
  /** Le fournisseur dépose des cookies : il ne mesure qu'avec l'accord du visiteur (finalité « audience » du module Consentement). */
  cookies?: boolean
  /** Balise HTML à ajouter à la fin des pages du site, ou null si les réglages ne le permettent pas encore. */
  beacon: (settings: ModuleSettings) => string | null
  /** Statistiques d'une période se terminant aujourd'hui. Lève une `AudienceError` lisible en cas de refus ou de panne. */
  stats: (event: H3Event, settings: ModuleSettings, period: AudiencePeriod) => Promise<AudienceStats>
}

export type CmsModuleDefinition = {
  id: string
  label: string
  /** Famille, pour ranger l'écran « Modules ». Défaut : « Autres ». */
  category?: ModuleCategory
  /**
   * Le module a besoin d'options écrites dans cms.config.ts : il ne peut pas être activé depuis le back-office tant
   * qu'il n'y est pas déclaré. Valeur : la ligne à ajouter, montrée dans l'écran « Modules ».
   */
  needsCode?: string
  logo?: ModuleLogo
  /** Une phrase : à quoi sert le module. */
  description: string
  settings?: ModuleSettingField[]
  /** Vérifie les réglages sans rien envoyer d'irréversible. Renvoie une phrase de confirmation, ou lève une erreur lisible. */
  test?: (event: H3Event, settings: ModuleSettings) => Promise<string>
  /** Le module sait envoyer des e-mails. `sender` renvoie null tant que l'expéditeur n'est pas réglé correctement. */
  mail?: {
    sender: (settings: ModuleSettings) => { name: string; email: string } | null
    send: (event: H3Event, settings: ModuleSettings, message: MailMessage) => Promise<void>
  }
  /**
   * Le module tient des listes de contacts (Brevo, Resend) : un inscrit à la lettre d'information peut y être
   * ajouté ou retiré. `list` : l'identifiant de la liste, tel qu'il est saisi dans les réglages de la lettre.
   * Chaque fonction lève une erreur lisible en cas de refus.
   */
  contacts?: {
    add: (event: H3Event, settings: ModuleSettings, list: string, email: string) => Promise<void>
    remove: (event: H3Event, settings: ModuleSettings, list: string, email: string) => Promise<void>
    /** Vérifie que la liste existe ; renvoie son nom. */
    check: (event: H3Event, settings: ModuleSettings, list: string) => Promise<string>
  }
  /** Déclencheurs de workflow apportés par le module. */
  workflowEvents?: () => ModuleWorkflowEvent[]
  /** Lien vers l'écran du module dans le back-office, s'il en a un en plus de ses réglages. */
  adminPage?: { to: string; label: string }
  /** Informations à recopier ailleurs (l'adresse d'un webhook…), affichées sous les réglages avec un bouton « Copier ». */
  details?: (event: H3Event) => { label: string; value: string; help?: string }[]
  /** Refuse des réglages mal saisis à l'enregistrement : un message par réglage refusé (clé du réglage → message). */
  validate?: (values: ModuleSettings) => Record<string, string>
  /** Les réglages changent les pages du site (balise, clé publique) : leur enregistrement vide le cache du site. */
  affectsSite?: boolean
  /** Le module mesure l'audience du site. */
  audience?: AudienceCapability
}

/** Construit au premier usage : les modules intégrés utilisent eux-mêmes ce fichier, ils ne sont pas encore chargés à son import. */
let builtin: Map<string, CmsModuleDefinition> | undefined
const registry = () => (builtin ??= new Map<string, CmsModuleDefinition>([brevoModule, resendModule, analyticsModule, plausibleModule, googleAnalyticsModule, formsModule, newsletterModule, appointmentsModule, stripeModule, turnstileModule, googleAdsModule, searchConsoleModule, googleBusinessModule, consentModule, monitoringModule, assistantModule].map(m => [m.id, m])))

/** Inscrit un module écrit dans le projet client. À appeler au démarrage, depuis un plugin Nitro. */
export function registerCmsModule(definition: CmsModuleDefinition) {
  registry().set(definition.id, definition)
}

/** Tous les modules connus : déclarés dans cms.config.ts d'abord (dans leur ordre), puis les autres. */
export function allModules(): CmsModuleDefinition[] {
  const declared = (cmsConfig.modules ?? []).map(m => registry().get(m.id)).filter((m): m is CmsModuleDefinition => !!m)
  return [...declared, ...[...registry().values()].filter(m => !declared.includes(m))]
}

export const findModuleDefinition = (id: string) => registry().get(id)

/** Le module est-il déclaré dans cms.config.ts ? */
export const isDeclared = (id: string) => !!cmsConfig.modules?.some(m => m.id === id)

/** Le module peut-il être actif ? Non pour un module qui a besoin d'options dans le code et n'y est pas déclaré. */
export const canEnable = (definition: CmsModuleDefinition) => !definition.needsCode || isDeclared(definition.id)

const TOGGLES_KEY = 'modules'
type Toggles = Record<string, boolean>

/** Choix enregistrés dans le back-office (module → activé), lus une fois par requête. */
async function toggles(event: H3Event): Promise<Toggles> {
  return (event.context._cmsModuleToggles ??= useDb(event).select().from(schema.settings).where(eq(schema.settings.key, TOGGLES_KEY))
    .then(([row]) => (row?.value && typeof row.value === 'object' ? row.value as Toggles : {}))) as Promise<Toggles>
}

/** Le module est-il activé : choix du back-office, sinon déclaré dans cms.config.ts. */
async function isEnabled(event: H3Event, definition: CmsModuleDefinition) {
  if (!canEnable(definition)) return false
  return (await toggles(event))[definition.id] ?? isDeclared(definition.id)
}

/** Modules actifs sur ce site, dans l'ordre de `allModules`. */
export async function activeModules(event: H3Event): Promise<CmsModuleDefinition[]> {
  const out: CmsModuleDefinition[] = []
  for (const definition of allModules()) if (await isEnabled(event, definition)) out.push(definition)
  return out
}

export const activeModule = async (event: H3Event, id: string) => (await activeModules(event)).find(m => m.id === id)

/** Active ou désactive un module. Les réglages du module sont gardés. */
export async function setModuleEnabled(event: H3Event, definition: CmsModuleDefinition, enabled: boolean) {
  if (enabled && !canEnable(definition)) throw createError({ statusCode: 400, message: `${definition.label} doit d'abord être déclaré dans cms.config.ts : ${definition.needsCode}` })
  const value = { ...(await toggles(event)), [definition.id]: enabled }
  const now = new Date()
  await useDb(event).insert(schema.settings).values({ key: TOGGLES_KEY, value, updatedAt: now })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: now } })
  event.context._cmsModuleToggles = Promise.resolve(value)
}

/** Options écrites dans cms.config.ts pour un module (vides s'il n'y est pas déclaré). */
export const moduleOptions = <T = Record<string, unknown>>(id: string) =>
  (cmsConfig.modules?.find(m => m.id === id)?.options ?? {}) as T

/** Répond 404 si le module n'est pas actif sur ce site : ses routes n'existent alors pas. */
export async function requireModule(event: H3Event, id: string) {
  const found = await activeModule(event, id)
  if (!found) throw createError({ statusCode: 404, message: 'Cette fonction n\'est pas activée sur ce site.' })
  return found
}

/** Un module connu (actif ou non), pour son écran de réglages. 404 sinon. */
export function requireKnownModule(id: string) {
  const found = findModuleDefinition(id)
  if (!found) throw createError({ statusCode: 404, message: 'Module inconnu.' })
  return found
}

/** Secret du site (NUXT_AUTH_SECRET) : chiffre les clés d'API et signe les liens envoyés par e-mail. */
export const cmsSiteSecret = (event: H3Event) => siteSecret(event)

function siteSecret(event: H3Event) {
  const secret = useRuntimeConfig(event).authSecret || (import.meta.dev ? 'secret-de-developpement-a-ne-pas-utiliser-en-production' : '')
  if (!secret) throw createError({ statusCode: 500, message: 'Variable NUXT_AUTH_SECRET manquante.' })
  return secret
}

type Row = typeof schema.moduleSettings.$inferSelect
async function loadRow(event: H3Event, id: string): Promise<Row | undefined> {
  const cache = (event.context._cmsModuleRows ??= new Map()) as Map<string, Promise<Row | undefined>>
  if (!cache.has(id)) cache.set(id, useDb(event).select().from(schema.moduleSettings).where(eq(schema.moduleSettings.module, id)).then(rows => rows[0]))
  return cache.get(id)
}

const envValue = (event: H3Event, field: ModuleSettingField) =>
  (field.env ? String((useRuntimeConfig(event) as Record<string, unknown>)[field.env.key] ?? '') : '')

/**
 * Réglages d'un module, prêts à l'emploi : ce qui est saisi dans le back-office, sinon le réglage de l'hébergement.
 * Les clés d'API sont déchiffrées : ne jamais renvoyer ce résultat à l'interface.
 */
export async function moduleSettings(event: H3Event, id: string): Promise<ModuleSettings> {
  const definition = registry().get(id)
  const row = await loadRow(event, id)
  const out: ModuleSettings = {}
  for (const field of definition?.settings ?? []) {
    const stored = field.type === 'secret'
      ? (row?.secrets[field.key] ? await decryptSecret(siteSecret(event), row.secrets[field.key]!.value) : null)
      : row?.values[field.key]
    out[field.key] = stored || envValue(event, field)
  }
  return out
}

/** État d'un réglage tel que l'interface peut le montrer : jamais la valeur d'une clé d'API. */
export type SettingState = ModuleSettingField & {
  /** Valeur saisie dans le back-office (réglages non secrets seulement). */
  value?: string
  /** Clé d'API : enregistrée ou non, et ses derniers caractères. */
  saved?: boolean
  hint?: string
  /** Une clé est enregistrée mais ne peut plus être lue (le secret du site a changé) : il faut la saisir à nouveau. */
  unreadable?: boolean
  /** Rien n'est saisi, mais l'hébergement fournit une valeur. */
  fromEnv: boolean
}

export async function describeModule(event: H3Event, definition: CmsModuleDefinition) {
  const row = await loadRow(event, definition.id)
  const enabled = await isEnabled(event, definition)
  const settings: SettingState[] = []
  for (const field of definition.settings ?? []) {
    const env = !!envValue(event, field)
    if (field.type === 'secret') {
      const stored = row?.secrets[field.key]
      const unreadable = !!stored && (await decryptSecret(siteSecret(event), stored.value)) === null
      settings.push({ ...field, saved: !!stored, hint: stored?.hint, unreadable, fromEnv: !stored && env })
    }
    else {
      const value = row?.values[field.key] ?? ''
      settings.push({ ...field, value, fromEnv: !value && env })
    }
  }
  const missing = settings.filter(s => s.required && !s.fromEnv && (s.type === 'secret' ? !s.saved || s.unreadable : !s.value))
  return {
    id: definition.id,
    label: definition.label,
    category: definition.category ?? 'other',
    description: definition.description,
    /** Activé sur ce site. */
    enabled,
    /** Peut être activé depuis le back-office ; sinon `needsCode` dit quoi ajouter à cms.config.ts. */
    canEnable: canEnable(definition),
    needsCode: canEnable(definition) ? null : definition.needsCode ?? null,
    logo: definition.logo ?? null,
    settings,
    /** Tous les réglages obligatoires sont renseignés (ou le module n'en a pas). */
    configured: missing.length === 0,
    missing: missing.map(s => s.label),
    canTest: !!definition.test,
    adminPage: definition.adminPage ?? null,
    details: definition.details?.(event) ?? [],
    updatedAt: row?.updatedAt ?? null,
  }
}

/**
 * Enregistre les réglages saisis. Pour une clé d'API : un texte la remplace, `null` la retire,
 * une valeur absente la laisse telle quelle (l'interface ne la connaît pas et ne peut donc pas la renvoyer).
 */
export async function saveModuleSettings(event: H3Event, definition: CmsModuleDefinition, body: { values?: Record<string, unknown>; secrets?: Record<string, unknown> }, userId: string) {
  const row = await loadRow(event, definition.id)
  const values: Record<string, string> = {}
  const secrets: Record<string, StoredSecret> = {}
  for (const field of definition.settings ?? []) {
    if (field.type === 'text') {
      const value = String(body.values?.[field.key] ?? row?.values[field.key] ?? '').trim()
      if (value.length > 500) throw createError({ statusCode: 400, message: `${field.label} : 500 caractères au maximum.` })
      if (value) values[field.key] = value
      continue
    }
    const given = body.secrets?.[field.key]
    if (given === undefined) {
      if (row?.secrets[field.key]) secrets[field.key] = row.secrets[field.key]!
    }
    else if (given !== null && String(given).trim()) {
      const plain = String(given).trim()
      if (plain.length > 500) throw createError({ statusCode: 400, message: `${field.label} : 500 caractères au maximum.` })
      secrets[field.key] = { value: await encryptSecret(siteSecret(event), plain), hint: secretHint(plain) }
    }
  }
  const invalid = Object.values(definition.validate?.(values) ?? {})
  if (invalid.length) throw createError({ statusCode: 400, message: invalid.join(' ') })
  const data = { values, secrets, updatedBy: userId, updatedAt: new Date() }
  await useDb(event).insert(schema.moduleSettings).values({ module: definition.id, ...data })
    .onConflictDoUpdate({ target: schema.moduleSettings.module, set: data })
  ;(event.context._cmsModuleRows as Map<string, unknown> | undefined)?.delete(definition.id)
}
