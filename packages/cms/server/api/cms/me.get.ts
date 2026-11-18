export default defineEventHandler(async (event) => {
  const { id, name, email, role } = await requireUser(event) as { id: string; name: string; email: string; role?: string }
  return { id, name, email, role }
})
