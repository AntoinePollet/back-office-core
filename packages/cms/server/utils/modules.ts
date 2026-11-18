import { eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import type { StoredSecret } from '../database/schema'
import { decryptSecret, encryptSecret, secretHint } from '../../shared/secrets'
import { brevoModule } from '../cms-modules/brevo'
import { formsModule } from '../cms-modules/forms'

/**
 * Modules : ce qu'un module apporte au serveur, et le registre où ils sont inscrits.
 *
 * Un module est actif sur un site quand il est déclaré dans `cms.config.ts` (`modules: [brevo(), …]`).
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

export type CmsModuleDefinition = {
  id: string
  label: string
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
  /** Déclencheurs de workflow apportés par le module. */
  workflowEvents?: () => ModuleWorkflowEvent[]
  /** Lien vers l'écran du module dans le back-office, s'il en a un en plus de ses réglages. */
  adminPage?: { to: string; label: string }
}

const registry = new Map<string, CmsModuleDefinition>([brevoModule, formsModule].map(m => [m.id, m]))

/** Inscrit un module écrit dans le projet client. À appeler au démarrage, depuis un plugin Nitro. */
export function registerCmsModule(definition: CmsModuleDefinition) {
  registry.set(definition.id, definition)
}

/** Modules actifs sur ce site : déclarés dans cms.config.ts et connus du serveur, dans l'ordre de la configuration. */
export function activeModules(): CmsModuleDefinition[] {
  return (cmsConfig.modules ?? []).map(m => registry.get(m.id)).filter((m): m is CmsModuleDefinition => !!m)
}

export const activeModule = (id: string) => activeModules().find(m => m.id === id)

/** Options écrites dans cms.config.ts pour un module actif. */
export const moduleOptions = <T = Record<string, unknown>>(id: string) =>
  (cmsConfig.modules?.find(m => m.id === id)?.options ?? {}) as T

/** Répond 404 si le module n'est pas actif sur ce site : ses routes n'existent alors pas. */
export function requireModule(id: string) {
  const found = activeModule(id)
  if (!found) throw createError({ statusCode: 404, message: 'Cette fonction n\'est pas activée sur ce site.' })
  return found
}

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
  const definition = registry.get(id)
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
    description: definition.description,
    settings,
    /** Tous les réglages obligatoires sont renseignés (ou le module n'en a pas). */
    configured: missing.length === 0,
    missing: missing.map(s => s.label),
    canTest: !!definition.test,
    adminPage: definition.adminPage ?? null,
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
  const data = { values, secrets, updatedBy: userId, updatedAt: new Date() }
  await useDb(event).insert(schema.moduleSettings).values({ module: definition.id, ...data })
    .onConflictDoUpdate({ target: schema.moduleSettings.module, set: data })
  ;(event.context._cmsModuleRows as Map<string, unknown> | undefined)?.delete(definition.id)
}
