import type { H3Event } from 'h3'

export function mailSettings(event: H3Event) {
  const { brevoApiKey, brevoApiUrl, emailFrom } = useRuntimeConfig(event)
  // « Nom <adresse> » ou une adresse seule.
  const match = /^\s*(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/.exec(emailFrom) ?? /^()\s*(\S+@\S+)\s*$/.exec(emailFrom)
  const sender = match ? { name: match[1] || cmsConfig.site.name, email: match[2]! } : null
  return { apiKey: brevoApiKey as string, apiUrl: (brevoApiUrl as string).replace(/\/$/, ''), sender, configured: !!brevoApiKey && !!sender }
}

/** Envoie un e-mail par Brevo. Lève une erreur lisible en cas d'échec. */
export async function sendEmail(event: H3Event, message: { to: string[]; subject: string; html: string }) {
  const { apiKey, apiUrl, sender } = mailSettings(event)
  const response = await fetch(`${apiUrl}/smtp/email`, {
    method: 'POST',
    headers: { 'api-key': apiKey, 'content-type': 'application/json', 'accept': 'application/json' },
    body: JSON.stringify({ sender, to: message.to.map(email => ({ email })), subject: message.subject, htmlContent: message.html }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) {
    const detail = await response.text().then(t => (JSON.parse(t) as { message?: string }).message ?? t).catch(() => '')
    throw new Error(`Brevo a refusé l'envoi (${response.status})${detail ? ` : ${String(detail).slice(0, 200)}` : ''}`)
  }
}
