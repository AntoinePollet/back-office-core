/**
 * Modules du back-office : des fonctions qu'on ajoute à un site en une ligne de `cms.config.ts`.
 *
 *   import { brevo, forms } from 'backoffice-core/modules'
 *
 *   export default defineCms({
 *     site: { … },
 *     modules: [
 *       brevo(),
 *       forms({ contact: { label: 'Contact', fields: { … } } }),
 *     ],
 *   })
 *
 * Ce fichier ne contient que la partie déclarative (ce qu'on écrit dans la configuration). Ce que fait un module
 * côté serveur est décrit dans `server/cms-modules/`. Les clés d'API ne s'écrivent jamais ici : elles se saisissent
 * dans le back-office, écran « Modules », et sont enregistrées chiffrées.
 */
import { validateValues } from './content'
import type { AnyField } from './format'

/** Ce que `cms.config.ts` contient pour un module : son identifiant et ses options, sérialisables. */
export type CmsModuleRef = { id: string; options?: Record<string, unknown> }

const KEY = /^[a-z][a-zA-Z0-9]*$/
const fail = (message: string): never => { throw new Error(`Configuration invalide :\n  - ${message}`) }

// ───────────────────────── Brevo ─────────────────────────

/**
 * Envoi d'e-mails par Brevo : workflows, lien de nouveau mot de passe, notifications des formulaires.
 * La clé d'API et l'expéditeur se règlent dans le back-office (ou, à défaut, par les variables
 * NUXT_BREVO_API_KEY et NUXT_EMAIL_FROM de l'hébergement).
 */
export const brevo = () => ({ id: 'brevo' as const })

// ───────────────────────── Formulaires ─────────────────────────

/** Types de champ acceptés dans un formulaire du site. */
export const FORM_FIELD_TYPES = ['text', 'textarea', 'number', 'boolean', 'select', 'date'] as const

export type FormDefinition = {
  /** Nom du formulaire dans le back-office : « Contact », « Demande de devis ». */
  label: string
  /** Champs, écrits comme ceux d'une collection : `f.text({ label: 'Nom', required: true })`. */
  fields: Record<string, AnyField>
}

export type FormsOptions = {
  /** Nombre de jours pendant lesquels un message reçu est conservé. Défaut : 365. */
  retentionDays?: number
}

/** Limites appliquées à un champ texte qui n'en déclare pas : un formulaire public ne doit pas pouvoir remplir la base. */
export const FORM_DEFAULT_MAX = { text: 300, textarea: 5000 }
export const FORM_DEFAULT_RETENTION_DAYS = 365

/**
 * Formulaires du site (contact, devis…). Chaque message est validé, enregistré, visible dans le back-office
 * (« Messages reçus ») et peut déclencher un workflow, par exemple un e-mail de notification.
 * Côté site : `const form = useCmsForm('contact')`.
 */
export function forms<const F extends Record<string, FormDefinition>>(definitions: F, options: FormsOptions = {}) {
  if (!Object.keys(definitions).length) fail('forms() : aucun formulaire')
  for (const [id, def] of Object.entries(definitions)) {
    if (!KEY.test(id)) fail(`formulaire « ${id} » : l'identifiant doit être en camelCase, sans accent`)
    if (!def.label) fail(`formulaire ${id} : label manquant`)
    if (!Object.keys(def.fields ?? {}).length) fail(`formulaire ${id} : aucun champ`)
    for (const [key, field] of Object.entries(def.fields)) {
      const at = `formulaire ${id}.${key}`
      if (!KEY.test(key)) fail(`${at} : le nom doit être en camelCase, sans accent`)
      if (!field.label) fail(`${at} : label manquant`)
      if (!(FORM_FIELD_TYPES as readonly string[]).includes(field.type)) fail(`${at} : type « ${field.type} » non accepté dans un formulaire (${FORM_FIELD_TYPES.join(', ')})`)
      if (field.type === 'select') {
        const values = ((field.options ?? []) as { value: string }[]).map(o => o.value)
        if (!values.length || new Set(values).size !== values.length) fail(`${at} : options vides ou en double`)
      }
      if (field.showIf && !def.fields[(field.showIf as { field: string }).field]) fail(`${at}.showIf : champ introuvable`)
    }
  }
  const days = options.retentionDays
  if (days !== undefined && (!Number.isInteger(days) || days < 1)) fail('forms() : retentionDays doit être un nombre de jours entier')
  return { id: 'forms' as const, options: { forms: definitions, retentionDays: days ?? FORM_DEFAULT_RETENTION_DAYS } }
}

/** Valeur d'un champ de formulaire pendant la saisie, d'après son type. */
type FormValue<F> =
  F extends { type: 'boolean' } ? boolean
  : F extends { type: 'number' } ? number | null
  : F extends { type: 'select'; multiple: true; options: readonly { value: infer V }[] } ? V[]
  : F extends { type: 'select'; options: readonly { value: infer V }[] } ? V
  : string

/**
 * Les valeurs de chaque formulaire déclaré, déduites de cms.config.ts : c'est ce qui donne l'autocomplétion
 * de `useCmsForm('contact').values`. `never` si le site n'a pas de formulaire.
 */
export type InferForms<C> = C extends { modules: readonly (infer M)[] }
  ? M extends { id: 'forms'; options: { forms: infer D } } ? { [K in keyof D]: D[K] extends { fields: infer F } ? { -readonly [P in keyof F]?: FormValue<F[P]> } : never } : never
  : never

// ───────────────────────── Lecture ─────────────────────────

type WithModules = { modules?: readonly CmsModuleRef[] }

export const findModule = (config: WithModules, id: string) => config.modules?.find(m => m.id === id)

/** Formulaires déclarés par le module `forms`, ou un objet vide. */
export const formDefinitions = (config: WithModules) =>
  ((findModule(config, 'forms')?.options?.forms ?? {}) as Record<string, FormDefinition>)

/** Valeur d'un champ de formulaire telle qu'on l'affiche à une personne. */
export function formatFormValue(field: AnyField, value: unknown): string {
  if (value == null || value === '') return ''
  if (field.type === 'boolean') return value ? 'Oui' : 'Non'
  if (field.type === 'select') {
    const options = field.options as { value: string; label: string }[]
    return (Array.isArray(value) ? value : [value]).map(v => options.find(o => o.value === v)?.label ?? String(v)).join(', ')
  }
  return String(value)
}

/** Un message reçu, en texte : une ligne « Libellé : valeur » par champ rempli. */
export const formSummary = (def: FormDefinition, values: Record<string, unknown>) =>
  Object.entries(def.fields).map(([key, field]) => [field.label, formatFormValue(field, values[key])] as const)
    .filter(([, text]) => text !== '').map(([label, text]) => `${label} : ${text}`).join('\n')

/**
 * Nettoie ce qu'un visiteur envoie : ne garde que les champs du formulaire, retire les espaces autour des textes,
 * convertit les nombres saisis en texte et applique les longueurs maximales par défaut.
 * Renvoie les valeurs prêtes à valider et les champs à valider (avec leurs limites).
 */
export function prepareSubmission(def: FormDefinition, input: unknown) {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const values: Record<string, unknown> = {}
  const fields: Record<string, AnyField> = {}
  for (const [key, field] of Object.entries(def.fields)) {
    let v = raw[key]
    if (typeof v === 'string') v = v.trim()
    if (field.type === 'number' && typeof v === 'string' && v !== '') v = Number(v.replace(',', '.'))
    if (field.type === 'boolean') v = v === true || v === 'true' || v === 'on'
    values[key] = v === undefined ? null : v
    fields[key] = field.type === 'text' || field.type === 'textarea'
      ? { ...field, max: (field.max as number | undefined) ?? FORM_DEFAULT_MAX[field.type] }
      : field
  }
  return { values, fields }
}

/** Nettoie puis valide ce qu'un visiteur envoie. `errors` : { nomDuChamp: message }, vide si tout est bon. */
export function validateSubmission(def: FormDefinition, input: unknown) {
  const { values, fields } = prepareSubmission(def, input)
  const errors = validateValues(fields, values)
  for (const [key, field] of Object.entries(fields)) {
    if (errors[key]) continue
    // Une case obligatoire (« J'accepte… ») doit être cochée ; une date doit en être une.
    if (field.type === 'boolean' && field.required && values[key] !== true) errors[key] = 'Cette case doit être cochée.'
    if (field.type === 'date' && values[key] != null && values[key] !== '' && !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/.test(String(values[key]))) errors[key] = 'Date invalide.'
  }
  return { values, errors }
}
