import type { H3Event } from 'h3'
import type { CmsModuleDefinition, ModuleSettings } from '../utils/modules'

/** Adresse de l'API Brevo. Ne se change que pour les tests (variable NUXT_BREVO_API_URL). */
const apiUrl = (event: H3Event) => String(useRuntimeConfig(event).brevoApiUrl).replace(/\/$/, '')

/** « Nom <adresse> » ou une adresse seule. */
function parseSender(from: string) {
  const match = /^\s*(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/.exec(from) ?? /^()\s*(\S+@\S+)\s*$/.exec(from)
  return match ? { name: match[1] || cmsConfig.site.name, email: match[2]! } : null
}

async function brevoError(response: Response) {
  const detail = await response.text().then(t => (JSON.parse(t) as { message?: string }).message ?? t).catch(() => '')
  return detail ? ` : ${String(detail).slice(0, 200)}` : ''
}

/** Envoi d'e-mails par Brevo (https://www.brevo.com). */
export const brevoModule: CmsModuleDefinition = {
  id: 'brevo',
  label: 'Brevo',
  description: 'Envoi des e-mails du site : workflows, lien de nouveau mot de passe, notifications des formulaires.',
  settings: [
    {
      key: 'apiKey', label: 'Clé d\'API', type: 'secret', required: true,
      help: 'Dans Brevo : menu du compte → « SMTP et API » → « Clés API ». Elle commence par « xkeysib- ».',
      env: { key: 'brevoApiKey', name: 'NUXT_BREVO_API_KEY' },
    },
    {
      key: 'from', label: 'Expéditeur', type: 'text', required: true, placeholder: 'Cabinet Durand <contact@cabinet-durand.fr>',
      help: 'Le nom et l\'adresse que voient les destinataires. L\'adresse doit être validée dans Brevo (« Expéditeurs, domaines et IP dédiées »).',
      env: { key: 'emailFrom', name: 'NUXT_EMAIL_FROM' },
    },
  ],

  async test(event, settings) {
    if (!parseSender(settings.from ?? '')) throw new Error('L\'expéditeur doit être une adresse e-mail, ou « Nom <adresse> ».')
    const response = await fetch(`${apiUrl(event)}/account`, {
      headers: { 'api-key': settings.apiKey ?? '', 'accept': 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (response.status === 401) throw new Error('Brevo ne reconnaît pas cette clé d\'API.')
    if (!response.ok) throw new Error(`Brevo a répondu ${response.status}${await brevoError(response)}`)
    const account = await response.json().catch(() => ({})) as { companyName?: string; email?: string }
    const name = account.companyName || account.email
    return name ? `Connexion réussie au compte Brevo « ${name} ».` : 'Connexion à Brevo réussie.'
  },

  mail: {
    sender: (settings: ModuleSettings) => (settings.apiKey ? parseSender(settings.from ?? '') : null),
    async send(event, settings, message) {
      const response = await fetch(`${apiUrl(event)}/smtp/email`, {
        method: 'POST',
        headers: { 'api-key': settings.apiKey ?? '', 'content-type': 'application/json', 'accept': 'application/json' },
        body: JSON.stringify({
          sender: parseSender(settings.from ?? ''),
          to: message.to.map(email => ({ email })),
          subject: message.subject,
          htmlContent: message.html,
          ...(message.replyTo ? { replyTo: { email: message.replyTo } } : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) throw new Error(`Brevo a refusé l'envoi (${response.status})${await brevoError(response)}`)
    },
  },
}
