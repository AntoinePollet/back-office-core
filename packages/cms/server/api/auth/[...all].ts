// Routes d'authentification (connexion, déconnexion, session), gérées par Better Auth.
export default defineEventHandler(async (event) => {
  const url = getRequestURL(event)
  // Pas d'inscription publique : les comptes sont créés par /api/cms/setup ou par invitation.
  if (url.pathname.includes('/sign-up'))
    throw createError({ statusCode: 403, message: 'Les inscriptions sont fermées.' })

  const auth = useAuth(event)
  if (event.method !== 'POST' || !url.pathname.endsWith('/sign-in/email')) return auth.handler(toWebRequest(event))

  // Connexion : les échecs sont comptés, et la porte se ferme un moment quand il y en a trop.
  const raw = (await readRawBody(event)) ?? ''
  let email = ''
  try { email = String((JSON.parse(raw) as { email?: unknown }).email ?? '').trim().toLowerCase() }
  catch { /* corps illisible : Better Auth répondra par une erreur */ }
  const keys = loginKeys(event, email)
  await assertLoginAllowed(event, keys)

  // Le corps a été lu pour en tirer l'adresse e-mail : on le remet dans une nouvelle requête.
  const response = await auth.handler(new Request(url, { method: 'POST', headers: event.headers, body: raw }))
  if (response.status === 401) await recordLoginFailure(event, keys, email)
  else if (response.ok) {
    await clearLoginFailures(event, keys)
    // Journal d'activité : la connexion réussie (jamais le mot de passe ni le jeton de session).
    const who = await response.clone().json().then((data: { user?: { id?: string; name?: string; email?: string } }) => data?.user, () => undefined)
    if (who?.id) logActivity(event, { action: 'auth.login', actor: who, target: { kind: 'user', id: who.id } })
  }
  return response
})
