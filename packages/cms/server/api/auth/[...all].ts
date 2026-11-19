import { twoFactorErrorMessage } from '../../../shared/two-factor'

/** Erreurs de la double authentification : le message anglais de Better Auth est remplacé par un message en français. */
async function inFrench(response: Response) {
  if (response.ok) return response
  const data = await response.clone().json().catch(() => null) as { code?: string; message?: string } | null
  // Ces deux refus viennent de nous (server/utils/two-factor.ts) : leur message est déjà le bon.
  if (data?.code === 'TOO_MANY_LOGIN_ATTEMPTS' || data?.code === 'CODE_ALREADY_USED') return response
  const message = twoFactorErrorMessage(data?.code, response.status)
  if (!message) return response
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  return new Response(JSON.stringify({ ...data, message }), { status: response.status, headers })
}

// Routes d'authentification (connexion, double authentification, déconnexion, session), gérées par Better Auth.
export default defineEventHandler(async (event) => {
  const url = getRequestURL(event)
  // Pas d'inscription publique : les comptes sont créés par /api/cms/setup ou par invitation.
  if (url.pathname.includes('/sign-up'))
    throw createError({ statusCode: 403, message: 'Les inscriptions sont fermées.' })

  const auth = useAuth(event)
  // Étape du code (après le mot de passe), activation, codes de secours : la limite de tentatives et l'usage unique
  // d'un code sont appliqués par `twoFactorGuard`, au cœur de Better Auth, là où le compte visé est connu.
  // Les codes envoyés par e-mail ou SMS (autre méthode de l'extension) ne sont pas proposés : ces routes n'existent pas ici.
  if (/\/two-factor\/(send|verify)-otp$/.test(url.pathname)) throw createError({ statusCode: 404, message: 'Page introuvable.' })
  if (url.pathname.includes('/two-factor/')) return inFrench(await auth.handler(toWebRequest(event)))
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
    // Mot de passe juste mais code encore attendu : les échecs ne sont effacés qu'une fois la connexion terminée,
    // sinon redonner son mot de passe offrirait à chaque fois de nouveaux essais de code.
    const data = await response.clone().json().then(d => d as { twoFactorRedirect?: boolean; user?: { id?: string; name?: string; email?: string } } | null, () => null)
    if (!data?.twoFactorRedirect) {
      await clearLoginFailures(event, keys)
      // Journal d'activité : la connexion réussie (jamais le mot de passe ni le jeton de session).
      if (data?.user?.id) logActivity(event, { action: 'auth.login', actor: data.user, target: { kind: 'user', id: data.user.id } })
    }
  }
  return response
})
