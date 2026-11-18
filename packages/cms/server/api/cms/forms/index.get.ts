import { desc } from 'drizzle-orm'
import { requireSubmissionsAccess } from '../../../cms-modules/forms'

/** Messages reçus par les formulaires du site, du plus récent au plus ancien (les 500 derniers). */
export default defineEventHandler(async (event) => {
  await requireSubmissionsAccess(event)
  const submissions = await useDb(event).select().from(schema.formSubmissions).orderBy(desc(schema.formSubmissions.createdAt)).limit(500)
  return { submissions, retentionDays: moduleOptions<{ retentionDays: number }>('forms').retentionDays }
})
