import { cleanOrigin } from '../../../shared/attribution'
import { NEWSLETTER, normalizeEmail } from '../../../shared/newsletter'
import { requestSubscription } from '../../cms-modules/newsletter'
import { requireHuman } from '../../cms-modules/turnstile'

/**
 * Demande d'inscription à la lettre d'information (module `newsletter`) : `{ email, locale?, source? }`.
 * Route publique. L'inscription ne vaut qu'après le clic sur le lien envoyé par e-mail ; la réponse est la même que
 * l'adresse soit déjà inscrite ou non.
 */
export default defineEventHandler(async (event) => {
  await requireModule(event, 'newsletter')
  if (Number(getRequestHeader(event, 'content-length') ?? 0) > 10_000) throw createError({ statusCode: 413, message: 'Demande trop longue.' })
  const body = await readBody<{ email?: unknown; locale?: unknown; source?: unknown; website?: unknown; turnstile?: unknown; origin?: unknown }>(event).catch(() => null)
  // Champ piège, invisible pour une personne : un robot qui le remplit reçoit une réponse normale, mais rien n'est enregistré.
  if (body?.website) return { ok: true }

  const limit = { key: `newsletter:${clientIp(event)}`, max: NEWSLETTER.maxPerWindow }
  await assertRateLimit(event, [limit], minutes => `Trop de demandes d'inscription. Réessayez dans ${minutes} minute${minutes > 1 ? 's' : ''}.`)

  const email = normalizeEmail(body?.email)
  if (!email) throw createError({ statusCode: 422, message: 'Saisissez une adresse e-mail valide.', data: { errors: { email: 'Adresse e-mail invalide.' } } })
  if (!(await mailStatus(event)).configured) throw createError({ statusCode: 503, message: 'L\'inscription n\'est pas disponible pour l\'instant.' })

  // Anti-robots (module `turnstile`, s'il est actif et réglé) : vérifié après l'adresse, car un jeton ne sert qu'une fois.
  await requireHuman(event, body?.turnstile)
  await hitRateLimit(event, [limit.key], NEWSLETTER.windowMs)

  const { site } = cmsConfig
  const locale = site.locales.includes(String(body?.locale)) ? String(body!.locale) : site.defaultLocale
  const source = typeof body?.source === 'string' && /^\/[^\s?#]{0,200}$/.test(body.source) ? body.source : null
  try {
    await requestSubscription(event, { email, locale, source, origin: cleanOrigin(body?.origin) })
  }
  catch (error) {
    console.error('[cms] lettre d\'information : l\'e-mail de confirmation n\'est pas parti', error)
    throw createError({ statusCode: 502, message: 'L\'e-mail de confirmation n\'a pas pu être envoyé. Réessayez dans un instant.' })
  }
  return { ok: true }
})
