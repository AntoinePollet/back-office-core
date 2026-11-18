/**
 * « Mot de passe oublié » : envoie par e-mail un lien à usage unique, si un compte existe pour cette adresse.
 *
 * La réponse est la même que le compte existe ou non, et elle part avant la recherche du compte et l'envoi
 * (faits en arrière-plan) : ni le contenu ni le temps de réponse ne renseignent sur les adresses qui ont un compte.
 * Tout ce qui précède la réponse (réglage du site, forme de l'adresse, limitation) ne dépend pas des comptes.
 */
export default defineEventHandler(async (event) => {
  if (!(await mailStatus(event)).configured)
    throw createError({ statusCode: 503, message: 'Ce site n\'envoie pas d\'e-mails. Adressez-vous à un administrateur du site pour recevoir un lien.' })

  const body = await readBody<{ email?: unknown }>(event).catch(() => null)
  const email = String(body?.email ?? '').trim().toLowerCase()
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw createError({ statusCode: 400, message: 'Saisissez une adresse e-mail valide.' })

  await consumePasswordResetRequest(event, email)

  // Sur Workers, waitUntil garde la requête en vie jusqu'à la fin de l'envoi.
  event.waitUntil(sendPasswordResetEmail(event, email).catch(error => console.error('[cms] l\'envoi du lien de mot de passe a échoué', error)))
  return { ok: true }
})
