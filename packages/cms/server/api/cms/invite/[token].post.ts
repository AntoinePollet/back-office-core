/** Enregistre le mot de passe choisi depuis un lien d'invitation ou de réinitialisation. Le lien ne sert qu'une fois. */
export default defineEventHandler(async (event) => {
  const user = await findInvite(event, getRouterParam(event, 'token')!)
  if (!user) throw createError({ statusCode: 404, message: 'Ce lien n\'est plus valable. Demandez-en un nouveau à un administrateur.' })
  const { password } = await readBody<{ password?: string }>(event)
  if (!password || password.length < MIN_PASSWORD) throw createError({ statusCode: 400, message: `Le mot de passe doit faire au moins ${MIN_PASSWORD} caractères.` })
  if (password.length > 128) throw createError({ statusCode: 400, message: 'Mot de passe trop long.' })
  await setUserPassword(event, user.id, password)
  // La personne vient de prouver qu'elle reçoit les e-mails du compte : les échecs de connexion comptés jusque-là
  // ne doivent pas l'empêcher de se connecter avec son nouveau mot de passe.
  await clearLoginFailures(event, loginKeys(event, user.email))
  return { email: user.email }
})
