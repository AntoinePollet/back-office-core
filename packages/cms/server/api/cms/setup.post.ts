import { count, eq } from 'drizzle-orm'

/** Crée le premier compte, administrateur. Refusé dès qu'un compte existe. */
export default defineEventHandler(async (event) => {
  const db = useDb(event)
  const [row] = await db.select({ n: count() }).from(schema.user)
  if ((row?.n ?? 0) > 0) throw createError({ statusCode: 403, message: 'Le back-office est déjà initialisé.' })

  const { name, email, password } = await readBody<{ name?: string; email?: string; password?: string }>(event)
  if (!name || !email || !password) throw createError({ statusCode: 400, message: 'Nom, e-mail et mot de passe sont obligatoires.' })
  if (password.length < 10) throw createError({ statusCode: 400, message: 'Le mot de passe doit faire au moins 10 caractères.' })

  try {
    await useAuth(event).api.signUpEmail({ body: { name, email, password } })
  }
  catch (error) {
    throw createError({ statusCode: 400, message: (error as Error).message || 'Création du compte impossible.' })
  }
  await db.update(schema.user).set({ role: 'admin' }).where(eq(schema.user.email, email.toLowerCase()))
  logActivity(event, { action: 'user.setup', actor: { name, email: email.toLowerCase() } })
  return { ok: true }
})
