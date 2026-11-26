import { parseScPeriod } from '../../../../shared/search-console'
import { readSearchConsole, requireSearchConsoleAccess } from '../../../cms-modules/search-console'

/** Le site dans les résultats de Google : totaux, recherches et pages. `?days=7`, `28` ou `90`. */
export default defineEventHandler(async (event) => {
  await requireSearchConsoleAccess(event)
  return readSearchConsole(event, parseScPeriod(getQuery(event).days))
})
