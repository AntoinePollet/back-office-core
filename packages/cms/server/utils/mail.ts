import type { H3Event } from 'h3'
import type { CmsModuleDefinition, MailMessage, ModuleSettings } from './modules'

/**
 * Envoi d'e-mails. Le core ne sait pas en envoyer lui-même : il passe par un module actif qui sait le faire (Brevo,
 * Resend). Si plusieurs sont déclarés, c'est le premier réglé, dans l'ordre de cms.config.ts, qui envoie ; si aucun ne
 * l'est, le premier déclaré (le back-office dit alors ce qu'il manque). Sans un tel module, ou tant qu'il n'est pas
 * réglé, le site n'envoie pas d'e-mails et le back-office le dit là où c'est utile.
 */
async function mailProvider(event: H3Event) {
  let first: { definition: CmsModuleDefinition; settings: ModuleSettings; sender: null } | null = null
  for (const definition of await activeModules(event)) {
    if (!definition.mail) continue
    const settings = await moduleSettings(event, definition.id)
    const sender = definition.mail.sender(settings)
    if (sender) return { definition, settings, sender }
    first ??= { definition, settings, sender: null }
  }
  return first
}

/** Expéditeur saisi : « Nom <adresse> » ou une adresse seule (le nom est alors celui du site). Null s'il est mal écrit. */
export function parseSender(from: string) {
  const match = /^\s*(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/.exec(from) ?? /^()\s*(\S+@\S+)\s*$/.exec(from)
  return match ? { name: match[1] || cmsConfig.site.name, email: match[2]! } : null
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
