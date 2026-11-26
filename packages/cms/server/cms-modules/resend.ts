import type { H3Event } from 'h3'
import type { CmsModuleDefinition, MailMessage, ModuleSettings } from '../utils/modules'

/** Adresse de l'API Resend. Ne se change que pour les tests (variable NUXT_RESEND_API_URL). */
const apiUrl = (event: H3Event) => String(useRuntimeConfig(event).resendApiUrl).replace(/\/$/, '')

/** Resend refuse les appels sans User-Agent : un nom générique, sans rien qui désigne le site. */
const headers = (settings: ModuleSettings) => ({
  'authorization': `Bearer ${settings.apiKey ?? ''}`,
  'content-type': 'application/json',
  'accept': 'application/json',
  'user-agent': 'backoffice-core',
})

/** Erreur renvoyée par Resend : `{ statusCode, name, message }`. */
async function resendError(response: Response) {
  const text = await response.text().catch(() => '')
  try {
    const json = JSON.parse(text) as { name?: string; message?: string }
    return { name: json.name ?? '', message: String(json.message ?? '').slice(0, 200) }
  }
  catch {
    return { name: '', message: text.slice(0, 200) }
  }
}

const detail = async (response: Response) => { const error = await resendError(response); return error.message ? ` : ${error.message}` : '' }

/** Adresse d'essai de Resend : elle n'envoie qu'à l'adresse du compte Resend. */
const TEST_DOMAIN = 'resend.dev'

/** Envoi d'e-mails par Resend (https://resend.com). */
export const resendModule: CmsModuleDefinition = {
  id: 'resend',
  category: 'email',
  label: 'Resend',
  // Logo officiel de Resend et sa couleur (tracé : Simple Icons).
  logo: { style: 'fill', color: '#000000', paths: ['M2.023 0v24h5.553v-8.434h2.998L15.326 24h6.65l-5.372-9.258a7.652 7.652 0 0 0 3.316-3.016c.709-1.21 1.062-2.57 1.062-4.08 0-1.462-.353-2.767-1.062-3.91-.709-1.165-1.692-2.079-2.95-2.742C15.737.331 14.355 0 12.823 0Zm5.553 4.87h4.219c.731 0 1.349.125 1.851.376.526.252.925.618 1.2 1.098.274.457.412.994.412 1.611S15.132 9.12 14.88 9.6c-.229.48-.572.856-1.03 1.13-.434.252-.948.38-1.542.38H7.576Z'] },
  description: 'Envoi des e-mails du site : workflows, lien de nouveau mot de passe, notifications des formulaires.',
  settings: [
    {
      key: 'apiKey', label: 'Clé d\'API', type: 'secret', required: true,
      help: 'Dans Resend : « API Keys » → « Create API Key ». Elle commence par « re_ ». Une clé « Full access » permet aussi de vérifier le domaine de l\'expéditeur ; « Sending access » suffit pour envoyer.',
      env: { key: 'resendApiKey', name: 'NUXT_RESEND_API_KEY' },
    },
    {
      key: 'from', label: 'Expéditeur', type: 'text', required: true, placeholder: 'Cabinet Durand <contact@cabinet-durand.fr>',
      help: 'Le nom et l\'adresse que voient les destinataires. Le domaine de l\'adresse doit être ajouté et vérifié dans Resend (« Domains »).',
      env: { key: 'emailFrom', name: 'NUXT_EMAIL_FROM' },
    },
  ],

  validate(values): Record<string, string> {
    return values.from && !parseSender(values.from) ? { from: 'Expéditeur : une adresse e-mail, ou « Nom <adresse> ».' } : {}
  },

  async test(event, settings) {
    const sender = parseSender(settings.from ?? '')
    if (!sender) throw new Error('L\'expéditeur doit être une adresse e-mail, ou « Nom <adresse> ».')
    const domain = sender.email.split('@').pop()!.toLowerCase()
    const response = await fetch(`${apiUrl(event)}/domains`, { headers: headers(settings), signal: AbortSignal.timeout(10_000) })
    if (!response.ok) {
      const error = await resendError(response)
      // Clé limitée à l'envoi : elle est reconnue, mais ne peut pas lire la liste des domaines.
      if (error.name === 'restricted_api_key') return 'Clé reconnue par Resend (envoi seulement). Le domaine de l\'expéditeur n\'a pas pu être vérifié : il le sera au premier envoi.'
      if (['invalid_api_key', 'missing_api_key'].includes(error.name) || response.status === 401 || response.status === 403) throw new Error('Resend ne reconnaît pas cette clé d\'API.')
      throw new Error(`Resend a répondu ${response.status}${error.message ? ` : ${error.message}` : ''}`)
    }
    if (domain === TEST_DOMAIN) return 'Connexion à Resend réussie. Attention : l\'adresse d\'essai « resend.dev » n\'envoie qu\'à l\'adresse de votre compte Resend.'
    const { data = [] } = await response.json().catch(() => ({})) as { data?: { name: string; status: string }[] }
    const found = data.find(d => d.name.toLowerCase() === domain)
    if (!found) throw new Error(`Le domaine « ${domain} » n'est pas ajouté dans Resend (« Domains ») : les e-mails seraient refusés.`)
    if (found.status !== 'verified') throw new Error(`Le domaine « ${domain} » n'est pas encore vérifié dans Resend (état : ${found.status}). Ajoutez les enregistrements DNS indiqués par Resend, puis réessayez.`)
    return `Connexion à Resend réussie : le domaine « ${domain} » est vérifié.`
  },

  // Listes de contacts : pour la lettre d'information. Chez Resend, une liste est une « audience », désignée par son identifiant.
  contacts: {
    async add(event, settings, list, email) {
      const response = await fetch(`${apiUrl(event)}/audiences/${encodeURIComponent(list)}/contacts`, {
        method: 'POST', headers: headers(settings), signal: AbortSignal.timeout(10_000), body: JSON.stringify({ email, unsubscribed: false }),
      })
      if (!response.ok) throw new Error(`Resend a refusé l'ajout à l'audience (${response.status})${await detail(response)}`)
    },
    async remove(event, settings, list, email) {
      const response = await fetch(`${apiUrl(event)}/audiences/${encodeURIComponent(list)}/contacts/${encodeURIComponent(email)}`, {
        method: 'DELETE', headers: headers(settings), signal: AbortSignal.timeout(10_000),
      })
      // 404 : l'adresse n'était pas (ou plus) dans l'audience. Le résultat voulu est atteint.
      if (!response.ok && response.status !== 404) throw new Error(`Resend a refusé le retrait de l'audience (${response.status})${await detail(response)}`)
    },
    async check(event, settings, list) {
      const response = await fetch(`${apiUrl(event)}/audiences/${encodeURIComponent(list)}`, { headers: headers(settings), signal: AbortSignal.timeout(10_000) })
      if (response.status === 404) throw new Error(`Resend ne connaît pas l'audience « ${list} » (« Audiences », identifiant de l'audience).`)
      if (!response.ok) throw new Error(`Resend a répondu ${response.status}${await detail(response)}`)
      const found = await response.json().catch(() => ({})) as { name?: string }
      return found.name || list
    },
  },

  mail: {
    sender: (settings: ModuleSettings) => (settings.apiKey ? parseSender(settings.from ?? '') : null),
    async send(event, settings, message) {
      const sender = parseSender(settings.from ?? '')!
      // Resend accepte 50 destinataires par e-mail au plus : au-delà, plusieurs envois.
      for (let i = 0; i < message.to.length; i += 50) await sendOne(event, settings, sender, { ...message, to: message.to.slice(i, i + 50) })
    },
  },
}

async function sendOne(event: H3Event, settings: ModuleSettings, sender: { name: string; email: string }, message: MailMessage) {
  const response = await fetch(`${apiUrl(event)}/emails`, {
    method: 'POST',
    headers: headers(settings),
    body: JSON.stringify({
      // Le nom est mis entre guillemets : une virgule ou un point dedans couperait l'adresse.
      from: `"${sender.name.replace(/["\\]/g, '')}" <${sender.email}>`,
      to: message.to,
      subject: message.subject,
      html: message.html,
      ...(message.replyTo ? { reply_to: message.replyTo } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) {
    const error = await resendError(response)
    throw new Error(`Resend a refusé l'envoi (${response.status})${error.message ? ` : ${error.message}` : ''}`)
  }
}
