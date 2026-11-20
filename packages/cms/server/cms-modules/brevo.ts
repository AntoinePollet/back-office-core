import type { H3Event } from 'h3'
import type { CmsModuleDefinition, ModuleSettings } from '../utils/modules'

/** Adresse de l'API Brevo. Ne se change que pour les tests (variable NUXT_BREVO_API_URL). */
const apiUrl = (event: H3Event) => String(useRuntimeConfig(event).brevoApiUrl).replace(/\/$/, '')

async function brevoError(response: Response) {
  const detail = await response.text().then(t => (JSON.parse(t) as { message?: string }).message ?? t).catch(() => '')
  return detail ? ` : ${String(detail).slice(0, 200)}` : ''
}

/** Envoi d'e-mails par Brevo (https://www.brevo.com). */
export const brevoModule: CmsModuleDefinition = {
  id: 'brevo',
  category: 'email',
  label: 'Brevo',
  // Logo officiel de Brevo et sa couleur (tracé : Simple Icons).
  logo: { style: 'fill', color: '#0B996E', paths: ['M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zM7.2 4.8h5.747c2.34 0 3.895 1.406 3.895 3.516 0 1.022-.348 1.862-1.09 2.588C17.189 11.812 18 13.22 18 14.785c0 2.86-2.64 5.016-6.164 5.016H7.199v-15zm2.085 1.952v5.537h.07c.233-.432.858-.796 2.249-1.226 2.039-.659 3.037-1.52 3.037-2.655 0-.998-.766-1.656-1.924-1.656H9.285zm4.87 5.266c-.766.385-1.67.748-2.76 1.11-1.229.387-2.11 1.386-2.11 2.407v2.315h2.365c2.387 0 4.149-1.34 4.149-3.155 0-1.067-.625-2.087-1.645-2.677z'] },
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
