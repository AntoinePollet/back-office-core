import { and, count, eq, lt } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { CHANNELS, type StoredOrigin, channelOfRow } from '../../shared/attribution'
import { type FormDefinition, formDefinitions, formSummary, formatFormValue } from '../../shared/modules'
import type { CmsModuleDefinition } from '../utils/modules'
import { conversionForLead } from './google-conversions'

const definitions = () => formDefinitions(cmsConfig)

/** Formulaires du site : messages enregistrés, consultables dans le back-office, et déclencheur de workflow. */
export const formsModule: CmsModuleDefinition = {
  id: 'forms',
  category: 'forms',
  needsCode: 'forms({ contact: { label: \'Contact\', fields: { … } } })',
  label: 'Formulaires',
  // Icône « boîte de réception » de Lucide.
  logo: { style: 'stroke', color: 'currentColor', paths: ['M22 12h-6l-2 3h-4l-2-3H2', 'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z'] },
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
        { key: 'origin.channel', label: 'Provenance : canal (Google Ads, e-mail, moteur de recherche…)' },
        { key: 'origin.campaign', label: 'Provenance : nom de la campagne' },
        { key: 'origin.term', label: 'Provenance : mot-clé de l\'annonce' },
        { key: 'origin.source', label: 'Provenance : source (utm_source ou site d\'où vient le visiteur)' },
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
        return formEvent(id, def, 'exemple', values, '', { channel: 'google-ads', source: 'google', medium: 'cpc', campaign: 'printemps', term: 'avocat lyon' })
      },
    }]
  },
}

/** L'événement « formulaire envoyé », avec les variables proposées aux workflows. */
function formEvent(id: string, def: FormDefinition, submissionId: string, values: Record<string, unknown>, origin: string, from: StoredOrigin | null) {
  return {
    summary: `Formulaire « ${def.label} » envoyé`,
    target: id,
    context: {
      form: { name: def.label, summary: formSummary(def, values), adminUrl: `${origin}/admin/forms?message=${submissionId}` },
      fields: Object.fromEntries(Object.entries(def.fields).map(([key, field]) => [key, formatFormValue(field, values[key])])),
      origin: { channel: CHANNELS[channelOfRow(from)], campaign: from?.campaign ?? '', term: from?.term ?? '', source: from?.source ?? from?.referrer ?? '' },
    },
  }
}

/** Enregistre un message validé, fait le ménage des messages trop anciens et prévient les workflows. */
export async function storeSubmission(event: H3Event, id: string, def: FormDefinition, values: Record<string, unknown>, from: StoredOrigin | null = null) {
  const db = useDb(event)
  // Contact venu d'une annonce Google, avec l'accord du visiteur : à signaler à Google Ads (module Google Ads).
  const conversion = await conversionForLead(event, 'message', from)
  const row = { id: crypto.randomUUID(), form: id, values, origin: from, conversion, read: false, createdAt: new Date() }
  await db.insert(schema.formSubmissions).values(row)
  const { retentionDays } = moduleOptions<{ retentionDays: number }>('forms')
  await db.delete(schema.formSubmissions).where(lt(schema.formSubmissions.createdAt, new Date(Date.now() - retentionDays * 86_400_000)))
  emitCmsEvents(event, [{ name: 'form.submitted', module: 'forms', ...formEvent(id, def, row.id, values, getRequestURL(event).origin, from) }])
  return row
}

/** Les messages reçus sont des données personnelles : seuls l'administrateur et l'éditeur les lisent. */
export const canReadSubmissions = (user: { role: string }) => user.role === 'admin' || user.role === 'editor'

export async function requireSubmissionsAccess(event: H3Event) {
  await requireModule(event, 'forms')
  const user = await requireUser(event)
  if (!canReadSubmissions(user)) throw createError({ statusCode: 403, message: 'Les messages reçus sont réservés aux administrateurs et aux éditeurs.' })
  return user
}

export async function unreadSubmissions(event: H3Event) {
  const [row] = await useDb(event).select({ n: count() }).from(schema.formSubmissions)
    .where(and(eq(schema.formSubmissions.read, false)))
  return row?.n ?? 0
}
