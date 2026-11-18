import { and, count, eq, lt } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { type FormDefinition, formDefinitions, formSummary, formatFormValue } from '../../shared/modules'
import type { CmsModuleDefinition } from '../utils/modules'

const definitions = () => formDefinitions(cmsConfig)

/** Formulaires du site : messages enregistrés, consultables dans le back-office, et déclencheur de workflow. */
export const formsModule: CmsModuleDefinition = {
  id: 'forms',
  label: 'Formulaires',
  description: 'Formulaires du site (contact, devis…) : chaque message est enregistré, visible dans « Messages reçus », et peut déclencher un workflow.',
  adminPage: { to: '/admin/forms', label: 'Messages reçus' },

  workflowEvents: () => {
    const forms = Object.entries(definitions())
    // Les champs de tous les formulaires, sans doublon : {{ fields.email }} vaut pour chaque formulaire qui a ce champ.
    const fields = new Map<string, string>()
    for (const [, def] of forms) for (const [key, field] of Object.entries(def.fields)) if (!fields.has(key)) fields.set(key, field.label)
    return [{
      name: 'form.submitted',
      label: 'Un formulaire du site est envoyé',
      targets: forms.map(([key, def]) => ({ key, label: def.label })),
      targetsLabel: 'Pour quels formulaires',
      variables: [
        { key: 'form.name', label: 'Nom du formulaire' },
        { key: 'form.summary', label: 'Tout le message : une ligne par champ rempli' },
        { key: 'form.adminUrl', label: 'Adresse du message dans le back-office' },
        ...[...fields].map(([key, label]) => ({ key: `fields.${key}`, label: `Champ « ${label} »` })),
      ],
      sample: (target) => {
        const [id, def] = forms.find(([key]) => key === target) ?? forms[0]!
        const values = Object.fromEntries(Object.entries(def.fields).map(([key, field]) => [key,
          field.type === 'boolean' ? true
          : field.type === 'number' ? 3
          : field.type === 'select' ? (field.options as { value: string }[])[0]!.value
          : field.type === 'date' ? '2026-01-15'
          : field.format === 'email' ? 'visiteur@example.com'
          : field.type === 'textarea' ? 'Bonjour,\nceci est un message d\'exemple.' : 'Exemple']))
        return formEvent(id, def, 'exemple', values, '')
      },
    }]
  },
}

/** L'événement « formulaire envoyé », avec les variables proposées aux workflows. */
function formEvent(id: string, def: FormDefinition, submissionId: string, values: Record<string, unknown>, origin: string) {
  return {
    summary: `Formulaire « ${def.label} » envoyé`,
    target: id,
    context: {
      form: { name: def.label, summary: formSummary(def, values), adminUrl: `${origin}/admin/forms?message=${submissionId}` },
      fields: Object.fromEntries(Object.entries(def.fields).map(([key, field]) => [key, formatFormValue(field, values[key])])),
    },
  }
}

/** Enregistre un message validé, fait le ménage des messages trop anciens et prévient les workflows. */
export async function storeSubmission(event: H3Event, id: string, def: FormDefinition, values: Record<string, unknown>) {
  const db = useDb(event)
  const row = { id: crypto.randomUUID(), form: id, values, read: false, createdAt: new Date() }
  await db.insert(schema.formSubmissions).values(row)
  const { retentionDays } = moduleOptions<{ retentionDays: number }>('forms')
  await db.delete(schema.formSubmissions).where(lt(schema.formSubmissions.createdAt, new Date(Date.now() - retentionDays * 86_400_000)))
  emitCmsEvents(event, [{ name: 'form.submitted', module: 'forms', ...formEvent(id, def, row.id, values, getRequestURL(event).origin) }])
  return row
}

/** Les messages reçus sont des données personnelles : seuls l'administrateur et l'éditeur les lisent. */
export const canReadSubmissions = (user: { role: string }) => user.role === 'admin' || user.role === 'editor'

export async function requireSubmissionsAccess(event: H3Event) {
  requireModule('forms')
  const user = await requireUser(event)
  if (!canReadSubmissions(user)) throw createError({ statusCode: 403, message: 'Les messages reçus sont réservés aux administrateurs et aux éditeurs.' })
  return user
}

export async function unreadSubmissions(event: H3Event) {
  const [row] = await useDb(event).select({ n: count() }).from(schema.formSubmissions)
    .where(and(eq(schema.formSubmissions.read, false)))
  return row?.n ?? 0
}
