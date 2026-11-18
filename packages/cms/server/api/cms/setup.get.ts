import { count } from 'drizzle-orm'

/** Indique si le back-office attend encore la création de son premier compte. */
export default defineEventHandler(async (event) => {
  const [row] = await useDb(event).select({ n: count() }).from(schema.user)
  return { needed: (row?.n ?? 0) === 0 }
})
