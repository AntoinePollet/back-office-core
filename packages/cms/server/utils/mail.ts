import type { H3Event } from 'h3'
import type { MailMessage } from './modules'

/**
 * Envoi d'e-mails. Le core ne sait pas en envoyer lui-même : il passe par le premier module actif qui sait le faire
 * (aujourd'hui Brevo). Sans un tel module, ou tant qu'il n'est pas réglé, le site n'envoie pas d'e-mails et
 * le back-office le dit là où c'est utile.
 */
async function mailProvider(event: H3Event) {
  for (const definition of activeModules()) {
    if (!definition.mail) continue
    const settings = await moduleSettings(event, definition.id)
    return { definition, settings, sender: definition.mail.sender(settings) }
  }
  return null
}

/** Ce site sait-il envoyer des e-mails ? `module` : le module chargé de l'envoi, s'il y en a un d'actif. */
export async function mailStatus(event: H3Event) {
  const provider = await mailProvider(event)
  return { configured: !!provider?.sender, module: provider ? { id: provider.definition.id, label: provider.definition.label } : null }
}

/** Envoie un e-mail. Lève une erreur lisible en cas d'échec. */
export async function sendEmail(event: H3Event, message: MailMessage) {
  const provider = await mailProvider(event)
  if (!provider?.sender) throw new Error('L\'envoi d\'e-mails n\'est pas configuré sur ce site.')
  await provider.definition.mail!.send(event, provider.settings, message)
}
