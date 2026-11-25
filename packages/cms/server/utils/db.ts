import { drizzle } from 'drizzle-orm/d1'
import type { H3Event } from 'h3'
import * as schema from '../database/schema'

export { schema }

/**
 * La base du site, par Drizzle. Chez Cloudflare c'est D1 ; sur un serveur Node, un fichier SQLite présenté sous
 * la même forme (server/platform/node/sqlite.ts) : le même pilote sert aux deux.
 */
export function useDb(event: H3Event) {
  return (event.context._cmsDb ??= drizzle(usePlatform().database(event) as never, { schema })) as ReturnType<typeof drizzle<typeof schema>>
}
