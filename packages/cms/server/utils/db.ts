import { drizzle } from 'drizzle-orm/d1'
import type { H3Event } from 'h3'
import * as schema from '../database/schema'

export { schema }

export function useDb(event: H3Event) {
  const d1 = event.context.cloudflare?.env?.DB
  if (!d1) throw createError({ statusCode: 500, message: 'Base D1 introuvable : la liaison « DB » manque dans wrangler.jsonc.' })
  return (event.context._cmsDb ??= drizzle(d1, { schema })) as ReturnType<typeof drizzle<typeof schema>>
}
